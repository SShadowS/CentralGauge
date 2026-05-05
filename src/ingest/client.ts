export interface RetryOptions {
  fetchFn?: typeof fetch;
  maxAttempts?: number;
  backoffBaseMs?: number;
  onAttempt?: (attempt: number, lastError?: Error) => void;
}

export async function postWithRetry(
  url: string,
  body: unknown,
  opts: RetryOptions = {},
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const fetchFn = opts.fetchFn ?? fetch;
  const max = opts.maxAttempts ?? 3;
  const base = opts.backoffBaseMs ?? 1000;
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= max; attempt++) {
    opts.onAttempt?.(attempt, lastError);
    try {
      const resp = await fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...extraHeaders },
        body: JSON.stringify(body),
      });
      if (resp.status === 429 && attempt < max) {
        const retryAfter = resp.headers.get("retry-after");
        const hint = retryAfter ? Number(retryAfter) * 1000 : NaN;
        const wait = Number.isFinite(hint) && hint > 0
          ? hint
          : base * Math.pow(4, attempt - 1);
        lastError = new Error(`server returned 429`);
        await sleep(wait);
        continue;
      }
      if (resp.status >= 400 && resp.status < 500) return resp;
      if (resp.status >= 500 && attempt < max) {
        lastError = new Error(`server returned ${resp.status}`);
        await sleep(base * Math.pow(4, attempt - 1));
        continue;
      }
      return resp;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt >= max) throw lastError;
      await sleep(base * Math.pow(4, attempt - 1));
    }
  }
  throw lastError ?? new Error("postWithRetry: exhausted attempts");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
