import { eq } from "drizzle-orm";
import { db } from "@/db";
import { rules as rulesTable, type RuleRow } from "@/db/schema";
import type { ProductFamily, Rule } from "@/lib/analyzer/types";

// Loads user-defined rules from the DB (in addition to the built-in YAML base).
// These are editable in the UI and can be captured directly from analysis
// findings ("save as rule"), which is what makes the analyzer learnable.
// A short in-memory cache keeps repeated pipeline runs cheap; the cache is
// bypassed (and the call fails soft) so a missing/empty DB never breaks runs.

const CACHE_TTL_MS = 30_000;
let cache: { at: number; rules: Rule[] } | null = null;

export function ruleRowToRule(r: RuleRow): Rule {
  return {
    id: r.key,
    severity: r.severity as Rule["severity"],
    subsystem: r.subsystem as Rule["subsystem"],
    title: r.title,
    match: {
      component: r.matchComponent ?? undefined,
      anyOf: r.matchAnyOf.length ? r.matchAnyOf : undefined,
      allOf: r.matchAllOf.length ? r.matchAllOf : undefined,
    },
    frequency: r.freqMinPerMinute
      ? { minPerMinute: r.freqMinPerMinute }
      : undefined,
    cause: r.cause ?? undefined,
    solution: r.solution.length ? r.solution : undefined,
    appliesTo: r.appliesTo.length ? (r.appliesTo as ProductFamily[]) : undefined,
    retrievalQuery: r.retrievalQuery ?? undefined,
  };
}

export async function loadDbRules(force = false): Promise<Rule[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.rules;
  }
  try {
    const rows = await db
      .select()
      .from(rulesTable)
      .where(eq(rulesTable.enabled, 1));
    const mapped = rows.map(ruleRowToRule);
    cache = { at: Date.now(), rules: mapped };
    return mapped;
  } catch (err) {
    console.warn("DB rules load failed, using built-in rules only:", err);
    return [];
  }
}

export function invalidateRulesCache(): void {
  cache = null;
}
