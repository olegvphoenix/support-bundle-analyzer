import { z } from "zod";
import type { EvidencePack } from "./evidence";

export interface LlmSettings {
  model: string;
  apiKey: string | null;
}

export const RcaProblemSchema = z.object({
  title: z.string().describe("Краткий заголовок проблемы"),
  severity: z.enum(["critical", "warning", "info"]),
  subsystem: z.enum([
    "license",
    "cameras",
    "archive",
    "detectors",
    "network",
    "hardware",
    "other",
  ]),
  rootCause: z.string().describe("Корневая причина простыми словами"),
  impact: z.string().describe("На что влияет"),
  solution: z.array(z.string()).describe("Пошаговые действия для устранения"),
  evidenceRefs: z
    .array(z.number())
    .describe("Индексы #N проблем из evidence-пакета, на которые опирается вывод"),
  confidence: z.number().min(0).max(1),
});

export const RcaResultSchema = z.object({
  summary: z.string().describe("Итог в 1-2 предложениях для инженера поддержки"),
  healthScore: z
    .number()
    .min(0)
    .max(100)
    .describe("Оценка здоровья системы 0-100"),
  problems: z.array(RcaProblemSchema),
});

export type RcaResult = z.infer<typeof RcaResultSchema>;

const SYSTEM_PROMPT = `Ты — старший инженер техподдержки систем видеонаблюдения на платформе AxxonOne/Axxon Next (включая OEM-сборки).
Тебе дают evidence-пакет: профиль системы, системные факты и список проблем, агрегированных по сигнатурам логов, иногда с подсказками из базы знаний (RAG: прошлые тикеты Jira и документация).
Задача: определить КОРНЕВЫЕ причины, отделить реальные проблемы от шума, дать конкретные шаги решения.
Правила:
- Отвечай на русском.
- Опирайся ТОЛЬКО на предоставленные данные; не выдумывай факты.
- Если есть подсказка RAG — используй её и предпочитай проверенные решения.
- Указывай evidenceRefs (индексы #N) для каждого вывода.
- healthScore: 90-100 если только шум; ниже при критичных проблемах (лицензия/архив).
- Не дублируй чистый шум как проблему.`;

export async function analyzeWithLlm(
  pack: EvidencePack,
  settings?: LlmSettings,
): Promise<RcaResult | null> {
  const apiKey = settings?.apiKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? null;
  if (!apiKey) return null;
  try {
    const { generateObject } = await import("ai");
    const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
    const model = settings?.model || process.env.LLM_MODEL || "gemini-1.5-pro";
    const google = createGoogleGenerativeAI({ apiKey });
    const { object } = await generateObject({
      model: google(model),
      schema: RcaResultSchema,
      system: SYSTEM_PROMPT,
      prompt: `Evidence-пакет:\n\n${pack.text}`,
      temperature: 0.2,
    });
    return object;
  } catch (err) {
    console.error("LLM analysis failed:", err);
    return null;
  }
}
