import type { AnalysisReport } from "@/lib/analyzer/types";

const SEV_LABEL: Record<string, string> = {
  critical: "КРИТИЧНО",
  warning: "ПРЕДУПРЕЖДЕНИЕ",
  info: "ИНФО",
  noise: "ШУМ",
};

export function reportToMarkdown(r: AnalysisReport, filename: string): string {
  const lines: string[] = [];
  lines.push(`# Анализ саппорт-бандла: ${filename}`);
  lines.push("");
  lines.push(`- **Продукт:** ${r.profile.productName} (${r.profile.productFamily})`);
  lines.push(`- **Версия:** ${r.profile.version ?? "—"}`);
  lines.push(`- **Хост:** ${r.profile.host ?? "—"}`);
  lines.push(`- **Здоровье системы:** ${r.healthScore}/100`);
  lines.push(`- **Метод анализа:** ${r.analyzedBy === "llm" ? "ИИ + правила" : "правила"}`);
  lines.push(`- **Дата:** ${new Date(r.createdAt).toLocaleString("ru-RU")}`);
  lines.push("");
  lines.push(`> ${r.summary}`);
  lines.push("");
  lines.push(
    `**Статистика:** сигнатур ${r.stats.totalSignatures}, ошибок ${r.stats.errorCount}, предупреждений ${r.stats.warnCount}, логов ${r.stats.logFiles}.`,
  );
  lines.push("");

  lines.push("## Проблемы");
  if (!r.problems.length) lines.push("_Не обнаружено._");
  r.problems.forEach((p, i) => {
    lines.push("");
    lines.push(`### ${i + 1}. [${SEV_LABEL[p.severity]}] ${p.title}`);
    lines.push(`- Повторов: ${p.count}${p.storm ? " (шторм)" : ""}`);
    lines.push(`- Подсистема: ${p.subsystem}`);
    if (p.rootCause) lines.push(`- **Причина:** ${p.rootCause}`);
    if (p.impact) lines.push(`- **Влияние:** ${p.impact}`);
    if (p.solution.length) {
      lines.push("- **Решение:**");
      p.solution.forEach((s) => lines.push(`  - ${s}`));
    }
    if (p.sources.length) {
      lines.push("- **Источники:**");
      p.sources.forEach((s) =>
        lines.push(`  - [${s.kind}] ${s.title}${s.url ? ` — ${s.url}` : ""}`),
      );
    }
    if (p.sampleMessages[0]) {
      lines.push("- Пример:");
      lines.push("  ```");
      lines.push(`  ${p.sampleMessages[0].split("\n")[0]}`);
      lines.push("  ```");
    }
  });

  if (r.noise.length) {
    lines.push("");
    lines.push("## Подавленный шум");
    r.noise.forEach((n) => lines.push(`- ${n.title} ×${n.count}`));
  }

  return lines.join("\n");
}
