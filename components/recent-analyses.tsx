"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowRight, Boxes, CheckCircle2, ChevronRight, Clock, Loader2 } from "lucide-react";
import { Card } from "@/components/ui";
import { apiPath } from "@/lib/utils";

interface Row {
  id: string;
  filename: string;
  status: string;
  product: string | null;
  version: string | null;
  host: string | null;
  healthScore: number | null;
  problemCount: number | null;
  createdAt: string;
}

const STATUS: Record<string, { label: string; icon: typeof CheckCircle2; color: string }> = {
  done: { label: "Завершён", icon: CheckCircle2, color: "var(--sev-ok)" },
  processing: { label: "Обработка", icon: Loader2, color: "var(--sev-info)" },
  queued: { label: "В очереди", icon: Clock, color: "var(--muted)" },
  error: { label: "Ошибка", icon: CheckCircle2, color: "var(--sev-critical)" },
};

function health(score: number | null): { color: string; word: string } {
  if (score == null) return { color: "var(--muted)", word: "—" };
  if (score >= 80) return { color: "var(--sev-ok)", word: "Хорошее" };
  if (score >= 50) return { color: "var(--sev-warning)", word: "Удовлетворительное" };
  return { color: "var(--sev-critical)", word: "Критическое" };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
      <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--muted)]">
        <Clock className="h-4 w-4" /> Последние анализы
      </h2>

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="px-4 py-3 font-medium">Дата</th>
              <th className="px-4 py-3 font-medium">Продукт</th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">Хост</th>
              <th className="px-4 py-3 font-medium">Оценка здоровья</th>
              <th className="px-4 py-3 font-medium">Статус</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const h = health(r.healthScore);
              const st = STATUS[r.status] ?? STATUS.queued;
              const StIcon = st.icon;
              return (
                <tr
                  key={r.id}
                  className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]"
                >
                  <td className="px-4 py-3 text-[var(--muted)]">
                    <Link href={`/analysis/${r.id}`} className="block">
                      {formatDate(r.createdAt)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/analysis/${r.id}`} className="flex items-center gap-2">
                      <Boxes className="h-4 w-4 text-[var(--primary)]" />
                      <span className="font-medium">{r.product ?? r.filename}</span>
                    </Link>
                  </td>
                  <td className="hidden px-4 py-3 text-[var(--muted)] md:table-cell">
                    {r.host ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="grid h-7 min-w-7 place-items-center rounded-md px-1.5 text-xs font-bold"
                        style={{ color: h.color, background: "var(--surface-2)" }}
                      >
                        {r.healthScore ?? "—"}
                      </span>
                      <span style={{ color: h.color }}>{h.word}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5" style={{ color: st.color }}>
                      <StIcon className="h-4 w-4" /> {st.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/analysis/${r.id}`}>
                      <ChevronRight className="h-4 w-4 text-[var(--muted)]" />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Link
          href="/history"
          className="flex items-center justify-center gap-1 border-t border-[var(--border)] py-3 text-sm text-[var(--primary)] hover:bg-[var(--surface-2)]"
        >
          Смотреть все анализы <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </Card>
    </section>
  );
}
