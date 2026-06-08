import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { rules } from "@/db/schema";
import { invalidateRulesCache } from "@/lib/rules-registry";

export const dynamic = "force-dynamic";

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string")
    return v
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const freq = body.freqMinPerMinute !== undefined ? Number(body.freqMinPerMinute) : undefined;

  const [row] = await db
    .update(rules)
    .set({
      ...(body.key !== undefined ? { key: String(body.key).trim() } : {}),
      ...(body.severity !== undefined ? { severity: String(body.severity) } : {}),
      ...(body.subsystem !== undefined ? { subsystem: String(body.subsystem) } : {}),
      ...(body.title !== undefined ? { title: String(body.title).trim() } : {}),
      ...(body.matchComponent !== undefined
        ? { matchComponent: body.matchComponent?.trim() || null }
        : {}),
      ...(body.matchAnyOf !== undefined ? { matchAnyOf: toStringArray(body.matchAnyOf) } : {}),
      ...(body.matchAllOf !== undefined ? { matchAllOf: toStringArray(body.matchAllOf) } : {}),
      ...(freq !== undefined
        ? { freqMinPerMinute: Number.isFinite(freq) && freq > 0 ? Math.round(freq) : null }
        : {}),
      ...(body.cause !== undefined ? { cause: body.cause?.trim() || null } : {}),
      ...(body.solution !== undefined ? { solution: toStringArray(body.solution) } : {}),
      ...(body.appliesTo !== undefined ? { appliesTo: toStringArray(body.appliesTo) } : {}),
      ...(body.retrievalQuery !== undefined
        ? { retrievalQuery: body.retrievalQuery?.trim() || null }
        : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled ? 1 : 0 } : {}),
      updatedAt: new Date(),
    })
    .where(eq(rules.id, id))
    .returning();
  invalidateRulesCache();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await db.delete(rules).where(eq(rules.id, id));
  invalidateRulesCache();
  return NextResponse.json({ ok: true });
}
