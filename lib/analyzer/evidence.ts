import type {
  BundleProfile,
  ConfigInventory,
  CorrelationGroup,
  DetectedProblem,
  RetrievalResult,
  SystemFacts,
} from "./types";
import { createRedactor } from "./redact";
import { formatCorrelationsForPrompt } from "./correlate";

export interface EvidencePack {
  text: string;
  problemIndex: { idx: number; ruleId: string | null; title: string }[];
}

// Rough char budget (~4 chars/token). Keeps the prompt bounded regardless of
// how large the original bundle was.
const CHAR_BUDGET = 24000;

export function buildEvidencePack(
  profile: BundleProfile,
  facts: SystemFacts,
  problems: DetectedProblem[],
  retrievals: Map<string, RetrievalResult>,
  correlations: CorrelationGroup[] = [],
  inventory?: ConfigInventory | null,
): EvidencePack {
  const redactor = createRedactor();
  const lines: string[] = [];
  const problemIndex: EvidencePack["problemIndex"] = [];

  lines.push("=== ПРОФИЛЬ СИСТЕМЫ ===");
  lines.push(`Продукт: ${profile.productName} (семейство ${profile.productFamily})`);
  lines.push(`Версия: ${profile.version ?? "неизвестно"}`);
  lines.push(`Локаль: ${profile.locale}`);
  lines.push("");

  lines.push("=== СИСТЕМНЫЕ ФАКТЫ ===");
  lines.push(`Ключ Guardant найден: ${facts.licenseDongleFound ? "да" : "НЕТ"}`);
  lines.push(`Модулей: ${facts.modulesCount ?? "?"}, открытых портов: ${facts.openPortsCount ?? "?"}`);
  for (const d of facts.disks) {
    const pct = d.totalMb ? Math.round((d.freeMb / d.totalMb) * 100) : 0;
    lines.push(`Диск ${d.name}: свободно ${pct}% (${Math.round(d.freeMb)}/${Math.round(d.totalMb)} МБ)`);
  }
  for (const n of facts.notes) lines.push(`! ${n}`);
  lines.push("");

  if (inventory && inventory.objects.length) {
    const c = inventory.counts;
    lines.push("=== КОНФИГУРАЦИЯ ОБЪЕКТА ===");
    lines.push(
      `Камер: ${c.camera}, архивов: ${c.archive}, детекторов: ${c.detector}, служб: ${c.service}`,
    );
    for (const o of inventory.objects.filter((o) => o.type !== "service").slice(0, 30)) {
      const bits = [o.name, o.model, o.ip ? redactor.redact(o.ip) : null]
        .filter(Boolean)
        .join(", ");
      lines.push(`  [${o.type}] ${o.key}${bits ? ` — ${bits}` : ""}`);
    }
    lines.push("");
  }

  lines.push("=== ОБНАРУЖЕННЫЕ ПРОБЛЕМЫ (по сигнатурам) ===");
  problems.forEach((p, idx) => {
    problemIndex.push({ idx, ruleId: p.ruleId, title: p.title });
    lines.push(
      `#${idx} [${p.severity}/${p.subsystem}] ${p.title} — повторов: ${p.count}${p.storm ? " (ШТОРМ)" : ""}`,
    );
    if (p.ruleId) lines.push(`  rule: ${p.ruleId}`);
    const sample = p.evidence[0];
    if (sample) {
      lines.push(`  компонент: ${sample.component ?? "—"}`);
      lines.push(`  пример: ${redactor.redact(sample.sampleMessage).slice(0, 300)}`);
    }
    const r = retrievals.get(p.retrievalQuery);
    if (r) {
      lines.push(`  RAG (conf ${r.confidence.toFixed(2)}): ${r.answer.slice(0, 400)}`);
      for (const s of r.sources.slice(0, 3)) {
        lines.push(`    - [${s.kind}] ${s.title}${s.url ? ` (${s.url})` : ""}`);
      }
    }
    lines.push("");
  });

  const corrText = formatCorrelationsForPrompt(correlations);
  if (corrText) {
    lines.push(corrText);
    lines.push(
      "Подсказка: события в одной цепочке относятся к одной сущности — оцени, " +
        "не является ли более раннее событие первопричиной последующих.",
    );
    lines.push("");
  }

  let text = lines.join("\n");
  if (text.length > CHAR_BUDGET) text = text.slice(0, CHAR_BUDGET) + "\n…(обрезано)";
  return { text, problemIndex };
}
