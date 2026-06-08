import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { analyses } from "@/db/schema";
import { getAnalysisQueue } from "@/lib/queue";
import {
  STAGE_KEYS,
  canRestartFrom,
  stageStartProgress,
  type StageKey,
} from "@/lib/analyzer/stages";

export const dynamic = "force-dynamic";

// Re-run the analysis from a given stage, reusing checkpoints from earlier
// stages. Body: { fromStage: StageKey }. Defaults to a full re-run ("extract").
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { fromStage?: string };
  const fromStage = (body.fromStage ?? "extract") as StageKey;

  if (!STAGE_KEYS.includes(fromStage)) {
    return NextResponse.json({ error: "invalid stage" }, { status: 400 });
  }

  const [row] = await db
    .select({
      storageKey: analyses.storageKey,
      filename: analyses.filename,
      status: analyses.status,
      availableStages: analyses.availableStages,
    })
    .from(analyses)
    .where(eq(analyses.id, id))
    .limit(1);

  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!row.storageKey) {
    return NextResponse.json(
      { error: "archive unavailable for re-run" },
      { status: 409 },
    );
  }
  if (row.status === "processing" || row.status === "queued") {
    return NextResponse.json({ error: "already running" }, { status: 409 });
  }
  if (!canRestartFrom(fromStage, row.availableStages ?? [])) {
    return NextResponse.json(
      { error: "missing checkpoints for this stage" },
      { status: 409 },
    );
  }

  await db
    .update(analyses)
    .set({
      status: "queued",
      stage: "В очереди",
      progress: stageStartProgress(fromStage),
      error: null,
      cancelRequested: 0,
      updatedAt: new Date(),
    })
    .where(eq(analyses.id, id));

  await getAnalysisQueue().add("analyze", {
    analysisId: id,
    storageKey: row.storageKey,
    filename: row.filename,
    fromStage,
  });

  return NextResponse.json({ ok: true });
}
