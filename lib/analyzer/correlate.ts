import type {
  CorrelationGroup,
  CorrelationStep,
  Severity,
  Subsystem,
} from "./types";
import { entityLabel, splitEntity } from "./entities";

// Minimal shape needed to correlate; works for both detected problems
// (pre-LLM) and final report problems.
export interface CorrInput {
  id: string;
  title: string;
  subsystem: Subsystem;
  severity: Severity;
  firstTs: string | null;
  entities: string[];
}

const SEV_RANK: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
  noise: 3,
};

function worst(a: Severity, b: Severity): Severity {
  return SEV_RANK[a] <= SEV_RANK[b] ? a : b;
}

const KIND_PRIORITY: Record<string, number> = {
  camera: 0,
  archive: 0,
  detector: 0,
  service: 1,
  object: 1,
  address: 2,
  thread: 3,
};

/**
 * Group problems that share an entity (camera/object/address/thread) into
 * candidate causal chains, ordered in time. A shared entity across otherwise
 * separate problems is strong evidence they are part of the same incident.
 */
export function buildCorrelations(
  items: CorrInput[],
  opts: {
    maxGroups?: number;
    maxLinkedProblems?: number;
    labels?: Map<string, string>;
  } = {},
): CorrelationGroup[] {
  const { maxGroups = 8, maxLinkedProblems = 8, labels } = opts;
  const itemById = new Map(items.map((i) => [i.id, i]));
  const byEntity = new Map<string, Set<string>>();

  for (const it of items) {
    for (const e of it.entities ?? []) {
      let s = byEntity.get(e);
      if (!s) {
        s = new Set();
        byEntity.set(e, s);
      }
      s.add(it.id);
    }
  }

  const groups: CorrelationGroup[] = [];
  for (const [entity, ids] of byEntity) {
    // Need ≥2 problems to form a chain; skip entities that link almost
    // everything (e.g. the server's own address) as uninformative.
    if (ids.size < 2 || ids.size > maxLinkedProblems) continue;
    const { kind } = splitEntity(entity);
    const members = [...ids]
      .map((id) => itemById.get(id))
      .filter((m): m is CorrInput => Boolean(m));
    const subsystems = new Set(members.map((m) => m.subsystem));
    // Thread links are weak unless they span multiple subsystems.
    if (kind === "thread" && subsystems.size < 2) continue;

    const steps: CorrelationStep[] = members
      .map((m) => ({
        problemId: m.id,
        ts: m.firstTs,
        title: m.title,
        subsystem: m.subsystem,
        severity: m.severity,
      }))
      .sort((a, b) => (a.ts ?? "").localeCompare(b.ts ?? ""));

    const severity = members.reduce<Severity>(
      (acc, m) => worst(acc, m.severity),
      "noise",
    );
    const tss = steps.map((s) => s.ts).filter((t): t is string => Boolean(t));

    groups.push({
      entity,
      entityKind: kind,
      label: labels?.get(entity) ?? entityLabel(entity),
      severity,
      firstTs: tss[0] ?? null,
      lastTs: tss[tss.length - 1] ?? null,
      steps,
    });
  }

  // Drop groups whose member set is a subset of (or equal to) another group's,
  // keeping the more specific entity kind (camera/object over address/thread).
  const memberKey = (g: CorrelationGroup) =>
    g.steps
      .map((s) => s.problemId)
      .sort()
      .join("|");
  const bestByKey = new Map<string, CorrelationGroup>();
  for (const g of groups) {
    const k = memberKey(g);
    const prev = bestByKey.get(k);
    if (!prev || KIND_PRIORITY[g.entityKind] < KIND_PRIORITY[prev.entityKind]) {
      bestByKey.set(k, g);
    }
  }

  return [...bestByKey.values()]
    .sort(
      (a, b) =>
        SEV_RANK[a.severity] - SEV_RANK[b.severity] ||
        b.steps.length - a.steps.length ||
        (a.firstTs ?? "").localeCompare(b.firstTs ?? ""),
    )
    .slice(0, maxGroups);
}

/** Compact text rendering of correlations for the LLM evidence pack. */
export function formatCorrelationsForPrompt(groups: CorrelationGroup[]): string {
  if (!groups.length) return "";
  const lines: string[] = ["=== СВЯЗАННЫЕ СОБЫТИЯ (по общим сущностям) ==="];
  groups.forEach((g, i) => {
    lines.push(`Цепочка #${i + 1} — ${g.label} [${g.severity}]:`);
    for (const s of g.steps) {
      lines.push(`  ${s.ts ?? "?"} · [${s.subsystem}] ${s.title} (${s.problemId})`);
    }
  });
  lines.push("");
  return lines.join("\n");
}
