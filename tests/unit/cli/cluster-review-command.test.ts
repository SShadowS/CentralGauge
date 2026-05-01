/**
 * D7.4 — `centralgauge lifecycle cluster-review` registration smoke test.
 *
 * The interactive flow (Cliffy prompts + signed POSTs) is exercised via
 * the admin endpoint suite at site/tests/api/admin-cluster-review.test.ts;
 * here we just verify the command attaches under its parent with the
 * expected name + description.
 */
import { assertEquals } from "@std/assert";
import { Command } from "@cliffy/command";
import { registerClusterReviewCommand } from "../../../cli/commands/cluster-review-command.ts";

Deno.test("cluster-review command registers under parent", () => {
  const parent = new Command();
  registerClusterReviewCommand(parent);
  const sub = parent.getCommand("cluster-review");
  assertEquals(sub?.getName(), "cluster-review");
  assertEquals(typeof sub?.getDescription(), "string");
  // The Select prompt happens at action-time, so we can't easily assert
  // the choices list here without invoking the action. The presence of
  // the subcommand + its options is sufficient — the auth + flow paths
  // are covered by the admin-cluster-review tests.
});

Deno.test("cluster-review command exposes --actor and --limit options", () => {
  const parent = new Command();
  registerClusterReviewCommand(parent);
  const sub = parent.getCommand("cluster-review");
  const opts = sub?.getOptions() ?? [];
  const names = opts.map((o) => o.name);
  // --actor is a string option, --limit is a default-999 integer option.
  // The exact CLI flag form depends on Cliffy's option parsing; we just
  // check both option names appear.
  const hasActor = names.includes("actor");
  const hasLimit = names.includes("limit");
  assertEquals(hasActor, true);
  assertEquals(hasLimit, true);
});
