import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ANALYSIS_QUEUE,
  getQueueConnection,
  type AnalysisJobData,
} from "../lib/queue";
import { downloadToFile, getJson, putJson } from "../lib/storage";
import { extractBundle, findReportDir } from "../lib/analyzer/ingest";
import {
  stageParse,
  stageRules,
  stageRetrieval,
  stageLlm,
  type PipelineOptions,
} from "../lib/analyzer/pipeline";
import { buildTimeline } from "../lib/analyzer/timeline";
import { stageIndex, type StageKey } from "../lib/analyzer/stages";
import type {
  ParseCheckpoint,
  RulesCheckpoint,
  RetrievalCheckpoint,
} from "../lib/analyzer/checkpoints";
import { loadOemEntries } from "../lib/oem-registry";
import { loadSettings } from "../lib/settings";
import { db } from "../db";
import { analyses } from "../db/schema";

class CancelledError extends Error {
  constructor() {
    super("Остановлено пользователем");
    this.name = "CancelledError";
  }
}

const ckptKey = (id: string, stage: StageKey) =>
  `checkpoints/${id}/${stage}.json`;

async function setProgress(id: string, stage: string, progress: number) {
  await db
    .update(analyses)
    .set({ stage, progress, status: "processing", updatedAt: new Date() })
    .where(eq(analyses.id, id));
}

async function markStageAvailable(id: string, stage: StageKey) {
  const [row] = await db
    .select({ a: analyses.availableStages })
    .from(analyses)
    .where(eq(analyses.id, id))
    .limit(1);
  const set = new Set<string>([...(row?.a ?? []), stage]);
  await db
    .update(analyses)
    .set({ availableStages: [...set], updatedAt: new Date() })
    .where(eq(analyses.id, id));
}

async function guardCancel(id: string) {
  const [row] = await db
    .select({ c: analyses.cancelRequested })
    .from(analyses)
    .where(eq(analyses.id, id))
    .limit(1);
  if (row?.c) throw new CancelledError();
}

async function processJob(data: AnalysisJobData) {
  const { analysisId, storageKey, filename, fromStage } = data;
  const startIdx = fromStage ? Math.max(0, stageIndex(fromStage)) : 0;
  const work = await mkdtemp(join(tmpdir(), "sba-"));
  const archivePath = join(work, filename);
  const extractDir = join(work, "extracted");

  // Fresh run: clear any prior error and stale cancel flag.
  await db
    .update(analyses)
    .set({ status: "processing", error: null, cancelRequested: 0, updatedAt: new Date() })
    .where(eq(analyses.id, analysisId));

  try {
    const [oemEntries, settings] = await Promise.all([
      loadOemEntries(),
      loadSettings(true),
    ]);
    const opts: PipelineOptions = {
      oemEntries,
      settings: {
        llmModel: settings.llmModel,
        llmApiKey: settings.llmApiKey,
        ragEnabled: settings.ragEnabled,
        ragUrl: settings.ragUrl,
        ragApiKey: settings.ragApiKey,
        maskPii: settings.maskPii,
      },
    };

    let parse: ParseCheckpoint;
    let rules: RulesCheckpoint;
    let retrieval: RetrievalCheckpoint;

    // The extracted files are needed by both parse and timeline; extract once
    // whenever the restart point is at or before "timeline".
    const needFiles = startIdx <= stageIndex("timeline");
    let reportDir: string | null = null;

    if (needFiles) {
      await guardCancel(analysisId);
      await setProgress(analysisId, "Загрузка из хранилища", 2);
      await downloadToFile(storageKey, archivePath);

      await guardCancel(analysisId);
      await setProgress(analysisId, "Распаковка архива", 10);
      await extractBundle(archivePath, extractDir);
      reportDir = (await findReportDir(extractDir)) ?? extractDir;
    }

    // Stages extract + parse depend on the actual files; run them whenever the
    // restart point is at or before "parse", otherwise reload the checkpoint.
    if (startIdx <= stageIndex("parse")) {
      await setProgress(analysisId, "Парсинг логов", 18);
      parse = await stageParse(
        reportDir!,
        opts,
        (pct) => void setProgress(analysisId, "Парсинг логов", 18 + Math.round(pct * 0.18)),
        () => guardCancel(analysisId),
      );
      await putJson(ckptKey(analysisId, "parse"), parse);
      await markStageAvailable(analysisId, "parse");
    } else {
      parse = await getJson<ParseCheckpoint>(ckptKey(analysisId, "parse"));
    }

    // Stage timeline (log player): merge all logs into a time-ordered stream
    // and persist shards + overview. Best-effort — never fails the analysis.
    if (startIdx <= stageIndex("timeline") && reportDir) {
      await guardCancel(analysisId);
      await setProgress(analysisId, "Сборка ленты событий", 40);
      try {
        await buildTimeline(reportDir, analysisId, {
          embed: { apiKey: settings.llmApiKey },
        });
        await markStageAvailable(analysisId, "timeline");
      } catch (err) {
        console.error(`Timeline build failed for ${analysisId}:`, err);
      }
    }

    if (startIdx <= stageIndex("rules")) {
      await guardCancel(analysisId);
      await setProgress(analysisId, "Применение правил", 60);
      rules = await stageRules(parse);
      await putJson(ckptKey(analysisId, "rules"), rules);
      await markStageAvailable(analysisId, "rules");
    } else {
      rules = await getJson<RulesCheckpoint>(ckptKey(analysisId, "rules"));
    }

    if (startIdx <= stageIndex("retrieval")) {
      await guardCancel(analysisId);
      await setProgress(analysisId, "Поиск решений (Lexiro)", 70);
      retrieval = await stageRetrieval(parse, rules, opts);
      await putJson(ckptKey(analysisId, "retrieval"), retrieval);
      await markStageAvailable(analysisId, "retrieval");
    } else {
      retrieval = await getJson<RetrievalCheckpoint>(
        ckptKey(analysisId, "retrieval"),
      );
    }

    await guardCancel(analysisId);
    await setProgress(analysisId, "LLM-анализ", 85);
    const report = await stageLlm(parse, rules, retrieval, opts);
    await markStageAvailable(analysisId, "llm");

    await db
      .update(analyses)
      .set({
        status: "done",
        progress: 100,
        stage: "Готово",
        report,
        product: report.profile.productName,
        version: report.profile.version,
        host: report.profile.host,
        healthScore: report.healthScore,
        problemCount: report.problems.length,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(analyses.id, analysisId));
  } catch (err) {
    if (err instanceof CancelledError) {
      await db
        .update(analyses)
        .set({
          status: "cancelled",
          stage: "Остановлено",
          cancelRequested: 0,
          updatedAt: new Date(),
        })
        .where(eq(analyses.id, analysisId));
      return; // handled — don't fail the BullMQ job
    }
    console.error(`Analysis ${analysisId} failed:`, err);
    await db
      .update(analyses)
      .set({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        updatedAt: new Date(),
      })
      .where(eq(analyses.id, analysisId));
    throw err;
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

const worker = new Worker<AnalysisJobData>(
  ANALYSIS_QUEUE,
  async (job) => processJob(job.data),
  { connection: getQueueConnection(), concurrency: 2 },
);

worker.on("ready", () => console.log("Analysis worker ready."));
worker.on("failed", (job, err) =>
  console.error(`Job ${job?.id} failed:`, err.message),
);

process.on("SIGINT", async () => {
  await worker.close();
  process.exit(0);
});
