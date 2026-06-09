import { NextResponse } from "next/server";
import { loadManifest } from "@/lib/analyzer/timeline";
import type { TimelineOverview } from "@/lib/analyzer/types";

export const dynamic = "force-dynamic";

// Compact overview for the scrubber: time range, per-bucket activity, lanes and
// chapters. Shard layout is intentionally omitted from the client payload.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const manifest = await loadManifest(id);
  if (!manifest) {
    return NextResponse.json({ error: "timeline not built" }, { status: 404 });
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
