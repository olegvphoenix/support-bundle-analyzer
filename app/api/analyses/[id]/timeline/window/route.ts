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
  const centerRaw = url.searchParams.get("center");
  const center = centerRaw !== null ? Number(centerRaw) : null;
  const services = parseCsv(url.searchParams.get("services"));
  const levels = parseCsv(url.searchParams.get("levels"));

  let events = await loadWindowEvents(id, manifest, from, to);
  if (services) events = events.filter((e) => services.has(e.service));
  if (levels) events = events.filter((e) => levels.has(normLevel(e.level)));
  events.sort((a, b) => a.ts - b.ts || a.seq - b.seq);

  const total = events.length;
  if (events.length > MAX_EVENTS) {
    if (center !== null) {
      // Keep the slice centered on the playhead so the current line is always
      // present, even when a same-timestamp storm dominates the window.
      let lo = 0;
      let hi = events.length;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (events[m].ts < center) lo = m + 1;
        else hi = m;
      }
      let s = lo - Math.floor(MAX_EVENTS / 2);
      if (s < 0) s = 0;
      let e = s + MAX_EVENTS;
      if (e > events.length) {
        e = events.length;
        s = e - MAX_EVENTS;
      }
      events = events.slice(s, e);
    } else {
      events = events.slice(0, MAX_EVENTS);
    }
  }

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
