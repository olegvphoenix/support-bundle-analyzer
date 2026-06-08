import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { LogRecord } from "./types";

// Matches the AxxonOne log line header:
//   ~[40220]; 2026-05-07; 15:48:27.155; INFO; <rest>
//   ~#[1]; 2026-05-07; 16:09:51.502; ERROR; <rest>
const HEADER_RE =
  /^~#?\[\s*(\d+)\];\s*(\d{4}-\d{2}-\d{2});\s*([\d:.]+);\s*([A-Z]+);\s?(.*)$/;

const ADDR_RE = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?)/;

/**
 * Split the "rest" of a line into component and message.
 * Component is either a leading [Bracketed] token or a path-like " /Foo.1/" prefix
 * terminated by ": ".
 */
function splitComponent(rest: string): { component: string | null; message: string } {
  // Bracketed component: [ServiceLocator] message
  const bracket = rest.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (bracket) {
    return { component: bracket[1], message: bracket[2] };
  }
  // Path-like component ending in ": "
  const idx = rest.indexOf(": ");
  if (idx >= 0 && idx <= 80) {
    const comp = rest.slice(0, idx).trim();
    return { component: comp.length ? comp : null, message: rest.slice(idx + 2) };
  }
  return { component: null, message: rest };
}

function parseHeader(line: string, file: string): LogRecord | null {
  const m = HEADER_RE.exec(line);
  if (!m) return null;
  const [, thread, date, time, level, rest] = m;
  const { component, message } = splitComponent(rest);
  const addrMatch = message.match(ADDR_RE);
  return {
    file,
    ts: `${date} ${time}`,
    thread,
    level,
    component,
    address: addrMatch ? addrMatch[1] : null,
    message,
    raw: line,
  };
}

/**
 * Stream-parse a log file line by line, stitching multiline stack traces onto
 * the preceding record. Calls `onRecord` for each completed record.
 */
export async function parseLogFile(
  filePath: string,
  fileName: string,
  onRecord: (rec: LogRecord) => void,
): Promise<void> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let current: LogRecord | null = null;

  for await (const line of rl) {
    const rec = parseHeader(line, fileName);
    if (rec) {
      if (current) onRecord(current);
      current = rec;
    } else if (current && line.trim().length) {
      // Continuation line (stack trace, multiline message).
      current.message += "\n" + line;
      current.raw += "\n" + line;
    }
  }
  if (current) onRecord(current);
}

/** Parse a string blob (used for tests and small files). */
export function parseLogString(text: string, fileName: string): LogRecord[] {
  const out: LogRecord[] = [];
  let current: LogRecord | null = null;
  for (const line of text.split(/\r?\n/)) {
    const rec = parseHeader(line, fileName);
    if (rec) {
      if (current) out.push(current);
      current = rec;
    } else if (current && line.trim().length) {
      current.message += "\n" + line;
      current.raw += "\n" + line;
    }
  }
  if (current) out.push(current);
  return out;
}
