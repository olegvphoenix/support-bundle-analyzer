import { NextResponse } from "next/server";
import { aggregateRange, loadManifest } from "@/lib/analyzer/timeline";
import type { TimelineOverview } from "@/lib/analyzer/types";

export const dynamic = "force-dynamic";

// Compact overview for the scrubber: time range, per-bucket activity, lanes and
// chapters. With optional ?from&to&buckets the activity is re-aggregated over
// that sub-range (for zoom). Shard layout is omitted from the client payload.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const manifest = await loadManifest(id);
  if (!manifest) {
    return NextResponse.json({ error: "timeline not built" }, { status: 404 });
  }

  const url = new URL(req.url);
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");

  if (fromRaw !== null && toRaw !== null) {
    const from = Math.max(manifest.startTs, Number(fromRaw));
    const to = Math.min(manifest.endTs, Number(toRaw));
    const buckets = Math.min(480, Math.max(40, Number(url.searchParams.get("buckets") ?? 240)));
    const { agg, total } = await aggregateRange(id, manifest, from, to, buckets);
    const overview: TimelineOverview = {
      startTs: from,
      endTs: to,
      totalEvents: total,
      truncated: manifest.truncated,
      services: manifest.services,
      buckets,
      agg,
      chapters: manifest.chapters.filter((c) => c.ts >= from && c.ts <= to),
    };
    return NextResponse.json({ ...overview, hasEmbeddings: manifest.hasEmbeddings });
  }

  const overview: TimelineOverview = {
    startTs: manifest.startTs,
    endTs: manifest.endTs,
    totalEvents: manifest.totalEvents,
    truncated: manifest.truncated,
    services: manifest.services,
    buckets: manifest.buckets,
    agg: manifest.agg,
    chapters: manifest.chapters,
  };
  return NextResponse.json({ ...overview, hasEmbeddings: manifest.hasEmbeddings });
}
