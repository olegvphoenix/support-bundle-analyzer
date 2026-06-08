// Run the analysis pipeline against an already-extracted bundle directory.
// Usage: npm run analyze:cli -- "D:\\Temp\\support_07-05-2026_16-09-55"
import { findReportDir } from "../lib/analyzer/ingest";
import { runPipeline } from "../lib/analyzer/pipeline";

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: npm run analyze:cli -- <path-to-extracted-bundle>");
    process.exit(1);
  }
  const reportDir = (await findReportDir(input)) ?? input;
  console.log(`Report dir: ${reportDir}\n`);

  const report = await runPipeline(reportDir, (stage, pct) => {
    process.stdout.write(`\r[${String(pct).padStart(3)}%] ${stage.padEnd(36)}`);
  });
  console.log("\n");

  console.log("=== ПРОФИЛЬ ===");
  console.log(report.profile);
  console.log("\n=== СТАТИСТИКА ===");
  console.log(report.stats);
  console.log(`\nЗдоровье: ${report.healthScore}/100  (анализ: ${report.analyzedBy})`);
  console.log(`Итог: ${report.summary}\n`);

  console.log("=== ПРОБЛЕМЫ ===");
  for (const p of report.problems) {
    console.log(`\n[${p.severity.toUpperCase()}] ${p.title}  (×${p.count}${p.storm ? ", ШТОРМ" : ""})`);
    if (p.rootCause) console.log(`  Причина: ${p.rootCause}`);
    if (p.solution.length) console.log(`  Решение: ${p.solution.join(" | ")}`);
    if (p.sampleMessages[0]) console.log(`  Пример: ${p.sampleMessages[0].split("\n")[0]}`);
  }

  console.log("\n=== ШУМ (подавлено) ===");
  for (const n of report.noise) console.log(`  ${n.title} ×${n.count}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
