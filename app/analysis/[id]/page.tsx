"use client";

import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { ProcessingView } from "@/components/analysis/processing-view";
import { ReportView } from "@/components/analysis/report-view";
import { Card } from "@/components/ui";
import { apiPath } from "@/lib/utils";
import type { AnalysisReport } from "@/lib/analyzer/types";

interface AnalysisRow {
  id: string;
  filename: string;
  size: number;
  status: "queued" | "processing" | "done" | "error";
  error: string | null;
  report: AnalysisReport | null;
}

export default function AnalysisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [refetchKey, setRefetchKey] = useState(0);

  const { data, isLoading, refetch } = useQuery<AnalysisRow>({
    queryKey: ["analysis", id, refetchKey],
    queryFn: async () => {
      const res = await fetch(apiPath(`/api/analyses/${id}`));
      if (!res.ok) throw new Error("not found");
      return res.json();
    },
  });

  return (
    <div className="space-y-6">
      <Link
        href="/history"
        className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
      >
        <ArrowLeft className="h-4 w-4" /> К истории
      </Link>

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
        <ReportView id={id} report={data.report} />
      )}
    </div>
  );
}
