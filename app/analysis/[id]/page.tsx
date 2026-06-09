"use client";

import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, OctagonX, Trash2 } from "lucide-react";
import { ProcessingView } from "@/components/analysis/processing-view";
import { ReportView } from "@/components/analysis/report-view";
import { RestartControls } from "@/components/analysis/restart-controls";
import { LogPlayer } from "@/components/analysis/log-player";
import { Button, Card } from "@/components/ui";
import { apiPath } from "@/lib/utils";
import type { AnalysisReport } from "@/lib/analyzer/types";

interface AnalysisRow {
  id: string;
  filename: string;
  size: number;
  status: "queued" | "processing" | "done" | "error" | "cancelled";
  error: string | null;
  storageKey: string | null;
  availableStages: string[];
  report: AnalysisReport | null;
}

export default function AnalysisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [refetchKey, setRefetchKey] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState<"report" | "player">("report");

  const { data, isLoading, refetch } = useQuery<AnalysisRow>({
    queryKey: ["analysis", id, refetchKey],
    queryFn: async () => {
      const res = await fetch(apiPath(`/api/analyses/${id}`));
      if (!res.ok) throw new Error("not found");
      return res.json();
    },
  });

  const remove = async () => {
    if (
      !confirm(
        "Удалить этот анализ и загруженный архив без возможности восстановления?",
      )
    )
      return;
    setDeleting(true);
    try {
      await fetch(apiPath(`/api/analyses/${id}`), { method: "DELETE" });
      router.push("/history");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/history"
          className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
        >
          <ArrowLeft className="h-4 w-4" /> К истории
        </Link>
        <Button variant="outline" size="sm" onClick={remove} disabled={deleting}>
          {deleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
          Удалить
        </Button>
      </div>

      {isLoading && (
        <Card className="flex items-center gap-3 text-[var(--muted)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
        </Card>
      )}

      {data && data.status === "error" && (
        <Card className="border-[var(--sev-critical)]/40">
          <div className="font-medium text-[var(--sev-critical)]">Ошибка обработки</div>
          <div className="mt-1 text-sm text-[var(--muted)]">{data.error}</div>
        </Card>
      )}

      {data && data.status === "cancelled" && (
        <Card className="flex items-center gap-3 border-[var(--sev-warning)]/40">
          <OctagonX className="h-5 w-5 text-[var(--sev-warning)]" />
          <div>
            <div className="font-medium text-[var(--sev-warning)]">
              Анализ остановлен
            </div>
            <div className="text-sm text-[var(--muted)]">
              Можно перезапустить с любого доступного этапа ниже.
            </div>
          </div>
        </Card>
      )}

      {data && (data.status === "queued" || data.status === "processing") && (
        <ProcessingView
          id={id}
          filename={data.filename}
          size={data.size}
          onDone={() => {
            setRefetchKey((k) => k + 1);
            refetch();
          }}
        />
      )}

      {data && data.status === "done" && data.report && (
        <>
          {(data.availableStages ?? []).includes("timeline") && (
            <div className="flex items-center gap-1 border-b border-[var(--border)]">
              <button
                onClick={() => setTab("report")}
                className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                  tab === "report"
                    ? "border-[var(--primary)] text-[var(--foreground)]"
                    : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                Отчёт
              </button>
              <button
                onClick={() => setTab("player")}
                className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                  tab === "player"
                    ? "border-[var(--primary)] text-[var(--foreground)]"
                    : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                Проигрыватель логов
              </button>
            </div>
          )}
          {tab === "report" ? (
            <ReportView id={id} report={data.report} />
          ) : (
            <LogPlayer
              id={id}
              title={`Проигрыватель логов — ${data.filename}`}
              version={data.report.profile.version}
            />
          )}
        </>
      )}

      {data &&
        (data.status === "done" ||
          data.status === "error" ||
          data.status === "cancelled") && (
          <RestartControls
            id={id}
            availableStages={data.availableStages ?? []}
            hasStorage={!!data.storageKey}
            onRerun={() => {
              setRefetchKey((k) => k + 1);
              refetch();
            }}
          />
        )}
    </div>
  );
}
