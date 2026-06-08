import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";

// Effective runtime settings. Persisted as a single JSON document in the DB
// and overlaid on top of environment-variable defaults. Secrets stored here
// are acceptable because this is a self-hosted, single-tenant tool.
export interface AppSettings {
  // LLM
  llmProvider: string;
  llmModel: string;
  llmApiKey: string | null;
  tokenBudget: number;
  // RAG (Lexiro)
  ragEnabled: boolean;
  ragUrl: string | null;
  ragApiKey: string | null;
  // Privacy
  maskPii: boolean;
  // Storage / retention (informational + enforced on upload/retention jobs)
  s3Endpoint: string;
  s3Bucket: string;
  maxUploadGb: number;
  retentionDays: number;
}

// Fields that must never be returned to the client in clear text.
const SECRET_KEYS: (keyof AppSettings)[] = ["llmApiKey", "ragApiKey"];

export function envDefaults(): AppSettings {
  return {
    llmProvider: process.env.LLM_PROVIDER || "google",
    llmModel: process.env.LLM_MODEL || "gemini-1.5-pro",
    llmApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || null,
    tokenBudget: Number(process.env.LLM_TOKEN_BUDGET || 120000),
    ragEnabled: Boolean(process.env.LEXIRO_API_URL),
    ragUrl: process.env.LEXIRO_API_URL || null,
    ragApiKey: process.env.LEXIRO_API_KEY || null,
    maskPii: process.env.MASK_PII !== "false",
    s3Endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
    s3Bucket: process.env.S3_BUCKET || "bundles",
    maxUploadGb: Number(process.env.MAX_UPLOAD_GB || 5),
    retentionDays: Number(process.env.RETENTION_DAYS || 90),
  };
}

const CACHE_TTL_MS = 30_000;
let cache: { at: number; value: AppSettings } | null = null;

export async function loadSettings(force = false): Promise<AppSettings> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.value;
  }
  const base = envDefaults();
  try {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, 1))
      .limit(1);
    const stored = (row?.data ?? {}) as Partial<AppSettings>;
    const merged = mergeSettings(base, stored);
    cache = { at: Date.now(), value: merged };
    return merged;
  } catch (err) {
    console.warn("Settings load failed, using env defaults:", err);
    return base;
  }
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, 1))
    .limit(1);
  const prev = (row?.data ?? {}) as Partial<AppSettings>;
  // Empty-string secrets mean "leave unchanged" so the masked UI never wipes a key.
  const clean: Partial<AppSettings> = { ...patch };
  for (const k of SECRET_KEYS) {
    if (clean[k] === "" || clean[k] === undefined) delete clean[k];
  }
  const next = { ...prev, ...clean };
  if (row) {
    await db
      .update(appSettings)
      .set({ data: next as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(appSettings.id, 1));
  } else {
    await db.insert(appSettings).values({ id: 1, data: next as Record<string, unknown> });
  }
  cache = null;
  return mergeSettings(envDefaults(), next);
}

export function invalidateSettingsCache(): void {
  cache = null;
}

// Returns settings with secrets replaced by a presence flag for safe client use.
export function redactSettings(s: AppSettings): Omit<AppSettings, "llmApiKey" | "ragApiKey"> & {
  llmApiKeySet: boolean;
  ragApiKeySet: boolean;
} {
  const { llmApiKey, ragApiKey, ...rest } = s;
  return { ...rest, llmApiKeySet: Boolean(llmApiKey), ragApiKeySet: Boolean(ragApiKey) };
}

function mergeSettings(base: AppSettings, stored: Partial<AppSettings>): AppSettings {
  const out: AppSettings = { ...base };
  for (const [k, v] of Object.entries(stored)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v === "") continue;
    (out as unknown as Record<string, unknown>)[k] = v;
  }
  return out;
}
