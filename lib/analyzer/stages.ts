// Canonical analysis stages, shared between the worker (orchestration) and the
// UI (stepper + per-stage restart controls). Keep this module free of Node-only
// imports so it can be bundled into client components.

export const STAGES = [
  { key: "extract", label: "Распаковка", progress: 2 },
  { key: "parse", label: "Парсинг логов", progress: 18 },
  { key: "timeline", label: "Лента событий", progress: 40 },
  { key: "rules", label: "Правила", progress: 57 },
  { key: "retrieval", label: "Ретривал (Lexiro)", progress: 69 },
  { key: "llm", label: "LLM-анализ", progress: 80 },
] as const;

export type StageKey = (typeof STAGES)[number]["key"];

export const STAGE_KEYS = STAGES.map((s) => s.key) as StageKey[];

export function stageIndex(key: StageKey): number {
  return STAGE_KEYS.indexOf(key);
}

export function stageStartProgress(key: StageKey): number {
  return STAGES[stageIndex(key)]?.progress ?? 0;
}

// A stage can be a restart point only if every stage it depends on has a stored
// checkpoint. `extract`/`parse` re-run from the archive, so they need none.
// Later stages need their predecessor's checkpoint (`available` holds the keys
// of stages whose output checkpoint is persisted in object storage).
export function canRestartFrom(key: StageKey, available: string[]): boolean {
  switch (key) {
    case "extract":
    case "parse":
    case "timeline":
      // timeline re-reads the extracted log files, like parse.
      return true;
    case "rules":
      return available.includes("parse");
    case "retrieval":
      return available.includes("rules");
    case "llm":
      return available.includes("retrieval");
    default:
      return false;
  }
}
