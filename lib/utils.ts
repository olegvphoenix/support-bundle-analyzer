import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// basePath-aware prefix for client-side fetches / EventSource / links.
// Next.js does not auto-prefix fetch() calls, so we do it explicitly.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

export function apiPath(path: string): string {
  return `${BASE_PATH}${path}`;
}

// Log timestamps look like "2026-05-07 15:48:27.155". Render a compact local form.
export function formatTs(ts: string | null, withDate = false): string {
  if (!ts) return "—";
  const d = new Date(ts.replace(" ", "T"));
  if (isNaN(d.getTime())) return ts;
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (!withDate) return time;
  return `${d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })} ${time}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}
