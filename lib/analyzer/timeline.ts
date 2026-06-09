import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseLogFile } from "./parser";
import { putJson, getJson } from "@/lib/storage";
import { embedTexts, type EmbedSettings } from "./embeddings";
import type {
  LogEvent,
  TimelineChapter,
  TimelineManifest,
} from "./types";

// ---------------------------------------------------------------------------
// Timeline builder: merges every service log into a single time-ordered event
// stream, writes it to object storage as JSON shards, and computes a compact
// overview (per-bucket activity + chapters) for the player's scrubber. The
// merge is a streaming collect-then-sort: each file is already roughly ordered,
// but cross-file interleaving requires a global sort. Memory is bounded by
// MAX_EVENTS; oversized bundles are flagged `truncated`.
// ---------------------------------------------------------------------------

const MAX_EVENTS = 500_000;
const SHARD_SIZE = 4000;
const BUCKETS = 240;
const MAX_MSG = 600;
const MAX_CHAPTERS = 10;
const MAX_SEMANTIC = 300;

export const tlPrefix = (id: string) => `timeline/${id}/`;
export const tlManifestKey = (id: string) => `timeline/${id}/manifest.json`;
export const tlShardKey = (id: string, i: number) =>
  `timeline/${id}/shard-${String(i).padStart(4, "0")}.json`;
export const tlEmbedKey = (id: string) => `timeline/${id}/embeddings.json`;

export interface SemanticIndex {
  items: { ts: number; seq: number; service: string; level: string; text: string }[];
  vectors: number[][];
}

export interface TimelineBuildOptions {
  embed?: EmbedSettings;
}

export interface TimelineBuildResult {
  built: boolean;
  totalEvents: number;
  shards: number;
  hasEmbeddings: boolean;
}

// Derive a readable lane name from a log file name:
//   "APP_HOST.Ipint.log" -> "Ipint"
//   "NGP_Host_Service.log" -> "NGP_Host_Service"
function serviceName(fileName: string): string {
  let n = fileName.replace(/\.log$/i, "");
  n = n.replace(/^APP_HOST\./i, "");
  return n || fileName;
}

function toEpoch(tsText: string): number {
  // tsText is "YYYY-MM-DD HH:MM:SS.mmm"; treat as UTC for stable ordering.
  const sp = tsText.indexOf(" ");
  if (sp < 0) return NaN;
  const date = tsText.slice(0, sp);
  const time = tsText.slice(sp + 1);
  return Date.parse(`${date}T${time}Z`);
}

function levelIndex(level: string): number {
  if (level === "ERROR" || level === "FATAL") return 0;
  if (level === "WARN" || level === "WARNING") return 1;
  return 2;
}

// Coarse signature for de-duplicating significant events before embedding.
function normSig(s: string): string {
  return s
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F-]{27}/g, "<id>")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "<ip>")
    .replace(/\d+/g, "#")
    .slice(0, 120)
    .toLowerCase();
}

export async function buildTimeline(
  reportDir: string,
  analysisId: string,
  opts: TimelineBuildOptions = {},
): Promise<TimelineBuildResult> {
  const logsDir = join(reportDir, "Logs");
  if (!existsSync(logsDir)) {
    return { built: false, totalEvents: 0, shards: 0, hasEmbeddings: false };
  }

  const files = (await readdir(logsDir)).filter((f) => f.endsWith(".log"));
  const events: LogEvent[] = [];
  let seq = 0;
  let truncated = false;

  for (const f of files) {
    if (truncated) break;
    const service = serviceName(f);
    await parseLogFile(join(logsDir, f), f, (rec) => {
      if (truncated) return;
      const ts = toEpoch(rec.ts ?? "");
      if (!Number.isFinite(ts)) return;
      const sp = (rec.ts ?? "").indexOf(" ");
      const tsText = sp >= 0 ? (rec.ts ?? "").slice(sp + 1) : (rec.ts ?? "");
      events.push({
        seq: seq++,
        ts,
        tsText,
        service,
        thread: rec.thread ?? null,
        level: rec.level ?? "INFO",
        component: rec.component ?? null,
        message: rec.message.replace(/\s+/g, " ").trim().slice(0, MAX_MSG),
      });
      if (events.length >= MAX_EVENTS) truncated = true;
    });
  }

  if (events.length === 0) {
    return { built: false, totalEvents: 0, shards: 0, hasEmbeddings: false };
  }

  // Global time order; seq breaks ties (preserves intra-file order).
  events.sort((a, b) => a.ts - b.ts || a.seq - b.seq);
  // Re-seq after sort so seq doubles as a stable global position index.
  events.forEach((e, i) => (e.seq = i));

  const startTs = events[0].ts;
  const endTs = events[events.length - 1].ts;
  const span = Math.max(1, endTs - startTs);

  // Lane order: services sorted by activity (most events first).
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.service, (counts.get(e.service) ?? 0) + 1);
  const services = [...counts.keys()].sort(
    (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0),
  );
  const serviceIdx = new Map(services.map((s, i) => [s, i]));

  // agg[bucket][service] = [err, warn, other]
  const agg: number[][][] = Array.from({ length: BUCKETS }, () =>
    Array.from({ length: services.length }, () => [0, 0, 0]),
  );
  for (const e of events) {
    const b = Math.min(BUCKETS - 1, Math.floor(((e.ts - startTs) / span) * BUCKETS));
    const si = serviceIdx.get(e.service) ?? 0;
    agg[b][si][levelIndex(e.level)]++;
  }

  // Chapters: restarts (from banner lines) + error storms (from aggregates).
  const chapters = buildChapters(events, agg, startTs, span);

  // Write shards.
  const shards: { start: number; end: number; count: number }[] = [];
  let shardIndex = 0;
  for (let i = 0; i < events.length; i += SHARD_SIZE) {
    const slice = events.slice(i, i + SHARD_SIZE);
    await putJson(tlShardKey(analysisId, shardIndex), slice);
    shards.push({
      start: slice[0].ts,
      end: slice[slice.length - 1].ts,
      count: slice.length,
    });
    shardIndex++;
  }

  // Semantic index (best-effort): embed deduped significant events.
  const hasEmbeddings = await buildSemanticIndex(events, analysisId, opts.embed);

  const manifest: TimelineManifest = {
    startTs,
    endTs,
    totalEvents: events.length,
    truncated,
    services,
    buckets: BUCKETS,
    agg,
    chapters,
    shards,
    hasEmbeddings,
  };
  await putJson(tlManifestKey(analysisId), manifest);

  return {
    built: true,
    totalEvents: events.length,
    shards: shardIndex,
    hasEmbeddings,
  };
}

// --- Readers (used by the timeline API routes) -----------------------------

export async function loadManifest(id: string): Promise<TimelineManifest | null> {
  try {
    return await getJson<TimelineManifest>(tlManifestKey(id));
  } catch {
    return null;
  }
}

export async function loadShard(id: string, i: number): Promise<LogEvent[]> {
  return getJson<LogEvent[]>(tlShardKey(id, i));
}

export async function loadSemanticIndex(id: string): Promise<SemanticIndex | null> {
  try {
    return await getJson<SemanticIndex>(tlEmbedKey(id));
  } catch {
    return null;
  }
}

// Re-aggregate per-bucket activity over an arbitrary [from, to] sub-range,
// reading only the shards that overlap it. Used to render a crisp oscilloscope
// at any zoom level (the manifest's agg is fixed over the full data range).
// Returns agg[bucket][serviceIndex] = [err, warn, other].
export async function aggregateRange(
  id: string,
  manifest: TimelineManifest,
  from: number,
  to: number,
  buckets: number,
): Promise<{ agg: number[][][]; total: number }> {
  const services = manifest.services;
  const idx = new Map(services.map((s, i) => [s, i]));
  const span = Math.max(1, to - from);
  const agg: number[][][] = Array.from({ length: buckets }, () =>
    Array.from({ length: services.length }, () => [0, 0, 0]),
  );
  let total = 0;
  for (let i = 0; i < manifest.shards.length; i++) {
    const s = manifest.shards[i];
    if (s.end < from || s.start > to) continue;
    const events = await loadShard(id, i).catch(() => [] as LogEvent[]);
    for (const e of events) {
      if (e.ts < from || e.ts > to) continue;
      const b = Math.min(buckets - 1, Math.floor(((e.ts - from) / span) * buckets));
      const si = idx.get(e.service);
      if (si === undefined) continue;
      const li =
        e.level === "ERROR" || e.level === "FATAL"
          ? 0
          : e.level === "WARN" || e.level === "WARNING"
            ? 1
            : 2;
      agg[b][si][li]++;
      total++;
    }
  }
  return { agg, total };
}

// Load every event between [from, to] (inclusive) by pulling only the shards
// whose time range overlaps the window.
export async function loadWindowEvents(
  id: string,
  manifest: TimelineManifest,
  from: number,
  to: number,
): Promise<LogEvent[]> {
  const out: LogEvent[] = [];
  for (let i = 0; i < manifest.shards.length; i++) {
    const s = manifest.shards[i];
    if (s.end < from || s.start > to) continue;
    const events = await loadShard(id, i).catch(() => [] as LogEvent[]);
    for (const e of events) {
      if (e.ts >= from && e.ts <= to) out.push(e);
    }
  }
  return out;
}

const RESTART_RE = /Abort handler is set up|This is AppHost|New run at|Server started/i;

function buildChapters(
  events: LogEvent[],
  agg: number[][][],
  startTs: number,
  span: number,
): TimelineChapter[] {
  const out: TimelineChapter[] = [];

  // Restarts — at most one per 30s window to avoid clutter.
  let lastRestart = -Infinity;
  for (const e of events) {
    if (RESTART_RE.test(e.message) && e.ts - lastRestart > 30_000) {
      out.push({ ts: e.ts, label: "Перезапуск", kind: "restart", service: e.service });
      lastRestart = e.ts;
    }
  }

  // Error storms — buckets whose error count is a strong local peak.
  const bucketErr = agg.map((b) => b.reduce((s, sv) => s + sv[0], 0));
  const total = bucketErr.reduce((s, v) => s + v, 0);
  const mean = total / Math.max(1, bucketErr.length);
  const threshold = Math.max(mean * 4, 20);
  const peaks: { idx: number; v: number }[] = [];
  for (let i = 0; i < bucketErr.length; i++) {
    if (bucketErr[i] >= threshold) peaks.push({ idx: i, v: bucketErr[i] });
  }
  peaks.sort((a, b) => b.v - a.v);
  for (const p of peaks.slice(0, 4)) {
    const ts = startTs + Math.round(((p.idx + 0.5) / agg.length) * span);
    out.push({ ts, label: "Всплеск ошибок", kind: "storm" });
  }

  return out
    .sort((a, b) => a.ts - b.ts)
    .filter((c, i, arr) => i === 0 || c.ts - arr[i - 1].ts > 1000)
    .slice(0, MAX_CHAPTERS);
}

async function buildSemanticIndex(
  events: LogEvent[],
  analysisId: string,
  settings?: EmbedSettings,
): Promise<boolean> {
  const seen = new Set<string>();
  const picked: SemanticIndex["items"] = [];
  for (const e of events) {
    if (e.level !== "ERROR" && e.level !== "FATAL" && e.level !== "WARN" && e.level !== "WARNING") {
      continue;
    }
    const sig = e.service + "|" + normSig(e.message);
    if (seen.has(sig)) continue;
    seen.add(sig);
    picked.push({
      ts: e.ts,
      seq: e.seq,
      service: e.service,
      level: e.level,
      text: `${e.service} ${e.level} ${e.message}`,
    });
    if (picked.length >= MAX_SEMANTIC) break;
  }
  if (picked.length === 0) return false;

  const vectors = await embedTexts(
    picked.map((p) => p.text),
    settings,
  );
  if (!vectors || vectors.length !== picked.length) return false;

  const index: SemanticIndex = { items: picked, vectors };
  await putJson(tlEmbedKey(analysisId), index);
  return true;
}
