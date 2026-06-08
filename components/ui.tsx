import * as React from "react";
import { cn } from "@/lib/utils";
import type { Severity } from "@/lib/analyzer/types";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-5",
        className,
      )}
      {...props}
    />
  );
}

export function Button({
  className,
  variant = "default",
  size = "md",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "ghost" | "outline";
  size?: "sm" | "md";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-4 py-2 text-sm",
        variant === "default" &&
          "bg-[var(--primary)] text-white hover:opacity-90",
        variant === "outline" &&
          "border border-[var(--border)] bg-transparent hover:bg-[var(--surface-2)]",
        variant === "ghost" && "bg-transparent hover:bg-[var(--surface-2)]",
        className,
      )}
      {...props}
    />
  );
}

export const SEVERITY_META: Record<
  Severity,
  { label: string; color: string; bg: string }
> = {
  critical: { label: "Критично", color: "var(--sev-critical)", bg: "rgba(239,68,68,0.12)" },
  warning: { label: "Внимание", color: "var(--sev-warning)", bg: "rgba(245,158,11,0.12)" },
  info: { label: "Инфо", color: "var(--sev-info)", bg: "rgba(96,165,250,0.12)" },
  noise: { label: "Шум", color: "var(--sev-noise)", bg: "rgba(107,114,128,0.12)" },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const m = SEVERITY_META[severity];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ color: m.color, background: m.bg }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: m.color }}
      />
      {m.label}
    </span>
  );
}

export function Badge({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-[var(--surface-2)] px-2 py-0.5 text-xs text-[var(--muted)]",
        className,
      )}
      {...props}
    />
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
      <div
        className="h-full rounded-full bg-[var(--primary)] transition-all duration-500"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function HealthGauge({ score }: { score: number }) {
  const color =
    score >= 80
      ? "var(--sev-ok)"
      : score >= 50
        ? "var(--sev-warning)"
        : "var(--sev-critical)";
  const r = 52;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  return (
    <div className="relative grid h-32 w-32 place-items-center">
      <svg className="h-32 w-32 -rotate-90" viewBox="0 0 120 120">
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth="10"
        />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="text-3xl font-bold" style={{ color }}>
          {score}
        </div>
        <div className="text-xs text-[var(--muted)]">из 100</div>
      </div>
    </div>
  );
}
