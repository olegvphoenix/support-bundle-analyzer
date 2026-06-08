import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BundleProfile } from "./types";
import { resolveProduct, type OemEntry } from "./oem-map";

async function readIfExists(p: string): Promise<string | null> {
  try {
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
}

/**
 * Detect product/version/host from a Report directory using OEM-invariant signals.
 */
export async function detectProfile(
  reportDir: string,
  oemEntries?: OemEntry[],
): Promise<BundleProfile> {
  const version =
    (await readIfExists(join(reportDir, "product_version.txt")))?.trim() || null;

  const logsDir = join(reportDir, "Logs");
  let headLogs: string[] = [];
  if (existsSync(logsDir)) {
    const entries = await readdir(logsDir);
    // Head logs are the non-APP_HOST .log files in the Logs root.
    headLogs = entries.filter(
      (f) => f.endsWith(".log") && !f.startsWith("APP_HOST."),
    );
  }

  const { product, family } = resolveProduct(version, headLogs, oemEntries);

  // Host: try Prometheus replacement label, then ports.txt computer name.
  let host: string | null = null;
  const prom = await readIfExists(
    join(reportDir, "Prometheus", "config", "prometheus.yaml"),
  );
  if (prom) {
    const m = prom.match(/replacement:\s*([^\s]+)/);
    if (m) host = m[1];
  }
  if (!host) {
    const ports = await readIfExists(join(reportDir, "ports.txt"));
    if (ports) {
      const m = ports.match(/Local computer name:\s*\n\s*\n\s*([^\s]+)/);
      if (m) host = m[1];
    }
  }

  // Locale: detect by language of the guardants marker.
  const guardants = (await readIfExists(join(reportDir, "guardants.txt"))) ?? "";
  const locale: BundleProfile["locale"] = /[А-Яа-я]/.test(guardants)
    ? "ru"
    : "en";

  return {
    productFamily: family,
    productName: product,
    version,
    host,
    collectedAt: null,
    locale,
  };
}
