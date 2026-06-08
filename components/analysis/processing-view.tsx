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
  { label: "Загрузка и распаковка", end: 18 },
  { label: "Парсинг логов", end: 57 },
  { label: "Свёртка и правила", end: 69 },
  { label: "База знаний и ИИ", end: 91 },
  { label: "Формирование отчёта", end: 100 },
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

      <ol className="space-y-3">
        {STEPS.map((s, i) => {
          const isDone = done || i < currentStep;
          const isCurrent = !done && i === currentStep;
          return (
            <li key={s.label} className="flex items-center gap-3">
              <span
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs"
                style={{
                  background: isDone
                    ? "var(--sev-ok)"
                    : isCurrent
                      ? "var(--primary)"
                      : "var(--surface-2)",
                  color: isDone || isCurrent ? "#fff" : "var(--muted)",
                }}
              >
                {isDone ? (
                  <Check className="h-3.5 w-3.5" />
                ) : isCurrent ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  i + 1
                )}
              </span>
              <span
                className="text-sm"
                style={{
                  color: isDone || isCurrent ? "var(--foreground)" : "var(--muted)",
                  fontWeight: isCurrent ? 600 : 400,
                }}
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
