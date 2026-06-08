import type { RetrievalResult, RetrievedSource, BundleProfile } from "./types";

// Lexiro RAG client. Calls the `answer_grounded` capability over HTTP.
// Mirrors the MCP tool contract: query/context_hint/products/version_hint/locale
// -> { answer_md, confidence, documents[] }.
//
// Gracefully degrades to an empty result when LEXIRO_API_URL is not set, so the
// pipeline still produces rule/LLM output without RAG in local dev.

interface LexiroDocument {
  title: string;
  source_type: "confluence" | "github" | "web" | "archive" | "upload";
  source_url: string | null;
  similarity?: number;
  product_name?: string | null;
}

interface LexiroResponse {
  status: "ok" | "error";
  answer_md: string;
  confidence: number;
  documents?: LexiroDocument[];
  suggest_human?: boolean;
  error?: string;
}

const cache = new Map<string, RetrievalResult>();

function mapSourceKind(t: LexiroDocument["source_type"]): RetrievedSource["kind"] {
  // Jira tickets are typically ingested as confluence/archive; treat
  // non-doc-portal sources as "jira" historical knowledge, docs otherwise.
  return t === "web" || t === "confluence" ? "doc" : "jira";
}

export interface RagSettings {
  enabled: boolean;
  url: string | null;
  apiKey: string | null;
}

export async function retrieveSolution(
  query: string,
  profile: BundleProfile,
  contextHint?: string,
  settings?: RagSettings,
): Promise<RetrievalResult | null> {
  if (settings && !settings.enabled) return null;
  const base = settings?.url ?? process.env.LEXIRO_API_URL ?? null;
  const key = settings?.apiKey ?? process.env.LEXIRO_API_KEY ?? null;
  if (!base) return null;

  const cacheKey = `${query}|${profile.version}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

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
        locale: profile.locale === "en" ? "en" : "ru",
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as LexiroResponse;
    if (data.status !== "ok") return null;

    const result: RetrievalResult = {
      problemTitle: query,
      answer: data.answer_md,
      confidence: data.confidence,
      sources: (data.documents ?? []).slice(0, 6).map((d) => ({
        kind: mapSourceKind(d.source_type),
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
