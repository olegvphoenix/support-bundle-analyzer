import { NextResponse } from "next/server";
import {
  loadManifest,
  loadShard,
  loadSemanticIndex,
} from "@/lib/analyzer/timeline";
import { embedQuery, cosine } from "@/lib/analyzer/embeddings";
import { loadSettings } from "@/lib/settings";
import { createRedactor } from "@/lib/analyzer/redact";
import type { LogEvent, SearchMode, TimelineMatch } from "@/lib/analyzer/types";

export const dynamic = "force-dynamic";

const MAX_MATCHES = 500;

// Find points in the stream matching a query. Three modes:
//   keyword  — case-insensitive substring over message/service
//   regex    — user-supplied regular expression over message
//   semantic — cosine similarity over precomputed event embeddings
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const mode = (url.searchParams.get("mode") ?? "keyword") as SearchMode;
  if (!q) return NextResponse.json({ matches: [], mode });

  const manifest = await loadManifest(id);
  if (!manifest) {
    return NextResponse.json({ error: "timeline not built" }, { status: 404 });
  }

  const settings = await loadSettings();
  const redactor = settings.maskPii ? createRedactor() : null;
  const snip = (s: string) =>
    (redactor ? redactor.redact(s) : s).slice(0, 200);

  if (mode === "semantic" && manifest.hasEmbeddings) {
    const index = await loadSemanticIndex(id);
    const vec = await embedQuery(q, { apiKey: settings.llmApiKey });
    if (index && vec) {
      const scored = index.items
        .map((it, i) => ({ it, score: cosine(vec, index.vectors[i]) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 60)
        .filter((x) => x.score > 0.2);
      const matches: TimelineMatch[] = scored.map(({ it, score }) => ({
        ts: it.ts,
        seq: it.seq,
        service: it.service,
        level: it.level,
        snippet: snip(it.text),
        score: Math.round(score * 100) / 100,
      }));
      return NextResponse.json({ matches, mode, semantic: true });
    }
    // fall through to keyword if embeddings/query unavailable
  }

  let test: (e: LogEvent) => boolean;
  if (mode === "regex") {
    let re: RegExp;
    try {
      re = new RegExp(q, "i");
    } catch {
      return NextResponse.json({ error: "invalid regex", matches: [] }, { status: 400 });
    }
    test = (e) => re.test(e.message);
  } else {
    const needle = q.toLowerCase();
    test = (e) =>
      e.message.toLowerCase().includes(needle) ||
      e.service.toLowerCase().includes(needle);
  }

  const matches: TimelineMatch[] = [];
  for (let i = 0; i < manifest.shards.length && matches.length < MAX_MATCHES; i++) {
    const events = await loadShard(id, i).catch(() => [] as LogEvent[]);
    for (const e of events) {
      if (test(e)) {
        matches.push({
          ts: e.ts,
          seq: e.seq,
          service: e.service,
          level: e.level,
          snippet: snip(e.message),
        });
        if (matches.length >= MAX_MATCHES) break;
      }
    }
  }

  return NextResponse.json({ matches, mode, semantic: false });
}
