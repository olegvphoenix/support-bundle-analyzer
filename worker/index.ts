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
import { downloadToFile } from "../lib/storage";
import { extractBundle, findReportDir } from "../lib/analyzer/ingest";
import { runPipeline } from "../lib/analyzer/pipeline";
import { loadOemEntries } from "../lib/oem-registry";
import { loadSettings } from "../lib/settings";
import { db } from "../db";
import { analyses } from "../db/schema";

async function setProgress(id: string, stage: string, progress: number) {
  await db
    .update(analyses)
    .set({ stage, progress, status: "processing", updatedAt: new Date() })
    .where(eq(analyses.id, id));
}

async function processJob(data: AnalysisJobData) {
  const { analysisId, storageKey, filename } = data;
  const work = await mkdtemp(join(tmpdir(), "sba-"));
  const archivePath = join(work, filename);
  const extractDir = join(work, "extracted");

  try {
    await setProgress(analysisId, "Загрузка из хранилища", 2);
    await downloadToFile(storageKey, archivePath);

    await setProgress(analysisId, "Распаковка архива", 8);
    await extractBundle(archivePath, extractDir);

    const reportDir = (await findReportDir(extractDir)) ?? extractDir;

    const [oemEntries, settings] = await Promise.all([
      loadOemEntries(),
      loadSettings(true),
    ]);
    const report = await runPipeline(
      reportDir,
      (stage, pct) => {
        // Map pipeline 0-100 into the 10-99 band (download/extract took 0-10).
        void setProgress(analysisId, stage, 10 + Math.round(pct * 0.89));
      },
      {
        oemEntries,
        settings: {
          llmModel: settings.llmModel,
          llmApiKey: settings.llmApiKey,
          ragEnabled: settings.ragEnabled,
          ragUrl: settings.ragUrl,
          ragApiKey: settings.ragApiKey,
          maskPii: settings.maskPii,
        },
      },
    );

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
        updatedAt: new Date(),
      })
      .where(eq(analyses.id, analysisId));
  } catch (err) {
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
