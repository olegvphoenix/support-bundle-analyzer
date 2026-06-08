import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  ConfigInventory,
  ConfigObject,
  EquipmentComponent,
} from "./types";

// Parses the object configuration shipped in a support bundle under
// Report/Config.local/config_repo/<Object.id>/{main,meta,offers}.conf.
//
// Everything — the equipment *type* and its *composition* — is taken from the
// config itself, not hardcoded:
//   - type/class  = the object class (dir name without the instance suffix)
//   - composition = the endpoint types the object offers (offers.conf)
//   - topology    = media references between objects (offers.conf), which let
//                   us build an equipment tree (a camera, its archive, its
//                   detectors) and reconstruct chains of events along it.

const GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// A config reference value, e.g. "DeviceIpint.1/SourceEndpoint.video:0:0".
const REF_RE = /<value>([A-Za-z][\w]*\.[\w]+\/[^<\s]+)<\/value>/gi;
// Event/plumbing endpoints are wiring, not physical equipment topology — they
// connect almost everything, so excluding them keeps equipment trees meaningful.
const PLUMBING_RE = /event(channel|consumer|supplier|database)|asipdatabase/i;

function firstTag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`, "i"));
  return m ? m[1].trim() || null : null;
}

// Split a directory name into class + instance on the LAST dot.
function splitKey(key: string): { cls: string; instance: string } {
  const i = key.lastIndexOf(".");
  if (i <= 0) return { cls: key, instance: "" };
  return { cls: key.slice(0, i), instance: key.slice(i + 1) };
}

async function findConfigRepo(reportDir: string): Promise<string | null> {
  for (const c of [
    join(reportDir, "Config.local", "config_repo"),
    join(reportDir, "Config.local", "clone_config_repo"),
  ]) {
    if (existsSync(c)) return c;
  }
  return null;
}

interface RawObject extends ConfigObject {
  rawRefs: string[]; // raw reference values before resolving to known objects
}

async function parseObject(dir: string, key: string): Promise<RawObject | null> {
  const read = async (n: string) => {
    try {
      return await readFile(join(dir, n), "utf8");
    } catch {
      return "";
    }
  };
  const main = await read("main.conf");
  const meta = await read("meta.conf");
  const offers = await read("offers.conf");
  if (!main && !meta && !offers) return null;

  const { cls, instance } = splitKey(key);

  // Composition: offered endpoint types (top-level offer items are followed by
  // an <interface> tag, which distinguishes them from property <type> tags).
  const offered: string[] = [];
  const offerRe = /<type>([^<]+)<\/type>\s*<interface>/gi;
  let m: RegExpExecArray | null;
  while ((m = offerRe.exec(offers))) {
    if (!offered.includes(m[1].trim())) offered.push(m[1].trim());
  }

  // Friendly name: prefer a non-empty friendly_name from offers, then meta.
  let name: string | null = null;
  const fnRe = /<name>friendly_name<\/name>\s*<value>([^<]*)<\/value>/gi;
  while ((m = fnRe.exec(offers))) {
    if (m[1].trim()) {
      name = m[1].trim();
      break;
    }
  }
  if (!name) {
    name =
      meta.match(/<long>([^<]*)<\/long>/i)?.[1]?.trim() ||
      meta.match(/<short>([^<]*)<\/short>/i)?.[1]?.trim() ||
      null;
  }

  const model = firstTag(main, "model");
  const ip = firstTag(main, "ipAddress");
  const port = firstTag(main, "port");

  // Aliases: how this object appears in logs — its key, IP, GUIDs and its own
  // access points (references whose target is this object itself).
  const aliases = new Set<string>([key.toLowerCase()]);
  if (ip) {
    aliases.add(ip.toLowerCase());
    if (port) aliases.add(`${ip}:${port}`.toLowerCase());
  }
  for (const g of main.match(GUID_RE) ?? []) aliases.add(g.toLowerCase());
  for (const g of offers.match(GUID_RE) ?? []) aliases.add(g.toLowerCase());

  // References to other objects, from offers.conf and main.conf.
  const rawRefs: string[] = [];
  for (const text of [offers, main]) {
    REF_RE.lastIndex = 0;
    while ((m = REF_RE.exec(text))) {
      const value = m[1].trim();
      const target = value.split("/")[0];
      if (target.toLowerCase() === key.toLowerCase()) {
        aliases.add(value.toLowerCase()); // own access point
      } else if (!PLUMBING_RE.test(value)) {
        rawRefs.push(target);
      }
    }
  }

  return {
    key,
    cls,
    instance,
    name,
    offers: offered,
    refs: [],
    ip,
    model,
    componentId: -1,
    aliases: [...aliases],
    rawRefs,
  };
}

// Union-find for grouping objects into equipment components.
function connectedComponents(
  objects: RawObject[],
): { components: EquipmentComponent[]; idOf: Map<string, number> } {
  const keys = objects.map((o) => o.key);
  const parent = new Map<string, string>(keys.map((k) => [k, k]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== c) {
      const next = parent.get(c)!;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const known = new Set(keys);
  const inDegree = new Map<string, number>(keys.map((k) => [k, 0]));
  for (const o of objects) {
    const refs = [...new Set(o.rawRefs.filter((r) => known.has(r) && r !== o.key))];
    o.refs = refs;
    for (const r of refs) {
      union(o.key, r);
      inDegree.set(r, (inDegree.get(r) ?? 0) + 1);
    }
  }

  const groups = new Map<string, string[]>();
  for (const k of keys) {
    const root = find(k);
    const arr = groups.get(root);
    if (arr) arr.push(k);
    else groups.set(root, [k]);
  }

  const byKey = new Map(objects.map((o) => [o.key, o]));
  const components: EquipmentComponent[] = [];
  const idOf = new Map<string, number>();
  let id = 0;
  for (const members of groups.values()) {
    // Hub = the most-referenced member (a camera is referenced by its archive
    // and detectors). Tie-break by richest composition.
    const hub = members
      .slice()
      .sort(
        (a, b) =>
          (inDegree.get(b) ?? 0) - (inDegree.get(a) ?? 0) ||
          (byKey.get(b)?.offers.length ?? 0) - (byKey.get(a)?.offers.length ?? 0),
      )[0];
    const hubObj = byKey.get(hub)!;
    const label = hubObj.name ? `${hubObj.cls} «${hubObj.name}»` : hubObj.key;
    for (const k of members) idOf.set(k, id);
    components.push({ id, hubKey: hub, label, memberKeys: members });
    id++;
  }
  return { components, idOf };
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

  const raw: RawObject[] = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const dir = join(repo, name);
    try {
      if (!(await stat(dir)).isDirectory()) continue;
    } catch {
      continue;
    }
    const obj = await parseObject(dir, name);
    if (obj) raw.push(obj);
  }
  if (!raw.length) return null;

  const { components, idOf } = connectedComponents(raw);
  for (const o of raw) o.componentId = idOf.get(o.key) ?? -1;

  const classCounts = new Map<string, number>();
  for (const o of raw) classCounts.set(o.cls, (classCounts.get(o.cls) ?? 0) + 1);
  const classes = [...classCounts.entries()]
    .map(([cls, count]) => ({ cls, count }))
    .sort((a, b) => b.count - a.count || a.cls.localeCompare(b.cls));

  const objects: ConfigObject[] = raw.map(({ rawRefs: _r, ...o }) => o);
  return { objects, classes, components };
}

// Resolve a raw log entity to the equipment component it belongs to, so chains
// of events get grouped along the equipment tree (camera + archive + detectors).
export interface EntityResolution {
  resolve: (rawEntity: string) => { entity: string; label: string } | null;
  has: boolean;
}

export function buildEntityResolver(
  inventory: ConfigInventory | null | undefined,
): EntityResolution {
  if (!inventory) return { resolve: () => null, has: false };
  const compByKey = new Map(
    inventory.components.flatMap((c) => c.memberKeys.map((k) => [k, c])),
  );
  const compMembers = new Map(
    inventory.components.map((c) => [c.id, c.memberKeys.length]),
  );
  const alias = new Map<string, { entity: string; label: string }>();
  for (const o of inventory.objects) {
    const comp = compByKey.get(o.key);
    if (!comp) continue;
    const extra = (compMembers.get(comp.id) ?? 1) - 1;
    const label = extra > 0 ? `${comp.label} +${extra}` : comp.label;
    const value = { entity: `equipment:${comp.hubKey}`, label };
    for (const a of o.aliases) if (!alias.has(a)) alias.set(a, value);
  }
  return {
    has: alias.size > 0,
    resolve: (raw: string) => {
      const idx = raw.indexOf(":");
      const v = (idx >= 0 ? raw.slice(idx + 1) : raw).toLowerCase();
      return alias.get(v) ?? null;
    },
  };
}

// Strip internal aliases before storing the inventory in the report.
export function inventoryForReport(inv: ConfigInventory): ConfigInventory {
  return {
    classes: inv.classes,
    components: inv.components,
    objects: inv.objects.map((o) => ({ ...o, aliases: [] })),
  };
}
