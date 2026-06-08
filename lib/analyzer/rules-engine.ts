import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  AggregatedSignature,
  DetectedProblem,
  ProductFamily,
  Rule,
  Severity,
} from "./types";

const RULES_DIR = join(process.cwd(), "lib", "analyzer", "rules");

export async function loadRules(dir = RULES_DIR): Promise<Rule[]> {
  const files = (await readdir(dir)).filter(
    (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
  );
  const rules: Rule[] = [];
  for (const f of files) {
    const doc = parseYaml(await readFile(join(dir, f), "utf8"));
    if (Array.isArray(doc?.rules)) rules.push(...(doc.rules as Rule[]));
  }
  return rules;
}

function contains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function matches(rule: Rule, sig: AggregatedSignature, family: ProductFamily): boolean {
  if (rule.appliesTo && rule.appliesTo.length && !rule.appliesTo.includes(family)) {
    return false;
  }
  const hay = `${sig.component ?? ""} ${sig.sampleMessage}`;
  if (rule.match.component && !contains(sig.component ?? "", rule.match.component)) {
    return false;
  }
  if (rule.match.allOf && !rule.match.allOf.every((p) => contains(hay, p))) {
    return false;
  }
  if (rule.match.anyOf && !rule.match.anyOf.some((p) => contains(hay, p))) {
    return false;
  }
  if (rule.frequency?.minPerMinute && sig.peakPerMinute < rule.frequency.minPerMinute) {
    return false;
  }
  // A rule must have at least one positive matcher.
  return Boolean(rule.match.component || rule.match.anyOf || rule.match.allOf);
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
  noise: 3,
};

/**
 * Apply rules to aggregated signatures. Returns detected problems grouped by
 * rule, plus "unknown" problems for high-volume unmatched non-noise signatures
 * (handed to the LLM for fallback analysis).
 */
export function applyRules(
  signatures: AggregatedSignature[],
  rules: Rule[],
  family: ProductFamily,
  opts: { unknownMinCount?: number; maxUnknown?: number } = {},
): { problems: DetectedProblem[]; noiseLineCount: number } {
  const { unknownMinCount = 20, maxUnknown = 8 } = opts;
  const byRule = new Map<string, DetectedProblem>();
  const unknownCandidates: AggregatedSignature[] = [];
  let noiseLineCount = 0;

  for (const sig of signatures) {
    const rule = rules.find((r) => matches(r, sig, family));
    if (rule) {
      if (rule.severity === "noise") noiseLineCount += sig.count;
      let p = byRule.get(rule.id);
      if (!p) {
        p = {
          ruleId: rule.id,
          severity: rule.severity,
          subsystem: rule.subsystem,
          title: rule.title,
          cause: rule.cause,
          solution: rule.solution,
          count: 0,
          storm: false,
          evidence: [],
          retrievalQuery: rule.retrievalQuery ?? rule.title,
        };
        byRule.set(rule.id, p);
      }
      p.count += sig.count;
      p.storm = p.storm || sig.storm;
      if (p.evidence.length < 5) p.evidence.push(sig);
    } else if (
      (sig.level === "ERROR" || sig.level === "WARN") &&
      sig.count >= unknownMinCount
    ) {
      unknownCandidates.push(sig);
    }
  }

  const problems = [...byRule.values()];

  // Unknown / unmatched problems for LLM fallback.
  unknownCandidates
    .sort((a, b) => b.count - a.count)
    .slice(0, maxUnknown)
    .forEach((sig) => {
      problems.push({
        ruleId: null,
        severity: sig.level === "ERROR" ? "warning" : "info",
        subsystem: "other",
        title: sig.sampleMessage.slice(0, 100),
        count: sig.count,
        storm: sig.storm,
        evidence: [sig],
        retrievalQuery: `${sig.component ?? ""} ${sig.sampleMessage}`.slice(0, 200),
      });
    });

  problems.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.count - a.count,
  );

  return { problems, noiseLineCount };
}
