import type { CorrelationGroup, LogRecord } from "./types";

// Extracts normalized "entity" identifiers a log line refers to. Entities are
// the real-world things events happen to — cameras, internal objects/endpoints,
// network addresses, worker threads. Correlating problems that share an entity
// is how we reconstruct a chain of events around one object, even when the
// individual log lines live in different subsystems and files.
//
// An entity is encoded as `kind:value` (e.g. "camera:1.1", "object:DeviceIpint.5").

export type EntityKind = CorrelationGroup["entityKind"];

// Axxon object/endpoint tokens: DeviceIpint.5, Camera.1.1, SourceEndpoint.video, Ipint.3
const OBJECT_RE = /\b([A-Za-z]{3,}(?:\.\d+){1,4})\b/g;
// GUIDs (object identity in many subsystems).
const GUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// Explicit camera/channel references with a numeric id.
const CAMERA_RE =
  /(?:камер[а-я]*|canal|канал[а-я]*|camera|channel|device|устройств[а-я]*)\s*[#№:]?\s*(\d[\w.\-]*)/gi;

function add(set: Set<string>, kind: EntityKind, value: string) {
  const v = value.trim();
  if (v) set.add(`${kind}:${v}`);
}

export function extractEntities(rec: LogRecord): string[] {
  const set = new Set<string>();
  const msg = rec.message;

  if (rec.address) add(set, "address", rec.address);

  let m: RegExpExecArray | null;

  GUID_RE.lastIndex = 0;
  while ((m = GUID_RE.exec(msg))) add(set, "object", m[0].toLowerCase());

  OBJECT_RE.lastIndex = 0;
  while ((m = OBJECT_RE.exec(msg))) add(set, "object", m[1]);

  CAMERA_RE.lastIndex = 0;
  while ((m = CAMERA_RE.exec(msg))) add(set, "camera", m[1]);

  // Thread is a weak signal on its own (reused across unrelated tasks), but
  // useful when several events on the same thread cluster in a short window.
  if (rec.thread) add(set, "thread", rec.thread);

  // Bound the per-line entity set to avoid runaway cardinality.
  return [...set].slice(0, 6);
}

export function splitEntity(entity: string): { kind: EntityKind; value: string } {
  const idx = entity.indexOf(":");
  const kind = entity.slice(0, idx) as EntityKind;
  return { kind, value: entity.slice(idx + 1) };
}

const KIND_LABEL: Record<EntityKind, string> = {
  camera: "Камера",
  archive: "Архив",
  detector: "Детектор",
  service: "Служба",
  object: "Объект",
  address: "Адрес",
  thread: "Поток",
};

export function entityLabel(entity: string): string {
  const { kind, value } = splitEntity(entity);
  return `${KIND_LABEL[kind] ?? kind} ${value}`;
}
