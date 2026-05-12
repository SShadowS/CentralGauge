const PATTERNS: { pattern: RegExp; replacement: string }[] = [
  { pattern: /password=\S+/gi, replacement: "password=[REDACTED]" },
  { pattern: /Bearer\s+[A-Za-z0-9._-]+/g, replacement: "Bearer [REDACTED]" },
  { pattern: /token=\S+/gi, replacement: "token=[REDACTED]" },
  { pattern: /api[_-]?key[=:]\s*\S+/gi, replacement: "api_key=[REDACTED]" },
  {
    pattern: /\b[A-Za-z]:\\[^\s]*\.flf\b/g,
    replacement: "[REDACTED_LICENSE_FILE]",
  },
];

export function redactSensitive(text: string): string {
  let out = text;
  for (const { pattern, replacement } of PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
