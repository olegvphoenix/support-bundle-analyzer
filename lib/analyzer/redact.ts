// Mask customer-sensitive data before anything leaves the box (LLM / Lexiro).
// Keeps structure so the LLM can still reason (e.g. <ip-1> stays consistent).

interface RedactState {
  map: Map<string, string>;
  counters: Record<string, number>;
}

function token(state: RedactState, kind: string, value: string): string {
  const key = `${kind}:${value}`;
  let t = state.map.get(key);
  if (!t) {
    state.counters[kind] = (state.counters[kind] ?? 0) + 1;
    t = `<${kind}-${state.counters[kind]}>`;
    state.map.set(key, t);
  }
  return t;
}

const PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "ip", re: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g },
  {
    kind: "email",
    re: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
  },
  // Windows paths with usernames.
  { kind: "userpath", re: /[Cc]:\\Users\\[^\\\s"]+/g },
  // Bearer/secrets and password=...
  { kind: "secret", re: /(?:password|passwd|pwd|token|secret)\s*[=:]\s*\S+/gi },
];

export function createRedactor() {
  const state: RedactState = { map: new Map(), counters: {} };
  return {
    redact(text: string): string {
      let out = text;
      for (const { kind, re } of PATTERNS) {
        out = out.replace(re, (m) => token(state, kind, m));
      }
      return out;
    },
    get mappingSize() {
      return state.map.size;
    },
  };
}

export function redactOnce(text: string): string {
  return createRedactor().redact(text);
}
