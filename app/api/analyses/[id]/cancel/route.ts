import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { analyses } from "@/db/schema";

export const dynamic = "force-dynamic";

// Request cooperative cancellation. The worker checks this flag between stages
// (and between log files) and stops, marking the analysis as "cancelled".
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [row] = await db
    .select({ status: analyses.status })
    .from(analyses)
    .where(eq(analyses.id, id))
    .limit(1);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (row.status !== "processing" && row.status !== "queued") {
    return NextResponse.json({ ok: false, reason: "not running" });
  }
  await db
    .update(analyses)
    .set({ cancelRequested: 1, updatedAt: new Date() })
    .where(eq(analyses.id, id));
  return NextResponse.json({ ok: true });
}
