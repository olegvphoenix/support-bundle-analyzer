import { NextResponse } from "next/server";
import { loadManifest, loadWindowEvents } from "@/lib/analyzer/timeline";
import { loadSettings } from "@/lib/settings";
import { createRedactor } from "@/lib/analyzer/redact";
import type { LogEvent } from "@/lib/analyzer/types";

export const dynamic = "force-dynamic";

const SAMPLE = 120;

const SYSTEM = `Ты — старший инженер техподдержки систем видеонаблюдения AxxonOne/Axxon Next.
Тебе дают фрагмент объединённой ленты логов за выбранный интервал времени.
Объясни на русском, что произошло в этом окне: ключевые события, вероятная причина,
есть ли цепочка событий (что за чем последовало). Отвечай кратко: 3-6 предложений,
без вступлений. Опирайся только на предоставленные строки.`;

// Summarize what happened inside a selected time window. Uses the LLM when a
// key is configured; otherwise returns a deterministic statistical summary.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    from?: number;
    to?: number;
  };
  const manifest = await loadManifest(id);
  if (!manifest) {
    return NextResponse.json({ error: "timeline not built" }, { status: 404 });
  }
  const from = Number(body.from ?? manifest.startTs);
  const to = Number(body.to ?? manifest.endTs);

  let events = await loadWindowEvents(id, manifest, from, to);
  events.sort((a, b) => a.ts - b.ts || a.seq - b.seq);

  const settings = await loadSettings();
  const redactor = settings.maskPii ? createRedactor() : null;
  const red = (s: string) => (redactor ? redactor.redact(s) : s);

  const stats = summarize(events);

  // Prefer ERROR/WARN lines for the prompt, fill the rest with INFO.
  const important = events.filter(
    (e) => e.level === "ERROR" || e.level === "FATAL" || e.level === "WARN" || e.level === "WARNING",
  );
  const sample = (important.length ? important : events).slice(0, SAMPLE);

  const apiKey = settings.llmApiKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? null;
  if (!apiKey || sample.length === 0) {
    return NextResponse.json({ summary: heuristicSummary(stats, events), stats, llm: false });
  }

  try {
    const { generateText } = await import("ai");
    const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
    const google = createGoogleGenerativeAI({ apiKey });
    const lines = sample
      .map((e) => `${e.tsText} ${e.service} ${e.level} ${red(e.message)}`)
      .join("\n")
      .slice(0, 12000);
    const { text } = await generateText({
      model: google(settings.llmModel || "gemini-2.5-pro"),
      system: SYSTEM,
      prompt: `Интервал: ${new Date(from).toISOString()} — ${new Date(to).toISOString()}\nСобытий: ${events.length} (ошибок ${stats.errors}, предупр. ${stats.warns}).\n\nСтроки:\n${lines}`,
      temperature: 0.2,
    });
    return NextResponse.json({ summary: text.trim(), stats, llm: true });
  } catch (err) {
    console.error("Timeline explain failed:", err);
    return NextResponse.json({ summary: heuristicSummary(stats, events), stats, llm: false });
  }
}

interface WindowStats {
  total: number;
  errors: number;
  warns: number;
  byService: { service: string; errors: number; total: number }[];
  topErrors: { text: string; count: number }[];
}

function summarize(events: LogEvent[]): WindowStats {
  let errors = 0;
  let warns = 0;
  const svc = new Map<string, { errors: number; total: number }>();
  const errMsg = new Map<string, number>();
  for (const e of events) {
    const isErr = e.level === "ERROR" || e.level === "FATAL";
    const isWarn = e.level === "WARN" || e.level === "WARNING";
    if (isErr) errors++;
    if (isWarn) warns++;
    const s = svc.get(e.service) ?? { errors: 0, total: 0 };
    s.total++;
    if (isErr) s.errors++;
    svc.set(e.service, s);
    if (isErr) {
      const key = e.message.replace(/\d+/g, "#").slice(0, 100);
      errMsg.set(key, (errMsg.get(key) ?? 0) + 1);
    }
  }
  return {
    total: events.length,
    errors,
    warns,
    byService: [...svc.entries()]
      .map(([service, v]) => ({ service, ...v }))
      .sort((a, b) => b.errors - a.errors || b.total - a.total)
      .slice(0, 5),
    topErrors: [...errMsg.entries()]
      .map(([text, count]) => ({ text, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4),
  };
}

function heuristicSummary(stats: WindowStats, events: LogEvent[]): string {
  if (events.length === 0) return "В выбранном интервале событий нет.";
  const parts: string[] = [];
  parts.push(
    `В интервале ${events.length} событий: ${stats.errors} ошибок, ${stats.warns} предупреждений.`,
  );
  if (stats.byService.length) {
    const top = stats.byService[0];
    parts.push(`Больше всего активности в сервисе «${top.service}» (${top.total} строк, ${top.errors} ошибок).`);
  }
  if (stats.topErrors.length) {
    parts.push(`Частые ошибки: ${stats.topErrors.map((t) => `${t.text} (×${t.count})`).join("; ")}.`);
  }
  return parts.join(" ");
}
