"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Inbox, Loader2, Search, Trash2 } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { apiPath, formatBytes } from "@/lib/utils";

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

const STATUS_FILTERS = [
  { key: "all", label: "Все" },
  { key: "done", label: "Готово" },
  { key: "processing", label: "В работе" },
  { key: "error", label: "Ошибки" },
];

const PAGE_SIZE = 10;

function healthColor(score: number | null) {
  if (score == null) return "var(--muted)";
  if (score >= 80) return "var(--sev-ok)";
  if (score >= 50) return "var(--sev-warning)";
  return "var(--sev-critical)";
}

export default function HistoryPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<Row[]>({
    queryKey: ["history"],
    queryFn: async () => (await fetch(apiPath("/api/analyses"))).json(),
    refetchInterval: 5000,
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(apiPath(`/api/analyses/${id}`), { method: "DELETE" });
      if (!res.ok) throw new Error("failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["history"] }),
  });

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const rows = data ?? [];
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "all") {
        if (status === "processing" && !["processing", "queued"].includes(r.status)) return false;
        if (status !== "processing" && r.status !== status) return false;
      }
      if (!term) return true;
      return [r.product, r.filename, r.host, r.version]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(term));
    });
  }, [data, q, status]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">История анализов</h1>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
          <input
            className="input w-full pl-9"
            placeholder="Поиск по продукту, файлу, хосту…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="flex gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => {
                setStatus(f.key);
                setPage(1);
              }}
              className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                background: status === f.key ? "var(--primary)" : "var(--surface-2)",
                color: status === f.key ? "#fff" : "var(--muted)",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <Card className="text-[var(--muted)]">Загрузка…</Card>}

      {data && filtered.length === 0 && (
        <Card className="flex flex-col items-center gap-2 py-12 text-center text-[var(--muted)]">
          <Inbox className="h-8 w-8" />
          <div>{q || status !== "all" ? "Ничего не найдено" : "Пока нет анализов"}</div>
          <Link href="/" className="text-sm text-[var(--primary)]">
            Загрузить бандл
          </Link>
        </Card>
      )}

      {pageRows.length > 0 && (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <Th>Здоровье</Th>
                <Th>Продукт</Th>
                <Th className="hidden md:table-cell">Хост</Th>
                <Th className="hidden sm:table-cell">Размер</Th>
                <Th>Проблемы</Th>
                <Th>Статус</Th>
                <Th className="hidden lg:table-cell">Дата</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                  <Td>
                    <Link href={`/analysis/${r.id}`} className="block">
                      <span
                        className="grid h-9 w-9 place-items-center rounded-lg text-xs font-bold"
                        style={{ color: healthColor(r.healthScore), background: "var(--surface-2)" }}
                      >
                        {r.healthScore ?? "—"}
                      </span>
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/analysis/${r.id}`} className="block">
                      <div className="font-medium">{r.product ?? r.filename}</div>
                      {r.version && <div className="text-xs text-[var(--muted)]">{r.version}</div>}
                    </Link>
                  </Td>
                  <Td className="hidden md:table-cell text-[var(--muted)]">{r.host ?? "—"}</Td>
                  <Td className="hidden sm:table-cell text-[var(--muted)]">{formatBytes(r.size)}</Td>
                  <Td>{r.problemCount != null ? <Badge>{r.problemCount}</Badge> : "—"}</Td>
                  <Td>
                    <Badge>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                  </Td>
                  <Td className="hidden lg:table-cell text-xs text-[var(--muted)]">
                    {new Date(r.createdAt).toLocaleString("ru-RU")}
                  </Td>
                  <Td>
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            `Удалить анализ «${r.product ?? r.filename}» и его архив без возможности восстановления?`,
                          )
                        )
                          del.mutate(r.id);
                      }}
                      disabled={del.isPending && del.variables === r.id}
                      className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[rgba(239,68,68,0.12)] hover:text-[var(--sev-critical)]"
                      aria-label="Удалить"
                      title="Удалить анализ и архив"
                    >
                      {del.isPending && del.variables === r.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-[var(--muted)]">
          <span>
            {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} из{" "}
            {filtered.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              className="rounded-lg p-1.5 disabled:opacity-40 hover:bg-[var(--surface-2)]"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span>
              {safePage} / {pageCount}
            </span>
            <button
              className="rounded-lg p-1.5 disabled:opacity-40 hover:bg-[var(--surface-2)]"
              disabled={safePage >= pageCount}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-3 font-medium ${className}`}>{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>;
}
