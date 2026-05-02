/**
 * Pre-import polyfills. MUST be the first import in `cli/centralgauge.ts`
 * so its top-level code runs before any npm module's module-init code.
 *
 * `@google/genai@1.50.x` reads `process.env.GOOGLE_SDK_NODE_LOGGING` at
 * import time. On Linux Deno (CI runners) `process` is not yet wired up
 * by Deno's Node compat layer when the npm dep is being evaluated, so
 * the read throws. ES modules hoist imports, so a polyfill at the top of
 * `centralgauge.ts` body runs AFTER the offending dep — too late.
 *
 * This file does ONLY the polyfill. No other imports. The hoisting order
 * makes it run before `Command from '@cliffy/command'` (which transitively
 * pulls in the LLM registry → gemini-adapter → @google/genai).
 */
// deno-lint-ignore no-explicit-any
const _g = globalThis as any;
_g.process ??= {};
_g.process.env ??= {};
