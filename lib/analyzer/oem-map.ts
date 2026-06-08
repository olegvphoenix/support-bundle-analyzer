import type { ProductFamily } from "./types";

// OEM-agnostic product resolution.
//
// The base product (AxxonOne / Axxon Next) ships under many OEM brand names,
// and new OEMs appear roughly monthly. We therefore DO NOT hardcode the brand
// list as the source of truth. Instead resolution is data-driven and resilient:
//
//   1. Explicit registry entries (loaded dynamically from DB / config) match by
//      invariant signals: head-log filename or version prefix.
//   2. If nothing matches, the brand is AUTO-DETECTED from the head-log basename
//      (the non-`APP_HOST.*` log), so a brand-new OEM is recognized with zero
//      configuration.
//   3. Product family is derived generically from the version major, so new
//      product versions (released ~quarterly) never require code/config changes.

export interface OemEntry {
  // Display name of the brand.
  product: string;
  // Stable identifier (optional), useful for grouping/analytics.
  brandKey?: string | null;
  // Invariant: a head-log filename present in Report/Logs (e.g. "AxxonOne.log").
  headLog?: string | null;
  // Invariant: version string starts with this prefix (e.g. "5.").
  versionPrefix?: string | null;
  // Optional explicit family override; otherwise derived from version.
  family?: ProductFamily | null;
}

// Built-in fallback seed. NOT the source of truth — the dynamic registry (DB)
// overrides/extends this. Kept minimal so the core runs without infrastructure.
export const DEFAULT_OEM_ENTRIES: OemEntry[] = [
  { product: "AxxonOne", brandKey: "axxonone", headLog: "AxxonOne.log" },
  { product: "Axxon Next", brandKey: "axxonnext", headLog: "AxxonNext.log" },
];

export function familyFromVersion(version: string | null): ProductFamily {
  if (!version) return "unknown";
  const major = parseInt(version.split(".")[0] ?? "", 10);
  if (Number.isNaN(major)) return "unknown";
  if (major >= 5) return "axxon5";
  if (major === 3 || major === 4) return "axxon3";
  return "unknown";
}

/** Turn a head-log filename into a human brand name: "MyVms.log" -> "MyVms". */
function brandFromHeadLog(headLog: string): string {
  return headLog.replace(/\.log$/i, "");
}

/**
 * Resolve product brand + family from invariant signals.
 * @param version  contents of product_version.txt (or null)
 * @param headLogs non-`APP_HOST.*` .log filenames found in Report/Logs
 * @param entries  dynamic OEM registry (defaults to built-in seed)
 */
export function resolveProduct(
  version: string | null,
  headLogs: string[],
  entries: OemEntry[] = DEFAULT_OEM_ENTRIES,
): { product: string; family: ProductFamily; brandKey: string | null; autoDetected: boolean } {
  // 1. Explicit match by head log.
  for (const e of entries) {
    if (e.headLog && headLogs.some((h) => h.toLowerCase() === e.headLog!.toLowerCase())) {
      return {
        product: e.product,
        family: e.family ?? familyFromVersion(version),
        brandKey: e.brandKey ?? null,
        autoDetected: false,
      };
    }
  }
  // 2. Explicit match by version prefix.
  if (version) {
    for (const e of entries) {
      if (e.versionPrefix && version.startsWith(e.versionPrefix)) {
        return {
          product: e.product,
          family: e.family ?? familyFromVersion(version),
          brandKey: e.brandKey ?? null,
          autoDetected: false,
        };
      }
    }
  }
  // 3. Auto-detect a new/unknown OEM from its head-log basename.
  if (headLogs.length) {
    // Prefer the shortest non-APP_HOST head log (brand logs are short names).
    const head = [...headLogs].sort((a, b) => a.length - b.length)[0];
    return {
      product: brandFromHeadLog(head),
      family: familyFromVersion(version),
      brandKey: null,
      autoDetected: true,
    };
  }
  // 4. Nothing to go on.
  return {
    product: "Unknown product",
    family: familyFromVersion(version),
    brandKey: null,
    autoDetected: true,
  };
}
