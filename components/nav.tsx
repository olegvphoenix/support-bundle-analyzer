"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Activity, BarChart3, History, Settings, Upload } from "lucide-react";
import { cn, apiPath } from "@/lib/utils";

interface AnalysisRow {
  id: string;
  status: string;
}

function NavItem({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: typeof Upload;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
        active
          ? "bg-[var(--surface-2)] font-medium text-[var(--foreground)]"
          : "text-[var(--muted)] hover:bg-[var(--surface-2)]/60 hover:text-[var(--foreground)]",
      )}
    >
      <Icon
        className="h-[18px] w-[18px]"
        style={active ? { color: "var(--primary)" } : undefined}
      />
      {label}
    </Link>
  );
}

export function Nav({ width }: { width?: number }) {
  const pathname = usePathname();

  // "Анализы" points at the most recent analysis (falls back to history).
  const { data } = useQuery<AnalysisRow[]>({
    queryKey: ["history"],
    queryFn: async () => (await fetch(apiPath("/api/analyses"))).json(),
    refetchInterval: 5000,
  });
  const latest = data?.find((r) => r.status === "done") ?? data?.[0];
  const analysesHref = latest ? `/analysis/${latest.id}` : "/history";

  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 flex flex-col overflow-hidden border-r border-[var(--border)] bg-[var(--surface)]"
      style={{ width: width ?? 240 }}
    >
      <Link href="/" className="flex items-center gap-3 px-5 py-5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--primary)] text-white">
          <Activity className="h-5 w-5" />
        </span>
        <span className="text-sm font-semibold leading-tight">
          Support Bundle
          <br />
          Analyzer
        </span>
      </Link>

      <nav className="flex-1 space-y-1 px-3 py-2">
        <NavItem href="/" label="Загрузка" icon={Upload} active={pathname === "/"} />
        <NavItem
          href={analysesHref}
          label="Анализы"
          icon={BarChart3}
          active={pathname.startsWith("/analysis")}
        />
        <NavItem
          href="/history"
          label="История"
          icon={History}
          active={pathname.startsWith("/history")}
        />
      </nav>

      <div className="border-t border-[var(--border)] px-3 py-3">
        <NavItem
          href="/settings"
          label="Настройки"
          icon={Settings}
          active={pathname.startsWith("/settings")}
        />
      </div>
    </aside>
  );
}
