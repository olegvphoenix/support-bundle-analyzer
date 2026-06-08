import Seven from "node-7z";
import sevenBin from "7zip-bin";

const { extractFull } = Seven;
const path7za = sevenBin.path7za;
import { readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Extract a .7z/.zip support bundle to destDir using the bundled 7za binary.
 * Streams to disk — constant memory footprint regardless of archive size.
 */
export function extractBundle(archivePath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = extractFull(archivePath, destDir, {
      $bin: path7za,
      $progress: false,
    });
    stream.on("end", () => resolve());
    stream.on("error", (err) => reject(err));
  });
}

/**
 * Locate the "Report" directory inside an extracted bundle (BFS, depth-limited).
 * The bundle may wrap Report/ in one or more parent folders.
 */
export async function findReportDir(root: string, maxDepth = 4): Promise<string | null> {
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift()!;
    if (existsSync(join(dir, "Logs")) || existsSync(join(dir, "product_version.txt"))) {
      return dir;
    }
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(dir, name);
      if (name === "Report") return full;
      if (depth < maxDepth) {
        try {
          if ((await stat(full)).isDirectory()) {
            queue.push({ dir: full, depth: depth + 1 });
          }
        } catch {
          // ignore
        }
      }
    }
  }
  return null;
}
