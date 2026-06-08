import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { analyses } from "@/db/schema";
import { deleteObject, deletePrefix } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [row] = await db.select().from(analyses).where(eq(analyses.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

// Delete the analysis record together with the uploaded bundle and any stored
// stage checkpoints. Storage cleanup is best-effort so the row is always removed.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [row] = await db
    .select({ storageKey: analyses.storageKey })
    .from(analyses)
    .where(eq(analyses.id, id))
    .limit(1);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (row.storageKey) {
    await deleteObject(row.storageKey).catch((e) =>
      console.warn(`Failed to delete bundle ${row.storageKey}:`, e),
    );
  }
  await deletePrefix(`checkpoints/${id}/`).catch((e) =>
    console.warn(`Failed to delete checkpoints for ${id}:`, e),
  );

  await db.delete(analyses).where(eq(analyses.id, id));
  return NextResponse.json({ ok: true });
}
