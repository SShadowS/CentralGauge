/**
 * Custody of pi's openai-codex OAuth credential (H-02): the ChatGPT
 * subscription route. The secret file `openai-codex-auth` holds a pi
 * auth.json with exactly one entry, `openai-codex`, in the shape pi 0.87.1
 * writes after login (pi-ai dist/auth/oauth/openai-codex.js:331-337) and
 * validates (pi-coding-agent dist/core/auth-storage.js:195-199).
 *
 * The token is refreshed on the host only: pi refreshes when less than five
 * minutes remain (pi-ai dist/auth/resolve.js:62-92) and writes the new
 * tokens back, and a token refreshed inside the sandbox would be unknown to
 * redaction. So a run is refused before it starts unless the access token
 * outlives its timeout by CODEX_EXPIRY_MARGIN_MIN.
 */

import { ConfigurationError } from "../errors.ts";
import type { SecretValue } from "./fsutil.ts";

export const CODEX_AUTH_FILE = "openai-codex-auth";
export const CODEX_PROVIDER = "openai-codex";
/** Minutes of validity beyond the run's timeout the access token must have at the start. */
export const CODEX_EXPIRY_MARGIN_MIN = 15;
const FIELDS = ["access", "accountId", "expires", "refresh", "type"];
/**
 * An inner value is a secret of its own: long enough to redact safely and
 * printable ASCII that JSON never escapes, so a serialized log holds it verbatim.
 */
const INNER = /^[\x21\x23-\x5b\x5d-\x7e]{16,}$/;

export interface CodexAuth {
  access: string;
  refresh: string;
  expires: number;
  accountId: string;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Strict parse; an error never echoes a value or a key from the file. */
export function parseCodexAuth(text: string): CodexAuth {
  const bad = (why: string): never => {
    throw new ConfigurationError(
      `secret ${CODEX_AUTH_FILE}: ${why} (expected a pi auth.json with exactly one entry, "${CODEX_PROVIDER}": {type: "oauth", access, refresh, expires, accountId})`,
    );
  };
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return bad("not JSON");
  }
  if (!isObj(v)) return bad("not a JSON object");
  const keys = Object.keys(v);
  if (keys.length !== 1 || keys[0] !== CODEX_PROVIDER) {
    return bad(`${keys.length} entries, or not the ${CODEX_PROVIDER} entry`);
  }
  const e = v[CODEX_PROVIDER];
  if (!isObj(e)) return bad("the entry is not an object");
  if (JSON.stringify(Object.keys(e).sort()) !== JSON.stringify(FIELDS)) {
    return bad(`the entry's fields are not exactly ${FIELDS.join(", ")}`);
  }
  if (e["type"] !== "oauth") return bad('type is not "oauth"');
  for (const k of ["access", "refresh", "accountId"]) {
    const s = e[k];
    if (typeof s !== "string" || !INNER.test(s)) {
      return bad(
        `${k} is not a string of at least 16 printable characters without spaces, quotes or backslashes`,
      );
    }
  }
  const expires = e["expires"];
  if (typeof expires !== "number" || !Number.isSafeInteger(expires)) {
    return bad("expires is not an integer (epoch milliseconds)");
  }
  return {
    access: e["access"] as string,
    refresh: e["refresh"] as string,
    expires,
    accountId: e["accountId"] as string,
  };
}

/**
 * The redaction values of a set of secret files: each file's whole value,
 * plus the codex file's inner access, refresh and accountId under the
 * file's name. Only the files are ever written into the secrets mount.
 */
export function withCredentialForms(values: SecretValue[]): SecretValue[] {
  const inner = values.filter((v) => v.name === CODEX_AUTH_FILE).flatMap(
    (v) => {
      const a = parseCodexAuth(v.value);
      return [a.access, a.refresh, a.accountId].map((value) => ({
        name: CODEX_AUTH_FILE,
        value,
      }));
    },
  );
  return [...values, ...inner];
}

/** Null when the token outlives the run; otherwise the refusal ops act on. */
export function codexExpiryProblem(
  a: CodexAuth,
  timeoutMin: number,
  now = Date.now(),
): string | null {
  const need = timeoutMin + CODEX_EXPIRY_MARGIN_MIN;
  if (a.expires >= now + need * 60_000) return null;
  return `secret ${CODEX_AUTH_FILE}: the OAuth access token expires at ${
    new Date(a.expires).toISOString()
  }, less than ${need} minutes from now (timeout ${timeoutMin} + ${CODEX_EXPIRY_MARGIN_MIN}); ` +
    `refresh it on the host (pi auth print-bearer-token --provider openai-codex --min-expiry ${need}m refreshes an expiring token; it prints the token, so discard stdout) ` +
    `and copy the ${CODEX_PROVIDER} entry into ${CODEX_AUTH_FILE} again. pi never refreshes inside the sandbox: auth.openai.com is not on the allowlist unless recorded, so an in-sandbox refresh fails closed`;
}

/**
 * H-02 review: the sandbox copy of the codex file, the refresh token
 * withheld (refresh ""). pi 0.87.1 authenticates with the access token
 * alone while it is valid (pi-ai auth/resolve.js:62-99 refreshes only
 * inside the 5-minute window; auth/oauth/openai-codex.js:445-448 derives
 * the auth from `access`), and accepts a string refresh
 * (pi-coding-agent core/auth-storage.js:195-199). So the agent never
 * holds the long-lived token and cannot refresh inside the sandbox.
 */
export function releasedCodexAuth(text: string): string {
  const a = parseCodexAuth(text);
  return JSON.stringify(
    {
      [CODEX_PROVIDER]: {
        type: "oauth",
        access: a.access,
        refresh: "",
        expires: a.expires,
        accountId: a.accountId,
      },
    },
    null,
    2,
  );
}

/** The files as released into the sandbox: the codex file with its refresh token withheld. */
export function releasedSecretFiles(values: SecretValue[]): SecretValue[] {
  return values.map((v) =>
    v.name === CODEX_AUTH_FILE
      ? { name: v.name, value: releasedCodexAuth(v.value) }
      : v
  );
}
