"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Card, ProgressBar } from "@/components/ui";
import { apiPath } from "@/lib/utils";

interface StatusEvent {
  status: "queued" | "processing" | "done" | "error";
  progress: number;
  stage: string;
  error?: string | null;
}

const STEPS = [
  { label: "Распаковка", end: 18 },
  { label: "Парсинг логов", end: 57 },
  { label: "Правила", end: 69 },
  { label: "Ретривал (Lexiro)", end: 80 },
  { label: "LLM-анализ", end: 100 },
];

export function ProcessingView({ id, onDone }: { id: string; onDone: () => void }) {
  const [state, setState] = useState<StatusEvent>({
    status: "queued",
    progress: 0,
    stage: "В очереди",
  });

  useEffect(() => {
    const es = new EventSource(apiPath(`/api/analyses/${id}/status`));
    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as StatusEvent;
      setState(data);
      if (data.status === "done") {
        es.close();
        onDone();
      } else if (data.status === "error") {
        es.close();
      }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [id, onDone]);

  if (state.status === "error") {
    return (
      <Card className="border-[var(--sev-critical)]/40">
        <div className="font-medium text-[var(--sev-critical)]">Ошибка обработки</div>
        <div className="mt-1 text-sm text-[var(--muted)]">{state.error}</div>
      </Card>
    );
  }

  const done = state.status === "done";
  const currentStep = done
    ? STEPS.length
    : STEPS.findIndex((s) => state.progress < s.end);

  return (
    <Card className="space-y-6 p-8">
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--primary)]" />
        <div className="font-medium">Анализируем бандл…</div>
      </div>

      <div>
        <ProgressBar value={state.progress} />
        <div className="mt-2 flex justify-between text-sm text-[var(--muted)]">
          <span>{state.stage}</span>
          <span>{state.progress}%</span>
        </div>
      </div>

      <div className="flex items-start justify-between gap-2">
        {STEPS.map((s, i) => {
          const isDone = done || i < currentStep;
          const isCurrent = !done && i === currentStep;
          const status = isDone ? "Завершено" : isCurrent ? `${state.progress}%` : "Ожидание";
          const color = isDone
            ? "var(--sev-ok)"
            : isCurrent
              ? "var(--primary)"
              : "var(--muted)";
          return (
            <div key={s.label} className="flex flex-1 flex-col items-center text-center">
              <div className="flex w-full items-center">
                <span
                  className="h-0.5 flex-1"
                  style={{
                    background: i === 0 ? "transparent" : i <= currentStep || done ? "var(--sev-ok)" : "var(--border)",
                  }}
                />
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2"
                  style={{
                    borderColor: isDone || isCurrent ? color : "var(--border)",
                    background: isDone ? "var(--sev-ok)" : "var(--surface)",
                    color: isDone ? "#fff" : color,
                  }}
                >
                  {isDone ? (
                    <Check className="h-4 w-4" />
                  ) : isCurrent ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-[var(--muted)]" />
                  )}
                </span>
                <span
                  className="h-0.5 flex-1"
                  style={{
                    background:
                      i === STEPS.length - 1
                        ? "transparent"
                        : i < currentStep || done
                          ? "var(--sev-ok)"
                          : "var(--border)",
                  }}
                />
              </div>
              <div
                className="mt-2 text-xs font-medium"
                style={{ color: isDone || isCurrent ? "var(--foreground)" : "var(--muted)" }}
              >
                {s.label}
              </div>
              <div className="text-xs" style={{ color }}>
                {status}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
