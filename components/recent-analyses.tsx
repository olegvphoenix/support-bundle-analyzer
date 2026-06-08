"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { apiPath } from "@/lib/utils";

interface Row {
  id: string;
  filename: string;
  status: string;
  product: string | null;
  version: string | null;
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

export function RecentAnalyses() {
  const { data } = useQuery<Row[]>({
    queryKey: ["history"],
    queryFn: async () => (await fetch(apiPath("/api/analyses"))).json(),
    refetchInterval: 5000,
  });

  const rows = (data ?? []).slice(0, 5);
  if (rows.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          <Clock className="h-4 w-4" /> Последние анализы
        </h2>
        <Link href="/history" className="inline-flex items-center gap-1 text-xs text-[var(--primary)]">
          Вся история <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="space-y-2">
        {rows.map((r) => (
          <Link key={r.id} href={`/analysis/${r.id}`}>
            <Card className="flex items-center justify-between gap-4 py-3 transition-colors hover:bg-[var(--surface-2)]">
              <div className="flex items-center gap-3">
                <span
                  className="grid h-9 w-9 place-items-center rounded-lg text-xs font-bold"
                  style={{ color: healthColor(r.healthScore), background: "var(--surface-2)" }}
                >
                  {r.healthScore ?? "—"}
                </span>
                <div>
                  <div className="font-medium">{r.product ?? r.filename}</div>
                  <div className="text-xs text-[var(--muted)]">
                    {new Date(r.createdAt).toLocaleString("ru-RU")}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {r.problemCount != null && <Badge>{r.problemCount} проблем</Badge>}
                <Badge>{STATUS_LABEL[r.status] ?? r.status}</Badge>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
