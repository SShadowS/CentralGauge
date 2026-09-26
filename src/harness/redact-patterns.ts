/**
 * Token-pattern redaction for published files and strings (M0-04 carryover).
 * Runs after exact-secret redaction. Never applied to the frozen workspace.
 * Byte-level: UTF-8 (patterns are ASCII, bytes >= 0x80 never match) and
 * UTF-16LE (runs of ASCII chars each followed by 0x00 are collapsed,
 * redacted and re-expanded).
 */

export const SECRET_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: "anthropic-key", re: /sk-ant-[A-Za-z0-9_-]{20,}/g }, // before openai: sk-ant- fits its shape too
  { name: "openrouter-key", re: /sk-or-v1-[A-Za-z0-9]{32,}/g },
  { name: "openai-key", re: /sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/g },
  {
    name: "github-token",
    re: /gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}/g,
  },
  {
    name: "jwt",
    re: /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  },
];
// Same-line whitespace only: `Bearer\n<word>` in prose is not a header.
const BEARER = /(Bearer[ \t]+)[A-Za-z0-9._~+/=-]{16,}/gi;

export function redactPatternText(s: string): { text: string; count: number } {
  let count = 0;
  let text = s;
  for (const p of SECRET_PATTERNS) {
    text = text.replace(p.re, () => (count++, `[REDACTED:${p.name}]`));
  }
  text = text.replace(
    BEARER,
    (_m, prefix: string) => (count++, `${prefix}[REDACTED:bearer]`),
  );
  return { text, count };
}

const toBin = (d: Uint8Array) => {
  let s = "";
  for (let i = 0; i < d.length; i += 8192) {
    s += String.fromCharCode(...d.subarray(i, i + 8192));
  }
  return s;
};
const fromBin = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));
// UTF-16LE text: printable ASCII each followed by a NUL byte.
// deno-lint-ignore no-control-regex
const U16_RUN = /(?:[\x09\x0a\x0d\x20-\x7e]\x00){16,}/g;

export function redactPatterns(
  data: Uint8Array,
): { out: Uint8Array; count: number } {
  let count = 0;
  const r8 = redactPatternText(toBin(data));
  count += r8.count;
  const s16 = r8.text.replace(U16_RUN, (run) => {
    // deno-lint-ignore no-control-regex
    const r = redactPatternText(run.replace(/\x00/g, ""));
    if (r.count === 0) return run;
    count += r.count;
    return [...r.text].map((ch) => ch + "\x00").join("");
  });
  return count === 0 ? { out: data, count: 0 } : { out: fromBin(s16), count };
}
