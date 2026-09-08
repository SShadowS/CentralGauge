/**
 * Append-only JSONL journals (`items.jsonl`, `events.jsonl`, spec section 4).
 *
 * Both journals are written one line per record, fsynced on every append,
 * and read back tolerant of a torn final line - a crash mid-write leaves at
 * most one incomplete trailing line, never a corrupted earlier one. Readers
 * de-duplicate by a caller-supplied key, keeping the last write for that
 * key, so a record appended twice (a resumed step re-running an append)
 * collapses to its final value.
 *
 * @module src/batch/journal
 */
import { join } from "@std/path";
import { RUN_FILES } from "./paths.ts";

/** One line of `items.jsonl`: a submitted request. */
export interface ItemLine {
  itemId: string;
  taskId: string;
  attempt: 1 | 2;
  round: 0 | 1;
  chunk: number;
  wave: 1 | 2;
  bodyDigest: string;
  body: unknown;
  renderedAt: string;
}

/** One line of `events.jsonl`: an append-only audit record. */
export interface EventLine {
  eventId: string;
  at: string;
  kind: string;
  data: Record<string, unknown>;
}

/** Appends `line` as JSON followed by `\n`, fsynced before returning. */
export async function appendJsonl(path: string, line: unknown): Promise<void> {
  const file = await Deno.open(path, { append: true, create: true });
  try {
    await file.write(new TextEncoder().encode(JSON.stringify(line) + "\n"));
    await file.sync();
  } finally {
    file.close();
  }
}

/**
 * Reads every record from `path`, tolerating a torn final line (the last
 * line only, when it fails to parse - anything earlier that fails to parse
 * is corruption and throws). Records are de-duplicated by `key`, keeping
 * the last write for each key; the returned order is each key's first
 * appearance. Returns `[]` when `path` does not exist.
 */
export async function loadJsonl<T>(
  path: string,
  key: (t: T) => string,
): Promise<T[]> {
  let raw: string;
  try {
    raw = await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
  const lines = raw.split("\n").filter((line) => line.length > 0);
  const byKey = new Map<string, T>();
  const order: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let parsed: T;
    try {
      parsed = JSON.parse(line) as T;
    } catch (err) {
      const isLastLine = i === lines.length - 1;
      if (isLastLine) break; // torn write, not corruption
      throw err;
    }
    const k = key(parsed);
    if (!byKey.has(k)) order.push(k);
    byKey.set(k, parsed);
  }
  return order.map((k) => byKey.get(k)!);
}

/** Appends one event to `<dir>/events.jsonl`, minting a fresh `eventId`. */
export async function appendEvent(
  dir: string,
  kind: string,
  data: Record<string, unknown>,
): Promise<EventLine> {
  const line: EventLine = {
    eventId: crypto.randomUUID(),
    at: new Date().toISOString(),
    kind,
    data,
  };
  await appendJsonl(join(dir, RUN_FILES.events), line);
  return line;
}
