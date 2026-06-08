import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SystemFacts } from "./types";

async function readIfExists(p: string): Promise<string | null> {
  try {
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
}

export async function collectFacts(reportDir: string): Promise<SystemFacts> {
  const notes: string[] = [];

  // Disks.
  const disks: SystemFacts["disks"] = [];
  const drives = await readIfExists(join(reportDir, "drives_defrag_info.txt"));
  if (drives) {
    const blocks = drives.split(/Name -/).slice(1);
    for (const b of blocks) {
      const name = b.split("\n")[0].trim();
      const total = b.match(/Total size -\s*([\d.,]+)\s*Mb/i);
      const free = b.match(/Total free space -\s*([\d.,]+)\s*Mb/i);
      const toNum = (s?: string) =>
        s ? parseFloat(s.replace(/\s/g, "").replace(",", ".")) : 0;
      disks.push({
        name,
        totalMb: toNum(total?.[1]),
        freeMb: toNum(free?.[1]),
      });
    }
    for (const d of disks) {
      if (d.totalMb && d.freeMb / d.totalMb < 0.05) {
        notes.push(`Мало места на диске ${d.name}: свободно ${Math.round(d.freeMb)} МБ`);
      }
    }
  }

  // License dongle.
  const guardants = (await readIfExists(join(reportDir, "guardants.txt"))) ?? "";
  const licenseDongleFound =
    guardants.length > 0 && !/not found|не найден/i.test(guardants);
  if (!licenseDongleFound && guardants.length) {
    notes.push("Ключ лицензии Guardant не найден");
  }

  // Modules count.
  const modules = await readIfExists(join(reportDir, "modules_version.csv"));
  const modulesCount = modules
    ? modules.split(/\r?\n/).filter((l) => l.trim()).length - 1
    : null;

  // Open ports count.
  const ports = await readIfExists(join(reportDir, "ports.txt"));
  let openPortsCount: number | null = null;
  if (ports) {
    const m = ports.match(/(\d+)\s+active ports found/);
    if (m) openPortsCount = parseInt(m[1], 10);
  }

  return { disks, licenseDongleFound, modulesCount, openPortsCount, notes };
}
