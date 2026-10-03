// Pure helpers of lsp-probe.mjs (M10-01b run 003). No side effects at import:
// no environment reads, no handlers, no exit. lsp-probe.mjs imports this file,
// and it ships next to the probe in the image (C:\cg-lsp\lsp-probe-lib.mjs).
// node: built-ins only.
import { Buffer } from "node:buffer";

// Largest header block before its blank line.
export const MAX_HEADER_BYTES = 8192;

/**
 * The header bytes of `buf` counted against MAX_HEADER_BYTES: up to the
 * terminator when it has arrived (`sep` >= 0), else the whole buffer less a
 * trailing partial terminator ("\r", "\r\n", "\r\n\r"), so a header of exactly
 * the limit is judged the same however its terminator is fragmented.
 */
export function headerBytes(buf, sep = buf.indexOf("\r\n\r\n")) {
  if (sep >= 0) return sep;
  for (const tail of ["\r\n\r", "\r\n", "\r"]) {
    const t = Buffer.from(tail, "latin1");
    if (
      buf.length >= t.length && buf.subarray(buf.length - t.length).equals(t)
    ) {
      return buf.length - t.length;
    }
  }
  return buf.length;
}

// Date.now() is whole milliseconds while creation times keep microseconds, so
// a clock read is rounded outward: a lower bound (spawnedAt) is the floor, an
// upper bound (a parent's death, "now") is the next millisecond plus
// CLOCK_SLACK_MS for the clocks' resolution. A child created at T+0.6 ms with
// the death seen at T+0.9 ms is then still under the bound (M10-01b run 002).
const CLOCK_SLACK_MS = 1n;
const EPOCH_MS = 11644473600000n;
export const fileTimeBounds = (msNow) => ({
  low: (BigInt(msNow) + EPOCH_MS) * 10000n,
  high: (BigInt(msNow) + 1n + CLOCK_SLACK_MS + EPOCH_MS) * 10000n,
});
