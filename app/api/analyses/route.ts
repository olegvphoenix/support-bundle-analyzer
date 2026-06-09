import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { analyses } from "@/db/schema";

export const dynamic = "force-dynamic";

// History list — lightweight columns only (no full report payload).
// Supports ?storageKey=... to resolve the analysis id created after an upload.
export async function GET(req: Request) {
  const storageKey = new URL(req.url).searchParams.get("storageKey");
  if (storageKey) {
    const [row] = await db
      .select({ id: analyses.id })
      .from(analyses)
      .where(eq(analyses.storageKey, storageKey))
      .limit(1);
    return NextResponse.json(row ?? null);
  }
  const rows = await db
    .select({
      id: analyses.id,
      filename: analyses.filename,
      size: analyses.size,
      status: analyses.status,
      progress: analyses.progress,
      stage: analyses.stage,
      product: analyses.product,
      version: analyses.version,
      host: analyses.host,
      healthScore: analyses.healthScore,
      problemCount: analyses.problemCount,
      availableStages: analyses.availableStages,
      createdAt: analyses.createdAt,
    })
    .from(analyses)
    .orderBy(desc(analyses.createdAt))
    .limit(100);
  return NextResponse.json(rows);
}
