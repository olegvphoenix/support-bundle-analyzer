"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, ProgressBar } from "@/components/ui";

interface StatusEvent {
  status: "queued" | "processing" | "done" | "error";
  progress: number;
  stage: string;
  error?: string | null;
}

export function ProcessingView({
  id,
  onDone,
}: {
  id: string;
  onDone: () => void;
}) {
  const [state, setState] = useState<StatusEvent>({
    status: "queued",
    progress: 0,
    stage: "В очереди",
  });

  useEffect(() => {
    const es = new EventSource(`/api/analyses/${id}/status`);
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
        <div className="text-[var(--sev-critical)] font-medium">Ошибка обработки</div>
        <div className="mt-1 text-sm text-[var(--muted)]">{state.error}</div>
      </Card>
    );
  }

  return (
    <Card className="space-y-5 p-8">
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--primary)]" />
        <div className="font-medium">Анализируем бандл…</div>
      </div>
      <ProgressBar value={state.progress} />
      <div className="flex justify-between text-sm text-[var(--muted)]">
        <span>{state.stage}</span>
        <span>{state.progress}%</span>
      </div>
    </Card>
  );
}
