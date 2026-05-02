/**
 * Minimal W3C Server-Timing helper.
 *
 * Usage:
 *   const timer = new ServerTimer();
 *   const result = await timer.measure('my_query', () => db.prepare(sql).all());
 *   response.headers.set('Server-Timing', timer.header());
 *
 * The `total` entry (end-to-end from construction) is always appended last by
 * `header()`. Individual entries are recorded in call order.
 *
 * W3C spec: https://www.w3.org/TR/server-timing/
 * Format: `name;dur=12.4, name2;dur=8.1;desc="label", total;dur=45.0`
 */
export class ServerTimer {
  private readonly entries: Array<{ name: string; dur: number; desc?: string }> = [];
  private readonly startMs: number;

  constructor() {
    // performance.now() is available in Cloudflare Workers and Vitest (jsdom/node).
    this.startMs = performance.now();
  }

  /**
   * Runs `fn`, records its wall-clock duration under `name`, and returns the
   * result. When `timer` is undefined on the caller side, callers skip this
   * method entirely — no overhead when instrumentation is disabled.
   *
   * @param name   W3C Server-Timing metric name (no spaces, no semicolons).
   * @param fn     Async factory whose execution is measured.
   * @param desc   Optional human-readable description (emitted as `desc="…"`).
   */
  async measure<T>(name: string, fn: () => Promise<T>, desc?: string): Promise<T> {
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      this.entries.push({ name, dur: performance.now() - t0, desc });
    }
  }

  /**
   * Returns the W3C `Server-Timing` header value. A `total` entry covering
   * the full duration from construction is always appended last.
   *
   * Example:
   *   "aggregates_main;dur=12.4, consistency;dur=8.1, total;dur=45.2"
   */
  header(): string {
    const totalDur = performance.now() - this.startMs;
    const parts = this.entries.map((e) => {
      let s = `${e.name};dur=${e.dur.toFixed(1)}`;
      if (e.desc) s += `;desc="${e.desc}"`;
      return s;
    });
    parts.push(`total;dur=${totalDur.toFixed(1)}`);
    return parts.join(', ');
  }
}
