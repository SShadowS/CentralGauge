/** Adapter registry (M1-32 adds claude-code, M1-35 adds mock); helper modules never import it. */

import type { HarnessAdapter } from "../adapter.ts";
import { ConfigurationError } from "../../errors.ts";
import { claudeCodeAdapter } from "./claude-code.ts";
import { mockAdapter } from "./mock.ts";

export const ADAPTERS: Record<string, HarnessAdapter> = {
  "claude-code": claudeCodeAdapter,
  mock: mockAdapter,
};

export function adapterFor(harness: string): HarnessAdapter {
  const a = Object.hasOwn(ADAPTERS, harness) ? ADAPTERS[harness] : undefined;
  if (!a) {
    throw new ConfigurationError(
      `no adapter for harness ${harness} (known: ${
        Object.keys(ADAPTERS).sort().join(", ") || "none"
      })`,
    );
  }
  return a;
}
