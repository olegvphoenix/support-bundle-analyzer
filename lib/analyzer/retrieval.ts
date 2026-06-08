import type {
  RetrievalResult,
  RetrievedSource,
  BundleProfile,
  ProductFamily,
  Subsystem,
} from "./types";
import { lexiroAnswerGrounded, type LexiroDocument } from "./lexiro-mcp";

// Lexiro RAG client.
//
// Real Lexiro is reached over MCP (streamable-HTTP) at e.g. https://lexiro.io/mcp/
// using the `answer_grounded` tool. When the configured URL contains "/mcp",
// the MCP path is used; otherwise a legacy REST `answer_grounded` endpoint is
// assumed (kept for flexibility / self-hosted gateways).
//
// Gracefully degrades to null when not configured or on any error, so the
// pipeline still produces rule/LLM output without RAG.

export interface RagSettings {
  enabled: boolean;
  url: string | null;
  apiKey: string | null;
}

export interface RetrieveOpts {
  subsystem?: Subsystem;
}

const cache = new Map<string, RetrievalResult>();

// Map our internal product family to a Lexiro catalog product hint (soft bias).
// Lexiro names AxxonOne/Axxon Next as "ИнтеллектX" (5.x) / "Интеллект" (legacy).
function productHintFor(family: ProductFamily): string | null {
  switch (family) {
    case "axxon5":
      return "ИнтеллектX";
    case "axxon3":
      return "Интеллект";
    default:
      return null;
  }
}

// Soft topic hints per subsystem, biasing retrieval toward the right docs/spaces
// (e.g. the dedicated "Сервер лицензирования" space for license issues).
function topicHintsFor(subsystem?: Subsystem): string[] {
  switch (subsystem) {
    case "license":
      return ["Сервер лицензирования", "лицензирование", "Guardant"];
    case "cameras":
      return ["Drivers Pack", "камеры", "драйвер устройства"];
    case "archive":
      return ["архив", "MMSS", "хранилище"];
    case "detectors":
      return ["детекторы", "аналитика"];
    case "network":
      return ["сеть", "подключение"];
    case "hardware":
      return ["оборудование", "сервер"];
    default:
      return [];
  }
}

// Lexiro documents that come from indexed Jira projects are labeled with a
// product_name like "Jira: SUPPORT". Show those as historical "jira" sources.
function mapSourceKind(d: LexiroDocument): RetrievedSource["kind"] {
  if ((d.product_name ?? "").toLowerCase().startsWith("jira")) return "jira";
  if (d.source_type === "web" || d.source_type === "confluence") return "doc";
  return "doc";
}

export async function retrieveSolution(
  query: string,
  profile: BundleProfile,
  contextHint?: string,
  settings?: RagSettings,
  opts?: RetrieveOpts,
): Promise<RetrievalResult | null> {
  if (settings && !settings.enabled) return null;
  const base = settings?.url ?? process.env.LEXIRO_API_URL ?? null;
  const key = settings?.apiKey ?? process.env.LEXIRO_API_KEY ?? null;
  if (!base) return null;

  const cacheKey = `${query}|${profile.version}|${opts?.subsystem ?? ""}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const locale = profile.locale === "en" ? "en" : "ru";

  if (base.includes("/mcp")) {
    const ans = await lexiroAnswerGrounded({
      url: base,
      apiKey: key,
      query,
      contextHint: contextHint ?? null,
      productHint: productHintFor(profile.productFamily),
      topicHints: topicHintsFor(opts?.subsystem),
      versionHint: profile.version,
      locale,
    });
    if (!ans || ans.status !== "ok" || !ans.answer_md) return null;
    const result: RetrievalResult = {
      problemTitle: query,
      answer: ans.answer_md,
      confidence: ans.confidence ?? 0,
      sources: (ans.documents ?? []).slice(0, 6).map((d) => ({
        kind: mapSourceKind(d),
        title: d.title,
        url: d.source_url ?? null,
        snippet: "",
        similarity: d.rerank_score ?? d.similarity,
      })),
    };
    cache.set(cacheKey, result);
    return result;
  }

  // Legacy REST fallback.
  return retrieveViaRest(query, profile, contextHint, base, key, cacheKey, locale);
}

interface LexiroRestDocument {
  title: string;
  source_type: "confluence" | "github" | "web" | "archive" | "upload";
  source_url: string | null;
  similarity?: number;
  product_name?: string | null;
}

interface LexiroRestResponse {
  status: "ok" | "error";
  answer_md: string;
  confidence: number;
  documents?: LexiroRestDocument[];
}

async function retrieveViaRest(
  query: string,
  profile: BundleProfile,
  contextHint: string | undefined,
  base: string,
  key: string | null,
  cacheKey: string,
  locale: "ru" | "en",
): Promise<RetrievalResult | null> {
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/answer_grounded`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        query,
        context_hint: contextHint ?? null,
        products: profile.productName ? [profile.productName] : null,
        version_hint: profile.version,
        locale,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as LexiroRestResponse;
    if (data.status !== "ok") return null;
    const result: RetrievalResult = {
      problemTitle: query,
      answer: data.answer_md,
      confidence: data.confidence,
      sources: (data.documents ?? []).slice(0, 6).map((d) => ({
        kind: (d.product_name ?? "").toLowerCase().startsWith("jira")
          ? "jira"
          : "doc",
        title: d.title,
        url: d.source_url,
        snippet: "",
        similarity: d.similarity,
      })),
    };
    cache.set(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}
