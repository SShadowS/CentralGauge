import { ApiError } from "./errors";

export interface SealedKey {
  ciphertext: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
}

const enc = new TextEncoder();

async function aesKey(secretB64: string): Promise<CryptoKey> {
  let raw: Uint8Array<ArrayBuffer> | null = null;
  try {
    raw = Uint8Array.from(atob(secretB64), (c) => c.charCodeAt(0));
  } catch {
    raw = null;
  }
  if (!raw || raw.length !== 32) {
    throw new ApiError(
      503,
      "submissions_unavailable",
      "submission key secret is not configured",
    );
  }
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function sealKey(
  plaintext: string,
  secretB64: string,
): Promise<SealedKey> {
  const key = await aesKey(secretB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext),
  );
  return { ciphertext: new Uint8Array(ct), iv };
}

export async function openKey(
  sealed: SealedKey,
  secretB64: string,
): Promise<string> {
  const key = await aesKey(secretB64);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: sealed.iv },
    key,
    sealed.ciphertext,
  );
  return new TextDecoder().decode(pt);
}

export function newEditToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function hashToken(token: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(token));
  return [...new Uint8Array(d)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function tokenMatches(
  token: string,
  storedHash: string,
): Promise<boolean> {
  const h = await hashToken(token);
  if (h.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i++) {
    diff |= h.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * IPv6 addresses collapse to their /64 prefix (first four hextets of the
 * expanded address), since one subscriber usually owns a whole /64.
 * IPv4 and anything unparseable are used as given.
 */
function ipBucket(ip: string): string {
  const addr = ip.trim().toLowerCase().split("%")[0];
  if (!addr.includes(":")) return addr;
  const [head, tail = ""] = addr.split("::");
  const parts = (s: string) => (s ? s.split(":") : []);
  const h = parts(head);
  const t = parts(tail);
  // An embedded dotted IPv4 tail fills two hextets.
  const width = (xs: string[]) =>
    xs.reduce((n, x) => n + (x.includes(".") ? 2 : 1), 0);
  const zeros = addr.includes("::")
    ? Array(Math.max(0, 8 - width(h) - width(t))).fill("0")
    : [];
  const first4 = [...h, ...zeros, ...t].slice(0, 4);
  if (first4.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return addr;
  return first4.map((x) => parseInt(x, 16).toString(16)).join(":") + "::/64";
}

/** HMAC-SHA-256 of the IP bucket, keyed by the submission secret. */
export async function hashIp(ip: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(`ip-hash:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(ipBucket(ip)));
  return [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
