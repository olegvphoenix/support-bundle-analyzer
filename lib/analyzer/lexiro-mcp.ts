// Minimal MCP (streamable-HTTP) client for the Lexiro knowledge base.
//
// Lexiro exposes its capabilities over MCP at e.g. https://lexiro.io/mcp/ and
// requires an API key (Bearer) whose ACL determines which spaces/products are
// searchable. We use two tools:
//   - answer_grounded     -> a complete grounded answer + confidence + sources
//   - search_documentation-> raw chunks (fallback when grounded answer fails)
//
// The client is server-only (worker/pipeline). It is cached per (url, key) and
// reused across calls; on any transport error it is torn down and rebuilt.

type McpClient = {
  callTool: (args: { name: string; arguments: Record<string, unknown> }) => Promise<unknown>;
  close: () => Promise<void>;
};

interface CachedConn {
  key: string;
  client: McpClient;
}

let conn: CachedConn | null = null;

function normalizeMcpUrl(url: string): string {
  // Accept ".../mcp" or ".../mcp/"; the server canonical form is "/mcp/".
  let u = url.trim();
  if (!/\/mcp\/?$/.test(u)) u = u.replace(/\/$/, "") + "/mcp/";
  else if (!u.endsWith("/")) u = u + "/";
  return u;
}

async function getClient(url: string, apiKey: string | null): Promise<McpClient> {
  const cacheKey = `${url}|${apiKey ?? ""}`;
  if (conn && conn.key === cacheKey) return conn.client;
  if (conn) {
    await conn.client.close().catch(() => {});
    conn = null;
  }

  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import(
    "@modelcontextprotocol/sdk/client/streamableHttp.js"
  );

  const headers: Record<string, string> = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const transport = new StreamableHTTPClientTransport(new URL(normalizeMcpUrl(url)), {
    requestInit: { headers },
  });
  const client = new Client(
    { name: "support-bundle-analyzer", version: "0.1.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  const wrapped: McpClient = {
    callTool: (args) => client.callTool(args),
    close: () => client.close(),
  };
  conn = { key: cacheKey, client: wrapped };
  return wrapped;
}

// Extract the text payload from an MCP tool result and JSON-parse it if possible.
function parseToolResult(res: unknown): unknown {
  const r = res as { content?: Array<{ type?: string; text?: string }>; structuredContent?: unknown };
  if (r?.structuredContent && typeof r.structuredContent === "object") {
    const sc = r.structuredContent as { result?: unknown };
    if (typeof sc.result === "string") {
      try {
        return JSON.parse(sc.result);
      } catch {
        return sc.result;
      }
    }
    return r.structuredContent;
  }
  const text = r?.content?.find((c) => c.type === "text")?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export interface LexiroDocument {
  document_id?: string;
  title: string;
  source_type?: "confluence" | "github" | "web" | "archive" | "upload";
  source_url?: string | null;
  product_name?: string | null;
  similarity?: number;
  rerank_score?: number;
}

export interface LexiroAnswer {
  status: "ok" | "error";
  answer_md: string;
  confidence: number;
  documents: LexiroDocument[];
  suggest_human?: boolean;
  error?: string;
}

export interface AnswerGroundedParams {
  url: string;
  apiKey: string | null;
  query: string;
  contextHint?: string | null;
  productHint?: string | null;
  topicHints?: string[];
  versionHint?: string | null;
  locale?: "ru" | "en";
  timeoutMs?: number;
}

export async function lexiroAnswerGrounded(
  p: AnswerGroundedParams,
): Promise<LexiroAnswer | null> {
  try {
    const client = await getClient(p.url, p.apiKey);
    const call = client.callTool({
      name: "answer_grounded",
      arguments: {
        query: p.query,
        context_hint: p.contextHint ?? null,
        product_hint: p.productHint ?? null,
        topic_hints: p.topicHints && p.topicHints.length ? p.topicHints : null,
        version_hint: p.versionHint ?? null,
        locale: p.locale ?? "ru",
      },
    });
    const res = await withTimeout(call, p.timeoutMs ?? 30000);
    const data = parseToolResult(res) as LexiroAnswer | string;
    if (typeof data === "string" || !data || typeof data !== "object") return null;
    if (!Array.isArray(data.documents)) data.documents = [];
    return data;
  } catch (err) {
    console.warn("Lexiro answer_grounded failed:", (err as Error).message);
    await resetClient();
    return null;
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Lexiro timeout after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

async function resetClient(): Promise<void> {
  if (conn) {
    await conn.client.close().catch(() => {});
    conn = null;
  }
}
