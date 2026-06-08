import { eq } from "drizzle-orm";
import { db } from "@/db";
import { oemProfiles } from "@/db/schema";
import { DEFAULT_OEM_ENTRIES, type OemEntry } from "@/lib/analyzer/oem-map";
import type { ProductFamily } from "@/lib/analyzer/types";

// Loads the dynamic OEM registry from the DB with a short in-memory cache.
// Falls back to built-in defaults if the DB is empty or unavailable, so the
// pipeline never breaks just because the registry hasn't been seeded yet.

const CACHE_TTL_MS = 60_000;
let cache: { at: number; entries: OemEntry[] } | null = null;

export async function loadOemEntries(force = false): Promise<OemEntry[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.entries;
  }
  try {
    const rows = await db
      .select()
      .from(oemProfiles)
      .where(eq(oemProfiles.active, 1));
    const entries: OemEntry[] = rows.map((r) => ({
      product: r.product,
      brandKey: r.brandKey,
      headLog: r.headLog,
      versionPrefix: r.versionPrefix,
      family: (r.family as ProductFamily | null) ?? null,
    }));
    // Merge DB entries over defaults (DB takes precedence by brandKey/headLog).
    const merged = mergeEntries(DEFAULT_OEM_ENTRIES, entries);
    cache = { at: Date.now(), entries: merged };
    return merged;
  } catch (err) {
    console.warn("OEM registry load failed, using defaults:", err);
    return DEFAULT_OEM_ENTRIES;
  }
}

export function invalidateOemCache(): void {
  cache = null;
}

function mergeEntries(base: OemEntry[], override: OemEntry[]): OemEntry[] {
  const key = (e: OemEntry) =>
    (e.brandKey || e.headLog || e.product).toLowerCase();
  const map = new Map<string, OemEntry>();
  for (const e of base) map.set(key(e), e);
  for (const e of override) map.set(key(e), e);
  return [...map.values()];
}
