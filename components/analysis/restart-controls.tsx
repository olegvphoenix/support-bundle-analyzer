"use client";

import { useState } from "react";
import { RotateCcw, Play } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { apiPath } from "@/lib/utils";
import { STAGES, canRestartFrom, type StageKey } from "@/lib/analyzer/stages";

export function RestartControls({
  id,
  availableStages,
  hasStorage,
  onRerun,
}: {
  id: string;
  availableStages: string[];
  hasStorage: boolean;
  onRerun: () => void;
}) {
  const [busy, setBusy] = useState<StageKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rerun = async (fromStage: StageKey) => {
    setBusy(fromStage);
    setError(null);
    try {
      const res = await fetch(apiPath(`/api/analyses/${id}/rerun`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromStage }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Ошибка ${res.status}`);
      }
      onRerun();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!hasStorage) {
    return (
      <Card className="text-sm text-[var(--muted)]">
        Архив недоступен — перезапуск невозможен.
      </Card>
    );
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="font-medium">Перезапуск анализа</div>
        <Button
          variant="default"
          size="sm"
          onClick={() => rerun("extract")}
          disabled={busy !== null}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Запустить заново полностью
        </Button>
      </div>

      <p className="text-sm text-[var(--muted)]">
        Можно перезапустить с конкретного этапа — предыдущие этапы будут взяты из
        сохранённых результатов.
      </p>

      <div className="divide-y divide-[var(--border)] overflow-hidden rounded-lg border border-[var(--border)]">
        {STAGES.map((s, i) => {
          const allowed = canRestartFrom(s.key, availableStages);
          return (
            <div
              key={s.key}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--surface-2)] text-xs text-[var(--muted)]">
                  {i + 1}
                </span>
                <span className="text-sm">{s.label}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => rerun(s.key)}
                disabled={!allowed || busy !== null}
                title={
                  allowed
                    ? undefined
                    : "Нет сохранённого результата предыдущего этапа"
                }
              >
                <Play className="h-3.5 w-3.5" />
                {busy === s.key ? "Запуск…" : "С этого этапа"}
              </Button>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="rounded-lg border border-[var(--sev-critical)]/40 bg-[rgba(239,68,68,0.1)] px-4 py-3 text-sm text-[var(--sev-critical)]">
          {error}
        </div>
      )}
    </Card>
  );
}
