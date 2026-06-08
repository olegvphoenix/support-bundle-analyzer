import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { oemProfiles } from "@/db/schema";
import { invalidateOemCache } from "@/lib/oem-registry";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  const [row] = await db
    .update(oemProfiles)
    .set({
      ...(body.product !== undefined ? { product: String(body.product) } : {}),
      ...(body.brandKey !== undefined ? { brandKey: body.brandKey } : {}),
      ...(body.headLog !== undefined ? { headLog: body.headLog } : {}),
      ...(body.versionPrefix !== undefined ? { versionPrefix: body.versionPrefix } : {}),
      ...(body.family !== undefined ? { family: body.family } : {}),
      ...(body.active !== undefined ? { active: body.active ? 1 : 0 } : {}),
      updatedAt: new Date(),
    })
    .where(eq(oemProfiles.id, id))
    .returning();
  invalidateOemCache();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await db.delete(oemProfiles).where(eq(oemProfiles.id, id));
  invalidateOemCache();
  return NextResponse.json({ ok: true });
}
