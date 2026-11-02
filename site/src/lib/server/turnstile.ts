const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Fails closed: any missing token, network error, non-2xx or bad JSON is false. */
export async function verifyTurnstile(
  token: string | null,
  secret: string,
  ip: string | null,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);
  try {
    const res = await fetchFn(VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { success?: unknown };
    return json.success === true;
  } catch {
    return false;
  }
}
