import { NextResponse } from "next/server";
import { loadManifest, loadWindowEvents } from "@/lib/analyzer/timeline";
import { loadSettings } from "@/lib/settings";
import { createRedactor } from "@/lib/analyzer/redact";

export const dynamic = "force-dynamic";

const MAX_EVENTS = 6000;

// Verbatim events inside [from, to], optionally filtered by service / level.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const manifest = await loadManifest(id);
  if (!manifest) {
    return NextResponse.json({ error: "timeline not built" }, { status: 404 });
  }

  const from = Number(url.searchParams.get("from") ?? manifest.startTs);
  const to = Number(url.searchParams.get("to") ?? manifest.endTs);
  const services = parseCsv(url.searchParams.get("services"));
  const levels = parseCsv(url.searchParams.get("levels"));

  let events = await loadWindowEvents(id, manifest, from, to);
  if (services) events = events.filter((e) => services.has(e.service));
  if (levels) events = events.filter((e) => levels.has(normLevel(e.level)));
  events.sort((a, b) => a.ts - b.ts || a.seq - b.seq);

  const total = events.length;
  if (events.length > MAX_EVENTS) events = events.slice(0, MAX_EVENTS);

  const settings = await loadSettings();
  if (settings.maskPii) {
    const r = createRedactor();
    events = events.map((e) => ({
      ...e,
      message: r.redact(e.message),
      component: e.component ? r.redact(e.component) : e.component,
    }));
  }

  return NextResponse.json({ events, total, capped: total > MAX_EVENTS });
}

function parseCsv(v: string | null): Set<string> | null {
  if (!v) return null;
  const items = v.split(",").map((s) => s.trim()).filter(Boolean);
  return items.length ? new Set(items) : null;
}

function normLevel(level: string): string {
  if (level === "FATAL") return "ERROR";
  if (level === "WARNING") return "WARN";
  if (level === "ERROR" || level === "WARN") return level;
  return "INFO";
}
