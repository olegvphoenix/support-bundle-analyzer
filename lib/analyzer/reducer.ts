import type { AggregatedSignature, LogRecord } from "./types";
import { extractEntities } from "./entities";

// Tokens that vary between otherwise-identical log lines; stripped to build a
// stable signature so repeated errors collapse into one group.
const NORMALIZERS: [RegExp, string][] = [
  [/0x[0-9a-fA-F]+/g, "<ptr>"],
  [/\b[0-9A-F]{8,}\b/g, "<hex>"],
  [/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?/g, "<addr>"],
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<guid>"],
  [/\b\d{4}-\d{2}-\d{2}\b/g, "<date>"],
  [/\b\d+\b/g, "<n>"],
];

function makeSignature(rec: LogRecord): string {
  let msg = rec.message.split("\n")[0];
  for (const [re, repl] of NORMALIZERS) msg = msg.replace(re, repl);
  msg = msg.trim().slice(0, 200);
  return `${rec.level}|${rec.component ?? ""}|${msg}`;
}

function minuteKey(ts: string | null): string | null {
  if (!ts) return null;
  // "2026-05-07 15:48:27.155" -> "2026-05-07 15:48"
  return ts.slice(0, 16);
}

interface Acc {
  signature: string;
  level: string | null;
  component: string | null;
  sampleMessage: string;
  files: Set<string>;
  count: number;
  firstTs: string | null;
  lastTs: string | null;
  addresses: Set<string>;
  entities: Set<string>;
  perMinute: Map<string, number>;
}

/**
 * Streaming aggregator. Feed records one at a time, then call `finish()`.
 * Only ERROR/WARN (and unknown) levels are aggregated for signal extraction;
 * the caller decides which levels to feed.
 */
export class Reducer {
  private map = new Map<string, Acc>();

  add(rec: LogRecord): void {
    const sig = makeSignature(rec);
    let acc = this.map.get(sig);
    if (!acc) {
      acc = {
        signature: sig,
        level: rec.level,
        component: rec.component,
        sampleMessage: rec.message.split("\n")[0].slice(0, 500),
        files: new Set(),
        count: 0,
        firstTs: rec.ts,
        lastTs: rec.ts,
        addresses: new Set(),
        entities: new Set(),
        perMinute: new Map(),
      };
      this.map.set(sig, acc);
    }
    acc.count++;
    acc.files.add(rec.file);
    if (rec.address) acc.addresses.add(rec.address);
    for (const e of extractEntities(rec)) acc.entities.add(e);
    if (rec.ts) {
      if (!acc.firstTs || rec.ts < acc.firstTs) acc.firstTs = rec.ts;
      if (!acc.lastTs || rec.ts > acc.lastTs) acc.lastTs = rec.ts;
      const mk = minuteKey(rec.ts);
      if (mk) acc.perMinute.set(mk, (acc.perMinute.get(mk) ?? 0) + 1);
    }
  }

  finish(stormThreshold = 30): AggregatedSignature[] {
    const out: AggregatedSignature[] = [];
    for (const acc of this.map.values()) {
      let peak = 0;
      for (const v of acc.perMinute.values()) if (v > peak) peak = v;
      out.push({
        signature: acc.signature,
        level: acc.level,
        component: acc.component,
        sampleMessage: acc.sampleMessage,
        files: [...acc.files],
        count: acc.count,
        firstTs: acc.firstTs,
        lastTs: acc.lastTs,
        addresses: [...acc.addresses],
        entities: [...acc.entities],
        storm: peak >= stormThreshold,
        peakPerMinute: peak,
      });
    }
    // Most frequent first.
    out.sort((a, b) => b.count - a.count);
    return out;
  }
}
