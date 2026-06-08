import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { detectProfile } from "./profile";
import { collectFacts } from "./facts";
import { parseLogFile } from "./parser";
import { Reducer } from "./reducer";
import { loadRules, applyRules } from "./rules-engine";
import { loadDbRules } from "@/lib/rules-registry";
import { retrieveSolution } from "./retrieval";
import { buildEvidencePack } from "./evidence";
import { buildCorrelations, type CorrInput } from "./correlate";
import { analyzeWithLlm } from "./llm";
import { createRedactor } from "./redact";
import type { OemEntry } from "./oem-map";
import type {
  ParseCheckpoint,
  RulesCheckpoint,
  RetrievalCheckpoint,
} from "./checkpoints";
import type {
  AnalysisReport,
  CorrelationGroup,
  DetectedProblem,
  NoiseItem,
  ReportProblem,
  RetrievalResult,
  Severity,
  TimelineEvent,
} from "./types";

export type ProgressFn = (stage: string, pct: number) => void;

export interface PipelineSettings {
  llmModel?: string;
  llmApiKey?: string | null;
  ragEnabled?: boolean;
  ragUrl?: string | null;
  ragApiKey?: string | null;
  maskPii?: boolean;
}

export interface PipelineOptions {
  // Dynamic OEM registry; when omitted, built-in defaults + auto-detect apply.
  oemEntries?: OemEntry[];
  // Runtime settings (LLM/RAG/privacy). When omitted, env vars are used.
  settings?: PipelineSettings;
}

// A no-op redactor used when PII masking is disabled in settings.
function identityRedactor() {
  return { redact: (t: string) => t, mappingSize: 0 };
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
  noise: 3,
};

function healthFromProblems(problems: DetectedProblem[]): number {
  let score = 100;
  for (const p of problems) {
    if (p.severity === "critical") score -= 25;
    else if (p.severity === "warning") score -= p.storm ? 12 : 7;
    else if (p.severity === "info") score -= 2;
  }
  return Math.max(5, Math.min(100, score));
}

/**
 * Run the full analysis over an extracted Report directory (all stages).
 */
export async function runPipeline(
  reportDir: string,
  progress: ProgressFn = () => {},
  opts: PipelineOptions = {},
): Promise<AnalysisReport> {
  progress("Парсинг логов", 20);
  const parse = await stageParse(reportDir, opts, (pct) =>
    progress("Парсинг логов", 20 + Math.round(pct * 0.37)),
  );
  progress("Применение правил", 60);
  const rules = await stageRules(parse);
  progress("Поиск решений в базе знаний", 70);
  const retrieval = await stageRetrieval(parse, rules, opts);
  progress("Анализ ИИ", 85);
  const report = await stageLlm(parse, rules, retrieval, opts);
  progress("Готово", 100);
  return report;
}

/**
 * Stage 1 (parse): profile + facts + log parsing/reduction over the extracted
 * Report directory. `onPct` reports 0..100 within this stage.
 */
export async function stageParse(
  reportDir: string,
  opts: PipelineOptions = {},
  onPct: (pct: number) => void = () => {},
  checkCancel: () => Promise<void> = async () => {},
): Promise<ParseCheckpoint> {
  const profile = await detectProfile(reportDir, opts.oemEntries);
  const facts = await collectFacts(reportDir);

  const reducer = new Reducer();
  let errorCount = 0;
  let warnCount = 0;
  let logFiles = 0;

  const logsDir = join(reportDir, "Logs");
  if (existsSync(logsDir)) {
    const files = (await readdir(logsDir)).filter((f) => f.endsWith(".log"));
    let i = 0;
    for (const f of files) {
      await checkCancel();
      logFiles++;
      await parseLogFile(join(logsDir, f), f, (rec) => {
        if (rec.level === "ERROR" || rec.level === "FATAL") {
          errorCount++;
          reducer.add(rec);
        } else if (rec.level === "WARN" || rec.level === "WARNING") {
          warnCount++;
          reducer.add(rec);
        }
      });
      i++;
      onPct(Math.round((i / files.length) * 100));
    }
  }

  const signatures = reducer.finish();
  return { profile, facts, signatures, errorCount, warnCount, logFiles };
}

/** Stage 2 (rules): apply the YAML knowledge base to reduced signatures. */
export async function stageRules(
  parse: ParseCheckpoint,
): Promise<RulesCheckpoint> {
  // DB rules first so user-defined rules take precedence over built-ins
  // (matches() returns the first matching rule).
  const [builtIn, dbRules] = await Promise.all([loadRules(), loadDbRules()]);
  const rules = [...dbRules, ...builtIn];
  const { problems: detected, noiseLineCount } = applyRules(
    parse.signatures,
    rules,
    parse.profile.productFamily,
  );
  return { detected, noiseLineCount };
}

/** Stage 3 (retrieval): best-effort RAG lookups for non-noise problems. */
export async function stageRetrieval(
  parse: ParseCheckpoint,
  rules: RulesCheckpoint,
  opts: PipelineOptions = {},
): Promise<RetrievalCheckpoint> {
  const settings = opts.settings;
  const ragSettings = settings
    ? { enabled: settings.ragEnabled ?? true, url: settings.ragUrl ?? null, apiKey: settings.ragApiKey ?? null }
    : undefined;
  const retrievals = new Map<string, RetrievalResult>();
  const ragTargets = rules.detected
    .filter((p) => p.severity !== "noise")
    .slice(0, 6);
  for (const p of ragTargets) {
    const r = await retrieveSolution(
      p.retrievalQuery,
      parse.profile,
      p.evidence[0]?.sampleMessage,
      ragSettings,
      { subsystem: p.subsystem },
    );
    if (r) retrievals.set(p.retrievalQuery, r);
  }
  return { retrievals: [...retrievals.entries()] };
}

/** Stage 4 (llm): LLM analysis + final report assembly. */
export async function stageLlm(
  parse: ParseCheckpoint,
  rules: RulesCheckpoint,
  retrieval: RetrievalCheckpoint,
  opts: PipelineOptions = {},
): Promise<AnalysisReport> {
  const { profile, facts, signatures, errorCount, warnCount, logFiles } = parse;
  const { detected, noiseLineCount } = rules;
  const retrievals = new Map<string, RetrievalResult>(retrieval.retrievals);
  const settings = opts.settings;

  // Pre-LLM correlation over detected signatures so the model can reason about
  // chains of events around a shared entity (camera/object/address).
  const detectedCorr = buildCorrelations(
    detected
      .map((d, idx) => ({ d, idx }))
      .filter(({ d }) => d.severity !== "noise")
      .map(({ d, idx }) => ({
        id: `#${idx}`,
        title: d.title,
        subsystem: d.subsystem,
        severity: d.severity,
        firstTs: tsRange([d]).first,
        entities: entitiesOf([d]),
      })),
  );

  const pack = buildEvidencePack(profile, facts, detected, retrievals, detectedCorr);
  const llm = await analyzeWithLlm(
    pack,
    settings ? { model: settings.llmModel ?? "gemini-2.5-pro", apiKey: settings.llmApiKey ?? null } : undefined,
  );

  const redactor = settings && settings.maskPii === false ? identityRedactor() : createRedactor();
  const noise: NoiseItem[] = detected
    .filter((p) => p.severity === "noise")
    .map((p) => ({ title: p.title, count: p.count, ruleId: p.ruleId }));

  let problems: ReportProblem[];
  let analyzedBy: "llm" | "rules";
  let summary: string;
  let healthScore: number;

  const nonNoise = detected.filter((p) => p.severity !== "noise");

  if (llm) {
    analyzedBy = "llm";
    summary = llm.summary;
    healthScore = llm.healthScore;
    problems = llm.problems.map((lp, i) => {
      // Link back to rule-detected evidence via referenced indices.
      const refs = lp.evidenceRefs
        .map((idx) => detected[idx])
        .filter(Boolean) as DetectedProblem[];
      const primary = refs[0];
      const sources = refs.flatMap(
        (r) => retrievals.get(r.retrievalQuery)?.sources ?? [],
      );
      return {
        id: `p${i}`,
        severity: lp.severity,
        subsystem: lp.subsystem,
        title: lp.title,
        rootCause: lp.rootCause,
        impact: lp.impact,
        solution: lp.solution,
        count: refs.reduce((s, r) => s + r.count, 0) || primary?.count || 0,
        storm: refs.some((r) => r.storm),
        confidence: lp.confidence,
        ruleId: primary?.ruleId ?? null,
        component: componentOf(refs),
        firstTs: tsRange(refs).first,
        lastTs: tsRange(refs).last,
        sampleMessages: refs
          .flatMap((r) => r.evidence.slice(0, 1))
          .map((e) => redactor.redact(e.sampleMessage).slice(0, 400)),
        affectedFiles: [...new Set(refs.flatMap((r) => r.evidence.flatMap((e) => e.files)))],
        sources: dedupeSources(sources),
        entities: entitiesOf(refs),
      };
    });
  } else {
    analyzedBy = "rules";
    healthScore = healthFromProblems(nonNoise);
    summary = buildRuleSummary(nonNoise, healthScore);
    problems = nonNoise.map((p, i) => {
      const sources = retrievals.get(p.retrievalQuery)?.sources ?? [];
      return {
        id: `p${i}`,
        severity: p.severity,
        subsystem: p.subsystem,
        title: p.title,
        rootCause: p.cause ?? null,
        impact: null,
        solution: p.solution ?? [],
        count: p.count,
        storm: p.storm,
        confidence: p.ruleId ? 0.8 : 0.4,
        ruleId: p.ruleId,
        component: componentOf([p]),
        firstTs: tsRange([p]).first,
        lastTs: tsRange([p]).last,
        sampleMessages: p.evidence
          .slice(0, 2)
          .map((e) => redactor.redact(e.sampleMessage).slice(0, 400)),
        affectedFiles: [...new Set(p.evidence.flatMap((e) => e.files))],
        sources: dedupeSources(sources),
        entities: entitiesOf([p]),
      };
    });
  }

  problems.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.count - a.count,
  );

  const timeline: TimelineEvent[] = problems
    .filter((p) => p.firstTs)
    .map((p) => ({
      ts: p.firstTs,
      severity: p.severity,
      subsystem: p.subsystem,
      title: p.title,
      count: p.count,
      storm: p.storm,
    }))
    .sort((a, b) => (a.ts ?? "").localeCompare(b.ts ?? ""));

  const correlations: CorrelationGroup[] = buildCorrelations(
    problems.map<CorrInput>((p) => ({
      id: p.id,
      title: p.title,
      subsystem: p.subsystem,
      severity: p.severity,
      firstTs: p.firstTs,
      entities: p.entities ?? [],
    })),
  );

  return {
    profile,
    facts,
    healthScore,
    summary,
    analyzedBy,
    problems,
    noise,
    timeline,
    correlations,
    stats: {
      totalSignatures: signatures.length,
      errorCount,
      warnCount,
      noiseLineCount,
      logFiles,
    },
    createdAt: new Date().toISOString(),
  };
}

function entitiesOf(refs: DetectedProblem[]): string[] {
  const set = new Set<string>();
  for (const r of refs) {
    for (const e of r.evidence) {
      for (const ent of e.entities ?? []) set.add(ent);
    }
  }
  return [...set];
}

function componentOf(refs: DetectedProblem[]): string | null {
  for (const r of refs) {
    for (const e of r.evidence) {
      if (e.component) return e.component;
    }
  }
  return null;
}

function tsRange(refs: DetectedProblem[]): { first: string | null; last: string | null } {
  let first: string | null = null;
  let last: string | null = null;
  for (const r of refs) {
    for (const e of r.evidence) {
      if (e.firstTs && (!first || e.firstTs < first)) first = e.firstTs;
      if (e.lastTs && (!last || e.lastTs > last)) last = e.lastTs;
    }
  }
  return { first, last };
}

function dedupeSources<T extends { title: string; url: string | null }>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const s of arr) {
    const k = s.url || s.title;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out.slice(0, 6);
}

function buildRuleSummary(problems: DetectedProblem[], health: number): string {
  const crit = problems.filter((p) => p.severity === "critical").length;
  const warn = problems.filter((p) => p.severity === "warning").length;
  if (!problems.length) return "Критичных проблем не обнаружено — преимущественно фоновый шум.";
  const parts: string[] = [];
  if (crit) parts.push(`${crit} критич.`);
  if (warn) parts.push(`${warn} предупр.`);
  return `Здоровье системы ${health}/100. Обнаружено: ${parts.join(", ")}. Подробности ниже.`;
}
