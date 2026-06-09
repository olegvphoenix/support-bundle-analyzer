// Text embeddings for semantic log search. Uses the Google Generative AI
// embedding model via the Vercel AI SDK. Everything fails soft: if no API key
// is configured (or the call errors) we return null and the caller falls back
// to keyword search, so the player still works without embeddings.

export interface EmbedSettings {
  apiKey: string | null;
  model?: string;
}

const EMBED_MODEL = "text-embedding-004";
const BATCH = 96; // stay well under provider per-request limits

function resolveKey(settings?: EmbedSettings): string | null {
  return settings?.apiKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? null;
}

export async function embedTexts(
  texts: string[],
  settings?: EmbedSettings,
): Promise<number[][] | null> {
  const apiKey = resolveKey(settings);
  if (!apiKey || texts.length === 0) return null;
  try {
    const { embedMany } = await import("ai");
    const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
    const google = createGoogleGenerativeAI({ apiKey });
    const model = google.textEmbeddingModel(settings?.model || EMBED_MODEL);

    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const slice = texts.slice(i, i + BATCH);
      const { embeddings } = await embedMany({ model, values: slice });
      out.push(...embeddings);
    }
    return out;
  } catch (err) {
    console.warn("embedTexts failed (semantic search disabled):", err);
    return null;
  }
}

export async function embedQuery(
  text: string,
  settings?: EmbedSettings,
): Promise<number[] | null> {
  const res = await embedTexts([text], settings);
  return res?.[0] ?? null;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
