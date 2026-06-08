"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ChevronRight, Inbox } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { formatBytes } from "@/lib/utils";

interface Row {
  id: string;
  filename: string;
  size: number;
  status: string;
  product: string | null;
  version: string | null;
  host: string | null;
  healthScore: number | null;
  problemCount: number | null;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "В очереди",
  processing: "Обработка",
  done: "Готово",
  error: "Ошибка",
};

function healthColor(score: number | null) {
  if (score == null) return "var(--muted)";
  if (score >= 80) return "var(--sev-ok)";
  if (score >= 50) return "var(--sev-warning)";
  return "var(--sev-critical)";
}

export default function HistoryPage() {
  const { data, isLoading } = useQuery<Row[]>({
    queryKey: ["history"],
    queryFn: async () => (await fetch("/api/analyses")).json(),
    refetchInterval: 5000,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">История анализов</h1>

      {isLoading && <Card className="text-[var(--muted)]">Загрузка…</Card>}

      {data && data.length === 0 && (
        <Card className="flex flex-col items-center gap-2 py-12 text-center text-[var(--muted)]">
          <Inbox className="h-8 w-8" />
          <div>Пока нет анализов</div>
          <Link href="/" className="text-sm text-[var(--primary)]">
            Загрузить бандл
          </Link>
        </Card>
      )}

      <div className="space-y-2">
        {data?.map((r) => (
          <Link key={r.id} href={`/analysis/${r.id}`}>
            <Card className="flex items-center justify-between gap-4 py-4 transition-colors hover:bg-[var(--surface-2)]">
              <div className="flex items-center gap-4">
                <div
                  className="grid h-11 w-11 place-items-center rounded-lg text-sm font-bold"
                  style={{
                    color: healthColor(r.healthScore),
                    background: "var(--surface-2)",
                  }}
                >
                  {r.healthScore ?? "—"}
                </div>
                <div>
                  <div className="font-medium">
                    {r.product ?? r.filename}
                    {r.version && (
                      <span className="ml-2 text-sm text-[var(--muted)]">
                        {r.version}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    {r.host ? `${r.host} · ` : ""}
                    {formatBytes(r.size)} ·{" "}
                    {new Date(r.createdAt).toLocaleString("ru-RU")}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {r.problemCount != null && (
                  <Badge>{r.problemCount} проблем</Badge>
                )}
                <Badge>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                <ChevronRight className="h-4 w-4 text-[var(--muted)]" />
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
