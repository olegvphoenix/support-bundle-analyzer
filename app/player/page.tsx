"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Hammer, Inbox, Loader2, PlayCircle } from "lucide-react";
import { LogPlayer } from "@/components/analysis/log-player";
import { Button, Card } from "@/components/ui";
import { apiPath, formatBytes } from "@/lib/utils";

interface Row {
  id: string;
  filename: string;
  size: number;
  status: string;
  product: string | null;
  version: string | null;
  host: string | null;
  progress: number | null;
  stage: string | null;
  availableStages: string[] | null;
  createdAt: string;
}

const isPlayable = (r?: Row | null) =>
  !!r?.availableStages?.includes("timeline");

export default function PlayerPage() {
  const qc = useQueryClient();
  const { data: list, isLoading } = useQuery<Row[]>({
    queryKey: ["history"],
    queryFn: async () => (await fetch(apiPath("/api/analyses"))).json(),
    refetchInterval: 4000,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Default to the first playable bundle (else the newest), once loaded.
  useEffect(() => {
    if (selectedId || !list?.length) return;
    const playable = list.find(isPlayable);
    setSelectedId((playable ?? list[0]).id);
  }, [list, selectedId]);

  const selected = useMemo(
    () => list?.find((r) => r.id === selectedId) ?? null,
    [list, selectedId],
  );

  const build = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(apiPath(`/api/analyses/${id}/rerun`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromStage: "timeline" }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Не удалось запустить построение");
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["history"] }),
  });

  const playable = isPlayable(selected);
  const processing =
    selected?.status === "processing" || selected?.status === "queued";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <PlayCircle className="h-6 w-6 text-[var(--primary)]" />
          Проигрыватель логов
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Выберите загруженный бандл и проигрывайте его логи во времени —
          с временной шкалой, поиском и объяснением событий ИИ.
        </p>
      </div>

      {isLoading && (
        <Card className="flex items-center gap-3 text-[var(--muted)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Загрузка списка бандлов…
        </Card>
      )}

      {list && list.length === 0 && (
        <Card className="flex flex-col items-center gap-2 py-12 text-center text-[var(--muted)]">
          <Inbox className="h-8 w-8" />
          <div>Пока нет загруженных бандлов</div>
          <Link href="/" className="text-sm text-[var(--primary)]">
            Загрузить бандл
          </Link>
        </Card>
      )}

      {list && list.length > 0 && (
        <>
          {/* Bundle selector */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="text-sm text-[var(--muted)]">Бандл:</label>
            <select
              className="input sm:max-w-xl"
              value={selectedId ?? ""}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {list.map((r) => (
                <option key={r.id} value={r.id}>
                  {(isPlayable(r) ? "▶ " : "") +
                    (r.product ?? r.filename) +
                    (r.version ? ` · ${r.version}` : "") +
                    ` — ${new Date(r.createdAt).toLocaleString("ru-RU")}` +
                    ` (${formatBytes(r.size)})`}
                </option>
              ))}
            </select>
            {selected && (
              <span className="text-xs text-[var(--muted)]">
                {playable
                  ? "лента готова"
                  : processing
                    ? "идёт обработка…"
                    : "лента не построена"}
              </span>
            )}
          </div>

          {/* Player or build/processing CTA */}
          {selected && playable && (
            <LogPlayer
              id={selected.id}
              title={`Проигрыватель логов — ${selected.filename}`}
              version={selected.version}
            />
          )}

          {selected && !playable && processing && (
            <Card className="flex items-center gap-3 text-[var(--muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              <div>
                <div className="font-medium text-[var(--foreground)]">
                  Идёт обработка бандла
                </div>
                <div className="text-sm">
                  {selected.stage ?? "В работе"} · {selected.progress ?? 0}% —
                  лента событий появится автоматически.
                </div>
              </div>
            </Card>
          )}

          {selected && !playable && !processing && (
            <Card className="flex flex-col items-start gap-3">
              <div>
                <div className="font-medium">
                  Лента событий для этого бандла ещё не построена
                </div>
                <div className="mt-1 text-sm text-[var(--muted)]">
                  Старые бандлы были обработаны до появления проигрывателя.
                  Постройте ленту — система распакует архив и соберёт временную
                  шкалу из всех логов.
                </div>
              </div>
              <Button
                onClick={() => build.mutate(selected.id)}
                disabled={build.isPending}
              >
                {build.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Hammer className="h-4 w-4" />
                )}
                Построить ленту
              </Button>
              {build.isError && (
                <div className="text-sm text-[var(--sev-critical)]">
                  {(build.error as Error).message}
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
