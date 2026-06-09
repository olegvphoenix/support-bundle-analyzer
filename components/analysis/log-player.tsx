"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Eye,
  EyeOff,
  Filter,
  Headphones,
  Loader2,
  Maximize2,
  Menu,
  MessageSquare,
  Pause,
  Play,
  Scan,
  Search,
  Settings,
  SkipBack,
  SkipForward,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { apiPath } from "@/lib/utils";
import type {
  LogEvent,
  SearchMode,
  TimelineChapter,
  TimelineMatch,
} from "@/lib/analyzer/types";

// ---------------------------------------------------------------------------
// Log player — a "video player" for logs. Merges every service log into one
// time-ordered stream; the scrubber shows per-service activity, the playhead
// scans through time, and the console shows verbatim lines. Matches
// design-mockups/log-player-prototype.png.
// ---------------------------------------------------------------------------

interface Overview {
  startTs: number;
  endTs: number;
  totalEvents: number;
  truncated: boolean;
  services: string[];
  buckets: number;
  agg: number[][][];
  chapters: TimelineChapter[];
  hasEmbeddings: boolean;
}

const LANE_COLORS = [
  "#3b82f6",
  "#38bdf8",
  "#22d3ee",
  "#f59e0b",
  "#fb923c",
  "#22c55e",
  "#a78bfa",
  "#f472b6",
  "#94a3b8",
];

const SPEEDS = [1, 5, 10, 50, 100];
const WINDOW_MS = 5 * 60_000; // page size for verbatim fetches
const SILENCE_MS = 1500;
const LANE_LIMIT = 8; // keep the scrubber readable; rest behind a toggle

const LEVEL_COLOR: Record<string, string> = {
  ERROR: "var(--sev-critical)",
  FATAL: "var(--sev-critical)",
  WARN: "var(--sev-warning)",
  WARNING: "var(--sev-warning)",
  INFO: "var(--muted)",
};

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

// Events were normalized as UTC at build time; render them back in UTC so the
// console matches the original log timestamps exactly.
function fmtClock(ms: number, withMs = false): string {
  const d = new Date(ms);
  const base = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return withMs ? `${base}.${pad(d.getUTCMilliseconds(), 3)}` : base;
}

function levelKey(level: string): "ERROR" | "WARN" | "INFO" {
  if (level === "ERROR" || level === "FATAL") return "ERROR";
  if (level === "WARN" || level === "WARNING") return "WARN";
  return "INFO";
}

// Find the smallest contiguous time window that still contains the bulk of the
// activity. This focuses the default view on the dense region even when a few
// sparse events are scattered across a much longer total span.
function computeFocus(o: Overview): { start: number; end: number } {
  const full = { start: o.startTs, end: o.endTs };
  const totals = o.agg.map((b) =>
    b.reduce((s, sv) => s + sv[0] + sv[1] + sv[2], 0),
  );
  const total = totals.reduce((s, v) => s + v, 0);
  if (total === 0) return full;
  const span = Math.max(1, o.endTs - o.startTs);
  const tsOf = (bucket: number) => o.startTs + (bucket / o.buckets) * span;

  // Two-pointer: minimal [i, j] bucket window whose sum covers `coverage`.
  const coverage = total * 0.9;
  let best: [number, number] | null = null;
  let sum = 0;
  let i = 0;
  for (let j = 0; j < totals.length; j++) {
    sum += totals[j];
    while (sum - totals[i] >= coverage) {
      sum -= totals[i];
      i++;
    }
    if (sum >= coverage) {
      if (!best || j - i < best[1] - best[0]) best = [i, j];
    }
  }
  if (!best) return full;

  const pad = (best[1] - best[0] + 1) * ((o.endTs - o.startTs) / o.buckets) * 0.15;
  let start = Math.max(o.startTs, tsOf(best[0]) - pad);
  let end = Math.min(o.endTs, tsOf(best[1] + 1) + pad);
  if (end - start < 5000) {
    const mid = (start + end) / 2;
    start = Math.max(o.startTs, mid - 2500);
    end = Math.min(o.endTs, mid + 2500);
  }
  return { start, end };
}

export function LogPlayer({
  id,
  title,
  version,
}: {
  id: string;
  title?: string;
  version?: string | null;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [showFilters, setShowFilters] = useState(true);

  // Full-range overview (stable lane order + chapters + activity distribution).
  const { data: ovFull, isLoading } = useQuery<Overview>({
    queryKey: ["timeline-overview", id],
    queryFn: async () => {
      const res = await fetch(apiPath(`/api/analyses/${id}/timeline/overview`));
      if (!res.ok) throw new Error("no timeline");
      return res.json();
    },
  });

  // Current zoom window. Defaults to the active range once the overview loads.
  const [view, setView] = useState<{ start: number; end: number } | null>(null);
  useEffect(() => {
    if (ovFull && !view) setView(computeFocus(ovFull));
  }, [ovFull, view]);

  // Re-aggregated overview for the current zoom window (crisp oscilloscope).
  const { data: ovView } = useQuery<Overview>({
    queryKey: ["timeline-overview-view", id, view?.start, view?.end],
    enabled: !!ovFull && !!view,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const u = new URLSearchParams({
        from: String(view!.start),
        to: String(view!.end),
        buckets: "240",
      });
      const res = await fetch(apiPath(`/api/analyses/${id}/timeline/overview?${u}`));
      if (!res.ok) throw new Error("view overview failed");
      return res.json();
    },
  });

  // Active overview used for rendering (zoomed when available).
  const ov = ovView ?? ovFull;

  // ---- player state ----
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [skipSilence, setSkipSilence] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);

  // ---- filters ----
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [solo, setSolo] = useState<Set<string>>(new Set());
  const [levels, setLevels] = useState({ ERROR: true, WARN: true, INFO: false });
  const [showAllLanes, setShowAllLanes] = useState(false);

  // Services are activity-sorted by the builder; only show the busiest lanes by
  // default so the scrubber matches the design instead of a wall of thin rows.
  const laneServices = useMemo(() => {
    const all = ov ? ov.services.map((s, i) => ({ s, i })) : [];
    return showAllLanes ? all : all.slice(0, LANE_LIMIT);
  }, [ov, showAllLanes]);
  const hiddenLaneCount = ov ? Math.max(0, ov.services.length - LANE_LIMIT) : 0;

  // ---- search ----
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("keyword");
  const [matches, setMatches] = useState<TimelineMatch[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Rendered (view) range; full range is used for zoom clamping / "fit".
  const startTs = ov?.startTs ?? 0;
  const endTs = ov?.endTs ?? 0;
  const span = Math.max(1, endTs - startTs);
  const fullStart = ovFull?.startTs ?? 0;
  const fullEnd = ovFull?.endTs ?? 0;

  useEffect(() => {
    if (view && playhead === null) setPlayhead(view.start);
  }, [view, playhead]);

  // Visible services = lanes that aren't muted; solo overrides mute.
  const visibleServices = useMemo(() => {
    if (!ov) return new Set<string>();
    if (solo.size) return solo;
    return new Set(ov.services.filter((s) => !muted.has(s)));
  }, [ov, muted, solo]);

  const activeLevels = useMemo(
    () => (Object.keys(levels) as (keyof typeof levels)[]).filter((k) => levels[k]),
    [levels],
  );

  // ---- windowed verbatim fetch around the playhead ----
  const windowStart = playhead !== null ? Math.floor(playhead / WINDOW_MS) * WINDOW_MS : 0;
  const winFrom = windowStart - 30_000;
  const winTo = windowStart + WINDOW_MS + 30_000;
  const svcParam = [...visibleServices].sort().join(",");
  const lvlParam = activeLevels.join(",");

  const { data: win } = useQuery<{ events: LogEvent[]; total: number; capped: boolean }>({
    queryKey: ["timeline-window", id, winFrom, winTo, svcParam, lvlParam],
    enabled: playhead !== null && !!ov,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const u = new URLSearchParams({
        from: String(winFrom),
        to: String(winTo),
        services: svcParam,
        levels: lvlParam,
      });
      const res = await fetch(apiPath(`/api/analyses/${id}/timeline/window?${u}`));
      if (!res.ok) throw new Error("window failed");
      return res.json();
    },
  });

  const windowEvents = win?.events ?? [];

  // All ERROR positions (for prev/next-error transport + default ticks).
  const { data: errMarks } = useQuery<{ events: LogEvent[] }>({
    queryKey: ["timeline-errors", id],
    enabled: !!ovFull,
    queryFn: async () => {
      const u = new URLSearchParams({
        from: String(ovFull!.startTs),
        to: String(ovFull!.endTs),
        levels: "ERROR",
      });
      const res = await fetch(apiPath(`/api/analyses/${id}/timeline/window?${u}`));
      if (!res.ok) throw new Error("err marks failed");
      return res.json();
    },
  });
  const errorTimes = useMemo(
    () => (errMarks?.events ?? []).map((e) => e.ts).sort((a, b) => a - b),
    [errMarks],
  );

  // ---- playback loop (throttled state updates) ----
  const phRef = useRef<number | null>(playhead);
  phRef.current = playhead;
  const winEventsRef = useRef<LogEvent[]>(windowEvents);
  winEventsRef.current = windowEvents;

  useEffect(() => {
    if (!playing || !ov) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      let ph = (phRef.current ?? ov.startTs) + dt * speed;

      if (skipSilence) {
        const evs = winEventsRef.current;
        const next = evs.find((e) => e.ts > (phRef.current ?? 0));
        if (next && next.ts - ph > SILENCE_MS) ph = next.ts;
      }
      if (ph >= ov.endTs) {
        ph = ov.endTs;
        phRef.current = ph;
        setPlayhead(ph);
        setPlaying(false);
        return;
      }
      phRef.current = ph;
      acc += dt;
      if (acc >= 50) {
        acc = 0;
        setPlayhead(ph);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, skipSilence, ov]);

  // ---- search ----
  const runSearch = useCallback(async () => {
    if (!query.trim()) {
      setMatches(null);
      return;
    }
    setSearching(true);
    try {
      const u = new URLSearchParams({ q: query, mode });
      const res = await fetch(apiPath(`/api/analyses/${id}/timeline/search?${u}`));
      const json = await res.json();
      setMatches(json.matches ?? []);
    } finally {
      setSearching(false);
    }
  }, [query, mode, id]);

  // Re-run an existing search when the mode changes so the pill stays in sync.
  useEffect(() => {
    if (matches !== null && query.trim()) runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const seek = useCallback((ts: number) => {
    phRef.current = ts;
    setPlayhead(ts);
  }, []);

  // ---- zoom / pan ----
  const setViewClamped = useCallback(
    (start: number, end: number) => {
      if (!ovFull) return;
      const minSpan = 1000; // 1s floor
      let s = start;
      let e = end;
      if (e - s < minSpan) e = s + minSpan;
      if (s < fullStart) {
        e += fullStart - s;
        s = fullStart;
      }
      if (e > fullEnd) {
        s -= e - fullEnd;
        e = fullEnd;
      }
      s = Math.max(fullStart, s);
      e = Math.min(fullEnd, e);
      setView({ start: s, end: e });
    },
    [ovFull, fullStart, fullEnd],
  );

  const zoomAt = useCallback(
    (centerTs: number, factor: number) => {
      if (!view) return;
      const curSpan = view.end - view.start;
      const maxSpan = fullEnd - fullStart;
      let ns = curSpan * factor;
      ns = Math.min(maxSpan, Math.max(1000, ns));
      const ratio = curSpan > 0 ? (centerTs - view.start) / curSpan : 0.5;
      setViewClamped(centerTs - ratio * ns, centerTs - ratio * ns + ns);
    },
    [view, fullStart, fullEnd, setViewClamped],
  );

  const fitActivity = useCallback(() => {
    if (ovFull) setViewClamped(computeFocus(ovFull).start, computeFocus(ovFull).end);
  }, [ovFull, setViewClamped]);

  const fitFull = useCallback(() => {
    if (ovFull) setView({ start: ovFull.startTs, end: ovFull.endTs });
  }, [ovFull]);

  const panBy = useCallback(
    (fraction: number) => {
      if (!view) return;
      const d = (view.end - view.start) * fraction;
      setViewClamped(view.start + d, view.end + d);
    },
    [view, setViewClamped],
  );

  // Live drag-pan: translate the timeline content, commit the new view on release.
  const [panPx, setPanPx] = useState(0);
  const dragRef = useRef<{ x: number; width: number; moved: boolean } | null>(null);
  const wheelTsRef = useRef(0);

  const isZoomed = !!(view && ovFull && view.end - view.start < fullEnd - fullStart - 1);

  const jumpError = useCallback(
    (dir: 1 | -1) => {
      if (!errorTimes.length || playhead === null) return;
      if (dir === 1) {
        const n = errorTimes.find((t) => t > playhead + 1);
        if (n !== undefined) seek(n);
      } else {
        let prev: number | undefined;
        for (const t of errorTimes) {
          if (t < playhead - 1) prev = t;
          else break;
        }
        if (prev !== undefined) seek(prev);
      }
    },
    [errorTimes, playhead, seek],
  );

  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  }, []);

  const colorOf = useCallback(
    (service: string) => {
      const idx = ov ? ov.services.indexOf(service) : 0;
      return LANE_COLORS[idx % LANE_COLORS.length];
    },
    [ov],
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--muted)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Загрузка ленты событий…
      </div>
    );
  }
  if (!ov) {
    return (
      <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
        Лента событий для этого анализа ещё не построена. Перезапустите анализ с
        этапа «Лента событий».
      </div>
    );
  }

  const ph = playhead ?? startTs;
  const phPct = ((ph - startTs) / span) * 100;
  // Ticks mark search hits only; error positions are already visible as the red
  // oscilloscope (showing every error as a white line turns into a solid block).
  const tickTimes = matches?.length ? matches.map((m) => m.ts) : [];

  return (
    <div
      ref={rootRef}
      className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)]"
    >
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <button
          onClick={() => setShowFilters((v) => !v)}
          className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
          aria-label="Фильтры"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h3 className="text-base font-semibold">
          {title || "Проигрыватель логов"}
        </h3>
        {version && (
          <span className="rounded-md bg-[var(--surface-2)] px-2 py-0.5 text-xs text-[var(--muted)]">
            {version}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]">
            <Settings className="h-4 w-4" />
          </button>
          <button
            onClick={toggleFullscreen}
            className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex">
        {/* Left filters sidebar */}
        {showFilters && (
          <aside className="w-56 shrink-0 space-y-5 border-r border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Filter className="h-4 w-4 text-[var(--muted)]" /> Фильтры
            </div>

            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                Сервисы
              </div>
              <div className="space-y-1">
                {laneServices.map(({ s }) => {
                  const isMuted = muted.has(s) && !solo.has(s);
                  const isSolo = solo.has(s);
                  return (
                    <div
                      key={s}
                      className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-[var(--surface-2)]"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: colorOf(s) }}
                      />
                      <span
                        className={`flex-1 truncate ${isMuted ? "text-[var(--muted)] line-through" : ""}`}
                        title={s}
                      >
                        {s}
                      </span>
                      <button
                        onClick={() =>
                          setMuted((prev) => {
                            const n = new Set(prev);
                            n.has(s) ? n.delete(s) : n.add(s);
                            return n;
                          })
                        }
                        className="text-[var(--muted)] hover:text-[var(--foreground)]"
                        title={isMuted ? "Показать" : "Скрыть"}
                      >
                        {isMuted ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() =>
                          setSolo((prev) => {
                            const n = new Set(prev);
                            n.has(s) ? n.delete(s) : n.add(s);
                            return n;
                          })
                        }
                        className={isSolo ? "text-[var(--primary)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"}
                        title="Solo"
                      >
                        <Headphones className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
                {hiddenLaneCount > 0 && (
                  <button
                    onClick={() => setShowAllLanes((v) => !v)}
                    className="px-1.5 py-1 text-xs text-[var(--primary)] hover:underline"
                  >
                    {showAllLanes ? "Свернуть" : `Показать все (${hiddenLaneCount})`}
                  </button>
                )}
              </div>
            </div>

            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                Уровни
              </div>
              <div className="space-y-1.5">
                {(["ERROR", "WARN", "INFO"] as const).map((lv) => (
                  <div key={lv} className="flex items-center gap-2 px-1.5 py-0.5 text-sm">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: LEVEL_COLOR[lv] }}
                    />
                    <span className="flex-1">{lv}</span>
                    <Toggle
                      on={levels[lv]}
                      onClick={() => setLevels((p) => ({ ...p, [lv]: !p[lv] }))}
                    />
                  </div>
                ))}
              </div>
            </div>
          </aside>
        )}

        {/* Center column */}
        <div className="min-w-0 flex-1 p-4">
          {/* Search row — single integrated bar (matches the mockup) */}
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] py-1.5 pl-3 pr-2 transition-colors focus-within:border-[var(--primary)]">
            <Search className="h-4 w-4 shrink-0 text-[var(--muted)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              placeholder="Поиск по логам…"
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]"
            />
            {(searching || matches !== null) && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[var(--primary)]/15 px-2.5 py-1 text-xs font-medium text-[var(--primary)]">
                {searching ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  `${matches!.length} совпадений`
                )}
              </span>
            )}
            <span className="h-5 w-px shrink-0 bg-[var(--border)]" />
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as SearchMode)}
              className="shrink-0 cursor-pointer bg-transparent pr-1 text-sm text-[var(--foreground)] outline-none"
            >
              <option value="keyword">Подстрока</option>
              <option value="regex">Regex</option>
              <option value="semantic" disabled={!ov.hasEmbeddings}>
                Семантический
              </option>
            </select>
          </div>

          {/* Timeline */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
            {/* Zoom toolbar */}
            <div className="mb-2 flex items-center gap-1 text-[var(--muted)]">
              <span className="mr-auto text-xs">
                {fmtClock(startTs)} – {fmtClock(endTs)}
                {isZoomed && (
                  <span className="ml-2 text-[var(--primary)]">увеличено</span>
                )}
              </span>
              <ZoomBtn title="Влево" onClick={() => panBy(-0.25)}>
                <ChevronLeft className="h-4 w-4" />
              </ZoomBtn>
              <ZoomBtn title="Уменьшить" onClick={() => zoomAt((startTs + endTs) / 2, 1 / 0.6)}>
                <ZoomOut className="h-4 w-4" />
              </ZoomBtn>
              <ZoomBtn title="Увеличить" onClick={() => zoomAt((startTs + endTs) / 2, 0.6)}>
                <ZoomIn className="h-4 w-4" />
              </ZoomBtn>
              <ZoomBtn title="Вправо" onClick={() => panBy(0.25)}>
                <ChevronRight className="h-4 w-4" />
              </ZoomBtn>
              <ZoomBtn title="К активности" onClick={fitActivity}>
                <Crosshair className="h-4 w-4" />
              </ZoomBtn>
              <ZoomBtn title="Весь период" onClick={fitFull}>
                <Scan className="h-4 w-4" />
              </ZoomBtn>
            </div>

            <ChapterRow chapters={ov.chapters} startTs={startTs} span={span} />

            <div
              className="relative mt-2 cursor-crosshair select-none overflow-hidden"
              onWheel={(e) => {
                const now = performance.now();
                if (now - wheelTsRef.current < 70) return;
                wheelTsRef.current = now;
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = (e.clientX - rect.left) / rect.width;
                const centerTs = startTs + Math.max(0, Math.min(1, ratio)) * span;
                zoomAt(centerTs, e.deltaY > 0 ? 1 / 0.8 : 0.8);
              }}
              onPointerDown={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                dragRef.current = { x: e.clientX, width: rect.width, moved: false };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const d = dragRef.current;
                if (!d) return;
                const dx = e.clientX - d.x;
                if (Math.abs(dx) > 3) d.moved = true;
                if (d.moved) setPanPx(dx);
              }}
              onPointerUp={(e) => {
                const d = dragRef.current;
                dragRef.current = null;
                const rect = e.currentTarget.getBoundingClientRect();
                if (d?.moved) {
                  const deltaTs = -(panPx / d.width) * span;
                  setViewClamped(startTs + deltaTs, endTs + deltaTs);
                  setPanPx(0);
                } else {
                  const x = (e.clientX - rect.left) / rect.width;
                  seek(startTs + Math.max(0, Math.min(1, x)) * span);
                }
              }}
            >
              <div style={{ transform: panPx ? `translateX(${panPx}px)` : undefined }}>
              <LaneStack
                lanes={laneServices.filter(({ s }) => visibleServices.has(s))}
                agg={ov.agg}
                buckets={ov.buckets}
                colorOf={colorOf}
                levels={levels}
              />

              {/* Search / error tick marks (only those inside the view) */}
              <div className="pointer-events-none absolute inset-0">
                {tickTimes
                  .filter((t) => t >= startTs && t <= endTs)
                  .map((t, i) => (
                    <span
                      key={i}
                      className="absolute top-0 h-full w-px bg-white/70"
                      style={{ left: `${((t - startTs) / span) * 100}%` }}
                    />
                  ))}
              </div>

              {/* Playhead */}
              <div
                className="pointer-events-none absolute top-0 z-10 h-full w-0.5 bg-[var(--primary)]"
                style={{ left: `${phPct}%` }}
              >
                <span className="absolute -left-[7px] -top-1.5 h-4 w-4 rounded-full border-2 border-[var(--background)] bg-[var(--primary)]" />
              </div>
              </div>
            </div>

            <AxisRow startTs={startTs} span={span} />
          </div>

          {/* Transport */}
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={() => setPlaying((p) => !p)}
              className="grid h-11 w-11 place-items-center rounded-lg bg-[var(--primary)] text-white hover:opacity-90"
            >
              {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </button>
            <button
              onClick={() => jumpError(-1)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm hover:bg-[var(--surface-2)]"
            >
              <SkipBack className="h-4 w-4" /> пред. ошибка
            </button>
            <button
              onClick={() => jumpError(1)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm hover:bg-[var(--surface-2)]"
            >
              <SkipForward className="h-4 w-4" /> след. ошибка
            </button>
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="input w-20"
            >
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}x
                </option>
              ))}
            </select>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 font-mono text-lg tracking-wide">
              {fmtClock(ph, true)}
            </div>
            <div className="ml-auto flex items-center gap-2 text-sm text-[var(--muted)]">
              Пропуск тишины
              <Toggle on={skipSilence} onClick={() => setSkipSilence((v) => !v)} />
            </div>
          </div>

          {/* Console */}
          <Console
            events={windowEvents}
            playhead={ph}
            autoScroll={autoScroll}
            colorOf={colorOf}
            onSeek={seek}
          />

          {/* Console footer */}
          <div className="mt-2 flex items-center gap-3 text-xs text-[var(--muted)]">
            <span className="inline-flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full ${autoScroll ? "bg-[var(--sev-ok)]" : "bg-[var(--muted)]"}`}
              />
              Автопрокрутка {autoScroll ? "включена" : "выключена"}
            </span>
            <button
              onClick={() => setAutoScroll((v) => !v)}
              className="text-[var(--primary)] hover:underline"
            >
              {autoScroll ? "Приостановить" : "Возобновить"}
            </button>
            <span className="ml-auto">
              {matches
                ? `Найдено ${matches.length} совпадений`
                : `${win?.total ?? windowEvents.length} событий в окне${win?.capped ? " (показаны первые)" : ""}`}
            </span>
            <button
              onClick={() => seek(endTs)}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 hover:bg-[var(--surface-2)]"
            >
              <ArrowDown className="h-3 w-3" /> Перейти к концу
            </button>
          </div>
        </div>

        {/* Right AI panel */}
        <AiPanel id={id} from={winFrom} to={winTo} playhead={ph} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const LaneStack = memo(function LaneStack({
  lanes,
  agg,
  buckets,
  colorOf,
  levels,
}: {
  lanes: { s: string; i: number }[];
  agg: number[][][];
  buckets: number;
  colorOf: (s: string) => string;
  levels: { ERROR: boolean; WARN: boolean; INFO: boolean };
}) {
  if (lanes.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center text-xs text-[var(--muted)]">
        Все сервисы скрыты — включите их в фильтрах слева.
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {lanes.map(({ s, i }) => (
        <div key={s} className="flex items-center gap-2">
          <div
            className="w-28 shrink-0 truncate text-right text-xs text-[var(--muted)]"
            title={s}
          >
            {s}
          </div>
          <Lane
            agg={agg}
            serviceIndex={i}
            buckets={buckets}
            color={colorOf(s)}
            levels={levels}
          />
        </div>
      ))}
    </div>
  );
});

// One service lane drawn as a centered "oscilloscope" of bucket activity.
const Lane = memo(function Lane({
  agg,
  serviceIndex,
  buckets,
  color,
  levels,
}: {
  agg: number[][][];
  serviceIndex: number;
  buckets: number;
  color: string;
  levels: { ERROR: boolean; WARN: boolean; INFO: boolean };
}) {
  let max = 1;
  const cells: { h: number; c: string }[] = [];
  for (let b = 0; b < buckets; b++) {
    const cell = agg[b]?.[serviceIndex] ?? [0, 0, 0];
    const err = levels.ERROR ? cell[0] : 0;
    const warn = levels.WARN ? cell[1] : 0;
    const other = levels.INFO ? cell[2] : 0;
    const total = err + warn + other;
    if (total > max) max = total;
    const c = err > 0 ? "var(--sev-critical)" : warn > 0 ? "var(--sev-warning)" : color;
    cells.push({ h: total, c });
  }
  const logMax = Math.log1p(max);
  return (
    <div className="relative flex h-11 flex-1 items-center gap-px overflow-hidden rounded bg-[var(--surface-2)]/40 px-px">
      {/* Resting baseline so quiet lanes still read as an oscilloscope track. */}
      <span className="pointer-events-none absolute left-0 right-0 top-1/2 h-px bg-[var(--border)]" />
      {cells.map((cell, i) => {
        const ratio = cell.h > 0 ? Math.log1p(cell.h) / logMax : 0;
        const h = cell.h > 0 ? Math.max(14, ratio * 100) : 0;
        return (
          <span
            key={i}
            className="relative z-[1] flex-1 rounded-[1px]"
            style={{
              height: `${h}%`,
              minWidth: 0,
              background: cell.c,
              opacity: cell.h > 0 ? 0.95 : 0,
            }}
          />
        );
      })}
    </div>
  );
});

const CHAPTER_MERGE_GAP = 2.5; // percent of width; markers this close become one

const CHAPTER_PRIORITY: Record<string, number> = { storm: 0, restart: 1, entity: 2, ai: 3 };

function ChapterRow({
  chapters,
  startTs,
  span,
}: {
  chapters: TimelineChapter[];
  startTs: number;
  span: number;
}) {
  const flagColor: Record<string, string> = {
    restart: "#a78bfa",
    storm: "var(--sev-critical)",
    entity: "var(--sev-warning)",
    ai: "var(--primary)",
  };

  // Merge markers at (almost) the same position into one labelled cluster.
  const clusters = useMemo(() => {
    const sorted = chapters
      .map((c) => ({ c, pct: ((c.ts - startTs) / span) * 100 }))
      .filter((x) => x.pct >= -2 && x.pct <= 102)
      .sort((a, b) => a.pct - b.pct);
    const out: { pct: number; rep: TimelineChapter; count: number }[] = [];
    for (const { c, pct } of sorted) {
      const last = out[out.length - 1];
      if (last && pct - last.pct < CHAPTER_MERGE_GAP) {
        last.count++;
        if (CHAPTER_PRIORITY[c.kind] < CHAPTER_PRIORITY[last.rep.kind]) last.rep = c;
      } else {
        out.push({ pct, rep: c, count: 1 });
      }
    }
    return out;
  }, [chapters, startTs, span]);

  // Hide labels that would physically overlap an already-shown one (measured),
  // keeping the flag icon. This is the only reliable way since label widths vary.
  const labelRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [hiddenLabels, setHiddenLabels] = useState<Set<number>>(new Set());

  useEffect(() => {
    const measure = () => {
      const hidden = new Set<number>();
      const kept: { left: number; right: number }[] = [];
      clusters.forEach((_, i) => {
        const el = labelRefs.current[i];
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (kept.some((k) => r.left < k.right + 6 && r.right > k.left - 6)) {
          hidden.add(i);
        } else {
          kept.push({ left: r.left, right: r.right });
        }
      });
      setHiddenLabels(hidden);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [clusters]);

  return (
    <div className="relative ml-[120px] h-6">
      {clusters.map((cl, i) => {
        const transform =
          cl.pct > 85 ? "translateX(-100%)" : cl.pct < 6 ? "translateX(0)" : "translateX(-50%)";
        const label = cl.count > 1 ? `${cl.rep.label} ×${cl.count}` : cl.rep.label;
        const labelShown = !hiddenLabels.has(i);
        return (
          <div
            key={i}
            title={label}
            className="absolute flex items-center gap-1 whitespace-nowrap text-[11px] text-[var(--muted)]"
            style={{ left: `${cl.pct}%`, transform }}
          >
            <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0" style={{ color: flagColor[cl.rep.kind] }}>
              <path
                fill="currentColor"
                d="M5 3a1 1 0 0 1 1-1h0a1 1 0 0 1 1 1v18a1 1 0 1 1-2 0V3Z"
              />
              <path fill="currentColor" d="M7 3h11l-3 4 3 4H7V3Z" />
            </svg>
            <span
              ref={(el) => {
                labelRefs.current[i] = el;
              }}
              className={labelShown ? "" : "opacity-0"}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function AxisRow({ startTs, span }: { startTs: number; span: number }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => startTs + f * span);
  return (
    <div className="ml-[120px] mt-2 flex justify-between text-[11px] text-[var(--muted)]">
      {ticks.map((t, i) => (
        <span key={i}>{fmtClock(t)}</span>
      ))}
    </div>
  );
}

function Console({
  events,
  playhead,
  autoScroll,
  colorOf,
  onSeek,
}: {
  events: LogEvent[];
  playhead: number;
  autoScroll: boolean;
  colorOf: (s: string) => string;
  onSeek: (ts: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  // Index of the last event at or before the playhead = the "current" line.
  const currentIdx = useMemo(() => {
    let lo = 0;
    let hi = events.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (events[mid].ts <= playhead) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }, [events, playhead]);

  useEffect(() => {
    if (autoScroll && activeRef.current) {
      activeRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [currentIdx, autoScroll]);

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="grid grid-cols-[120px_120px_80px_1fr] gap-2 border-b border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted)]">
        <span>Время</span>
        <span>Сервис</span>
        <span>Уровень</span>
        <span>Сообщение</span>
      </div>
      <div ref={scrollRef} className="max-h-[320px] overflow-auto font-mono text-xs">
        {events.length === 0 && (
          <div className="px-3 py-6 text-center text-[var(--muted)]">
            Нет событий в текущем окне.
          </div>
        )}
        {events.map((e, i) => {
          const lk = levelKey(e.level);
          const active = i === currentIdx;
          return (
            <div
              key={e.seq}
              ref={active ? activeRef : undefined}
              onClick={() => onSeek(e.ts)}
              className={`grid cursor-pointer grid-cols-[120px_120px_80px_1fr] items-center gap-2 border-b border-[var(--border)]/50 px-3 py-1.5 ${
                active ? "bg-[var(--primary)]/15" : "hover:bg-[var(--surface-2)]"
              }`}
            >
              <span className="flex items-center gap-1 text-[var(--muted)]">
                {active && <Play className="h-3 w-3 text-[var(--primary)]" />}
                {e.tsText}
              </span>
              <span style={{ color: colorOf(e.service) }} className="truncate">
                [{e.service}]
              </span>
              <span style={{ color: LEVEL_COLOR[lk] }}>{lk}</span>
              <span className="truncate text-[var(--foreground)]" title={e.message}>
                {e.component ? `${e.component}: ` : ""}
                {e.message}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AiPanel({
  id,
  from,
  to,
  playhead,
}: {
  id: string;
  from: number;
  to: number;
  playhead: number;
}) {
  const [open, setOpen] = useState(true);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const explain = async () => {
    setLoading(true);
    try {
      const res = await fetch(apiPath(`/api/analyses/${id}/timeline/explain`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const json = await res.json();
      setText(json.summary ?? "Не удалось получить объяснение.");
    } catch {
      setText("Не удалось получить объяснение.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-[var(--primary)]" />
        <span className="text-sm font-semibold">ИИ: что произошло</span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="ml-auto text-[var(--muted)] hover:text-[var(--foreground)]"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "" : "-rotate-90"}`} />
        </button>
      </div>

      {open && (
        <div className="mt-4 flex-1 text-sm leading-relaxed text-[var(--muted)]">
          {loading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Анализирую окно…
            </div>
          ) : text ? (
            <p className="whitespace-pre-wrap">{text}</p>
          ) : (
            <p>
              Выберите интервал на таймлайне и нажмите «Объяснить окно» — ИИ
              опишет, что произошло за это время: ключевые события, вероятную
              причину и цепочку.
            </p>
          )}
          <div className="mt-2 text-[11px] text-[var(--muted)]/70">
            Окно: {fmtClock(from)} — {fmtClock(to)}
          </div>
        </div>
      )}

      <button
        onClick={explain}
        disabled={loading}
        className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--surface-2)] disabled:opacity-50"
      >
        <MessageSquare className="h-4 w-4" /> Объяснить окно
      </button>
    </aside>
  );
}

function ZoomBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-1.5 text-[var(--muted)] hover:text-[var(--foreground)]"
    >
      {children}
    </button>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`relative h-5 w-9 rounded-full transition-colors ${on ? "bg-[var(--primary)]" : "bg-[var(--surface-2)] border border-[var(--border)]"}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`}
      />
    </button>
  );
}
