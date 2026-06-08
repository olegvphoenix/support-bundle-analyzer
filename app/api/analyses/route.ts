import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { analyses } from "@/db/schema";

export const dynamic = "force-dynamic";

// History list — lightweight columns only (no full report payload).
export async function GET() {
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
      createdAt: analyses.createdAt,
    })
    .from(analyses)
    .orderBy(desc(analyses.createdAt))
    .limit(100);
  return NextResponse.json(rows);
}
