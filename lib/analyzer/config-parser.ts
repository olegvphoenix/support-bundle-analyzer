import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ConfigInventory, ConfigObject, ConfigObjectType } from "./types";

// Parses the object configuration shipped in a support bundle under
// Report/Config.local/config_repo/<Object.id>/{main,meta}.conf. Each object is
// a camera (DeviceIpint), archive (MultimediaStorage), detector (VMDA/...),
// or a service. This inventory gives real, named entities to anchor log events
// and correlate problems around (a camera, its archive, its detectors).

const GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`, "i"));
  return m ? m[1].trim() || null : null;
}

function classify(key: string): ConfigObjectType {
  const k = key.toLowerCase();
  if (/^deviceipint|ipint|^device\b|_device\./.test(k)) return "camera";
  if (/^multimediastorage|storage/.test(k)) return "archive";
  if (
    /^vmda|recognizer|objectsearcher|heatmap|detector|tracker|neuro|^face|^lpr/.test(k)
  )
    return "detector";
  return "service";
}

async function findConfigRepo(reportDir: string): Promise<string | null> {
  const candidates = [
    join(reportDir, "Config.local", "config_repo"),
    join(reportDir, "Config.local", "clone_config_repo"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

async function parseObject(
  dir: string,
  key: string,
): Promise<ConfigObject | null> {
  const mainPath = join(dir, "main.conf");
  const metaPath = join(dir, "meta.conf");
  let main = "";
  let meta = "";
  try {
    main = await readFile(mainPath, "utf8");
  } catch {
    // some objects only have meta; still register them
  }
  try {
    meta = await readFile(metaPath, "utf8");
  } catch {
    /* optional */
  }
  if (!main && !meta) return null;

  const type = classify(key);
  const aliases = new Set<string>();
  aliases.add(key.toLowerCase());

  // Friendly name from meta.conf (<friendly_name><short/><long/>).
  let name: string | null = null;
  const longName = meta.match(/<long>([^<]*)<\/long>/i)?.[1]?.trim();
  const shortName = meta.match(/<short>([^<]*)<\/short>/i)?.[1]?.trim();
  name = longName || shortName || null;

  const vendor = tag(main, "vendor");
  const model = tag(main, "model");
  const ip = tag(main, "ipAddress");
  const port = tag(main, "port");
  if (ip) {
    aliases.add(ip.toLowerCase());
    if (port) aliases.add(`${ip}:${port}`.toLowerCase());
  }

  // GUIDs referenced by this object (binds it to events in the logs).
  const guids = main.match(GUID_RE) ?? [];
  for (const g of guids) aliases.add(g.toLowerCase());

  // Channel count (cameras).
  let channels: number | null = null;
  const ch = main.match(/<videoChannels[^>]*>\s*<count>(\d+)<\/count>/i);
  if (ch) channels = parseInt(ch[1], 10);

  // Archive volumes + bound source endpoints (links).
  const volumes: string[] = [];
  const links = new Set<string>();
  if (type === "archive") {
    const labelRe = /<label>([^<]+)<\/label>/gi;
    let m: RegExpExecArray | null;
    while ((m = labelRe.exec(main))) volumes.push(m[1].trim());
    const nameRe = /<name>([^<]*\/[^<]*)<\/name>/gi;
    while ((m = nameRe.exec(main))) {
      const ref = m[1].trim();
      const objKey = ref.split("/")[0];
      if (/\.\w/.test(objKey)) {
        links.add(objKey);
        aliases.add(ref.toLowerCase());
      }
    }
  }

  return {
    key,
    type,
    name,
    vendor,
    model,
    ip,
    channels,
    volumes: volumes.length ? volumes : undefined,
    links: links.size ? [...links] : undefined,
    aliases: [...aliases],
  };
}

export async function parseConfigInventory(
  reportDir: string,
): Promise<ConfigInventory | null> {
  const repo = await findConfigRepo(reportDir);
  if (!repo) return null;

  let entries: string[] = [];
  try {
    entries = await readdir(repo);
  } catch {
    return null;
  }

  const objects: ConfigObject[] = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue; // skip .hg
    const dir = join(repo, name);
    try {
      if (!(await stat(dir)).isDirectory()) continue;
    } catch {
      continue;
    }
    const obj = await parseObject(dir, name);
    if (obj) objects.push(obj);
  }

  if (!objects.length) return null;

  const counts = { camera: 0, archive: 0, detector: 0, service: 0 };
  for (const o of objects) counts[o.type]++;

  return { objects, counts };
}

// Resolve a single raw entity ("object:DeviceIpint.1", "address:1.2.3.4",
// "object:<guid>") to a canonical inventory entity ("camera:DeviceIpint.1").
export interface EntityResolution {
  resolve: (rawEntity: string) => { entity: string; label: string } | null;
  has: boolean;
}

export function buildEntityResolver(
  inventory: ConfigInventory | null | undefined,
): EntityResolution {
  if (!inventory) return { resolve: () => null, has: false };
  const alias = new Map<string, { entity: string; label: string }>();
  for (const o of inventory.objects) {
    const entity = `${o.type}:${o.key}`;
    const label = o.name ? `${kindWord(o.type)} «${o.name}» (${o.key})` : `${kindWord(o.type)} ${o.key}`;
    for (const a of o.aliases) {
      if (!alias.has(a)) alias.set(a, { entity, label });
    }
  }
  return {
    has: alias.size > 0,
    resolve: (raw: string) => {
      const idx = raw.indexOf(":");
      const value = (idx >= 0 ? raw.slice(idx + 1) : raw).toLowerCase();
      return alias.get(value) ?? null;
    },
  };
}

function kindWord(t: ConfigObjectType): string {
  return t === "camera"
    ? "Камера"
    : t === "archive"
      ? "Архив"
      : t === "detector"
        ? "Детектор"
        : "Служба";
}

// Strip internal aliases before storing the inventory in the report.
export function inventoryForReport(inv: ConfigInventory): ConfigInventory {
  return {
    counts: inv.counts,
    objects: inv.objects.map((o) => ({ ...o, aliases: [] })),
  };
}
