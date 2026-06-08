import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { rules } from "@/db/schema";
import { invalidateRulesCache } from "@/lib/rules-registry";

export const dynamic = "force-dynamic";

const SEVERITIES = ["critical", "warning", "info", "noise"];
const SUBSYSTEMS = [
  "license",
  "cameras",
  "archive",
  "detectors",
  "network",
  "hardware",
  "other",
];

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof v === "string") {
    return v
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9а-я]+/giu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base || "rule"}-${suffix}`;
}

export async function GET() {
  const rows = await db.select().from(rules).orderBy(desc(rules.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.title) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }

  const matchComponent = body.matchComponent?.trim() || null;
  const matchAnyOf = toStringArray(body.matchAnyOf);
  const matchAllOf = toStringArray(body.matchAllOf);
  if (!matchComponent && !matchAnyOf.length && !matchAllOf.length) {
    return NextResponse.json(
      { error: "Нужно указать хотя бы одно условие: компонент, anyOf или allOf" },
      { status: 400 },
    );
  }

  const severity = SEVERITIES.includes(body.severity) ? body.severity : "warning";
  const subsystem = SUBSYSTEMS.includes(body.subsystem) ? body.subsystem : "other";
  const freq = Number(body.freqMinPerMinute);

  const [row] = await db
    .insert(rules)
    .values({
      key: body.key?.trim() || slugify(String(body.title)),
      severity,
      subsystem,
      title: String(body.title).trim(),
      matchComponent,
      matchAnyOf,
      matchAllOf,
      freqMinPerMinute: Number.isFinite(freq) && freq > 0 ? Math.round(freq) : null,
      cause: body.cause?.trim() || null,
      solution: toStringArray(body.solution),
      appliesTo: toStringArray(body.appliesTo),
      retrievalQuery: body.retrievalQuery?.trim() || null,
      enabled: body.enabled === false ? 0 : 1,
      source: body.source === "captured" ? "captured" : "manual",
    })
    .returning();
  invalidateRulesCache();
  return NextResponse.json(row, { status: 201 });
}
