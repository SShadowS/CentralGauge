/**
 * Greedy chunking of batch items into provider-sized submissions, and
 * halving a chunk the provider rejected for size (spec section 5).
 *
 * @module src/batch/chunking
 */
import type { BatchItem } from "../llm/batch/types.ts";

export interface Chunk {
  chunk: number;
  items: BatchItem[];
  bytes: number;
}

/** UTF-8 byte length of `JSON.stringify(wrap(items))`. */
export function envelopeBytes(
  items: BatchItem[],
  wrap: (items: BatchItem[]) => unknown,
): number {
  return new TextEncoder().encode(JSON.stringify(wrap(items))).byteLength;
}

/**
 * Greedy, in item order: a new chunk starts whenever adding the next item
 * would push the running chunk past `limits.maxItems` or make
 * {@link envelopeBytes} exceed `limits.maxBytes`. A single item that alone
 * exceeds `maxBytes` still gets its own one-item chunk: the submit path
 * reports that chunk as operator-blocked rather than silently dropping the
 * item. Chunk numbers are assigned in order starting at 0.
 */
export function chunkItems(
  items: BatchItem[],
  limits: { maxItems: number; maxBytes: number },
  wrap: (items: BatchItem[]) => unknown,
): Chunk[] {
  const chunks: Chunk[] = [];
  let current: BatchItem[] = [];

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({
      chunk: chunks.length,
      items: current,
      bytes: envelopeBytes(current, wrap),
    });
    current = [];
  };

  for (const item of items) {
    const candidate = [...current, item];
    const exceedsItems = candidate.length > limits.maxItems;
    const exceedsBytes = current.length > 0 &&
      envelopeBytes(candidate, wrap) > limits.maxBytes;
    if (current.length > 0 && (exceedsItems || exceedsBytes)) {
      flush();
      current = [item];
    } else {
      current = candidate;
    }
  }
  flush();

  return chunks;
}

/**
 * Splits `chunk` at `Math.ceil(items.length / 2)`: the left half keeps
 * `chunk.chunk`'s number, the right half is renumbered `nextChunkNumber`.
 * Returns `null` when the chunk holds a single item: there is nothing left
 * to split, so the caller reports it as operator-blocked instead.
 */
export function halveChunk(
  chunk: Chunk,
  nextChunkNumber: number,
  wrap: (items: BatchItem[]) => unknown,
): [Chunk, Chunk] | null {
  if (chunk.items.length <= 1) return null;

  const mid = Math.ceil(chunk.items.length / 2);
  const leftItems = chunk.items.slice(0, mid);
  const rightItems = chunk.items.slice(mid);

  return [
    {
      chunk: chunk.chunk,
      items: leftItems,
      bytes: envelopeBytes(leftItems, wrap),
    },
    {
      chunk: nextChunkNumber,
      items: rightItems,
      bytes: envelopeBytes(rightItems, wrap),
    },
  ];
}
