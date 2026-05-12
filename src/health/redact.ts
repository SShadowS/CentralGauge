const PATTERNS: { pattern: RegExp; replacement: string }[] = [
  {
    pattern: /\bpassword(\s*[=:]\s*)[^\s&;]+/gi,
    replacement: "password$1[REDACTED]",
  },
  {
    pattern: /Bearer\s+[^\s,;]+/gi,
    replacement: "Bearer [REDACTED]",
  },
  {
    pattern: /\btoken(\s*[=:]\s*)[^\s&;]+/gi,
    replacement: "token$1[REDACTED]",
  },
  {
    pattern: /\bapi[_-]?key(\s*[=:]\s*)[^\s&;]+/gi,
    replacement: "api_key$1[REDACTED]",
  },
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
