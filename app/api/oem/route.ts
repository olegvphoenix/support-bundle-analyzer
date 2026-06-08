import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { oemProfiles } from "@/db/schema";
import { invalidateOemCache } from "@/lib/oem-registry";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db
    .select()
    .from(oemProfiles)
    .orderBy(desc(oemProfiles.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body?.product) {
    return NextResponse.json({ error: "product required" }, { status: 400 });
  }
  const [row] = await db
    .insert(oemProfiles)
    .values({
      product: String(body.product),
      brandKey: body.brandKey ?? null,
      headLog: body.headLog ?? null,
      versionPrefix: body.versionPrefix ?? null,
      family: body.family ?? null,
      active: body.active === false ? 0 : 1,
    })
    .returning();
  invalidateOemCache();
  return NextResponse.json(row, { status: 201 });
}
