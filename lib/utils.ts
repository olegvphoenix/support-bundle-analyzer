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

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}
