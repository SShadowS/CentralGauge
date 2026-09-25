/** Stored per-call fields shared by every harness producer (Claude Code M2-03, pi M3-05). */

import type { Category } from "./classify.ts";
import { classify } from "./classify.ts";
import { redactPatternText } from "./redact-patterns.ts";

/** ponytail: chars, not bytes. Over the cap the command is not stored at all (a cut could leave a secret prefix). */
export const MAX_COMMAND_CHARS = 16384;

export function callFields(
  tool: string,
  rawCommand: string | null,
  target: string | null,
): {
  command: string | null;
  command_cut: boolean | null;
  target: string | null;
  category: Category;
  classifier: string;
} {
  const full = rawCommand === null ? null : redactPatternText(rawCommand).text;
  const cut = full !== null && full.length > MAX_COMMAND_CHARS;
  return {
    command: cut ? null : full,
    command_cut: full === null ? null : cut,
    target,
    ...classify({ tool, command: full, target }),
  };
}
