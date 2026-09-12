/**
 * The leaderboard's upstream chip. OpenRouter routes a request to one of
 * several backends (the upstream), and which one answered can change the
 * numbers beside it, so the chip names the profile and says how well the rows
 * behind the row's score match it.
 *
 * Pure and display-only: it decides tone and text, never fetches or ranks.
 */
import type { LeaderboardUpstream } from "$lib/shared/api-types";

export type ChipTone =
  | "verified"
  | "unpinned"
  | "warn"
  | "mixed"
  | "unrecorded";
export interface UpstreamChip {
  tone: ChipTone;
  label: string;
  title: string;
}

const WARN_STATES = ["unverified", "not_served", "mismatch"] as const;

/** Null when the model never went through OpenRouter (nothing to say). */
export function upstreamChip(u: LeaderboardUpstream): UpstreamChip | null {
  const v = u.verification;
  const total = Object.values(v).reduce((a, b) => a + (b ?? 0), 0);
  const na = v.not_applicable ?? 0;
  if (u.pin === null && total - na === 0) return null;
  const unrecorded = v.unrecorded ?? 0;
  if (u.pin === null && unrecorded === total - na) {
    return {
      tone: "unrecorded",
      label: "upstream unrecorded",
      title:
        "These runs predate upstream capture; which OpenRouter upstream served them is unknown.",
    };
  }
  const warn = WARN_STATES.reduce((n, k) => n + (v[k] ?? 0), 0);
  if (u.served.length > 1) {
    return {
      tone: "mixed",
      label: `mixed · ${u.served.join(", ")}`,
      title: `More than one upstream served this cohort (${
        u.served.join(", ")
      }). Precision may differ between them.`,
    };
  }
  if (warn > 0) {
    return {
      tone: "warn",
      label: u.pin ?? u.served[0] ?? "upstream",
      title:
        `${warn} of ${total} result rows could not be verified against the pin (unverified, not served, or mismatched).`,
    };
  }
  if (u.pin !== null) {
    return {
      tone: "verified",
      label: u.pin,
      title: `Every result was served by the pinned upstream ${u.pin}${
        u.served[0] ? ` (${u.served[0]})` : ""
      }.`,
    };
  }
  return {
    tone: "unpinned",
    label: `unpinned · ${u.served[0] ?? "unknown"}`,
    title: `No upstream was pinned; OpenRouter routed to ${
      u.served[0] ?? "an unrecorded upstream"
    } on every recorded result.`,
  };
}
