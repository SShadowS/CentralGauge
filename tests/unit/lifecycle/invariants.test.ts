import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import {
  assertAnalysisCoversShortcomings,
  assertPublishCoversOccurrences,
} from "../../../scripts/verify-backfill-invariants.ts";

describe("backfill invariants", () => {
  it("passes when every (model,task_set) with shortcomings has an analysis event", () => {
    const shortcomings = [
      { model_slug: "m/x", task_set_hash: "h" },
      { model_slug: "m/y", task_set_hash: "h" },
    ];
    const events = [
      {
        model_slug: "m/x",
        task_set_hash: "h",
        event_type: "analysis.completed",
      },
      {
        model_slug: "m/y",
        task_set_hash: "h",
        event_type: "analysis.completed",
      },
    ];
    const result = assertAnalysisCoversShortcomings(shortcomings, events);
    assertEquals(result.missing, []);
  });

  it("flags missing analysis events", () => {
    const shortcomings = [
      { model_slug: "m/x", task_set_hash: "h" },
      { model_slug: "m/y", task_set_hash: "h" },
    ];
    const events = [
      {
        model_slug: "m/x",
        task_set_hash: "h",
        event_type: "analysis.completed",
      },
    ];
    const result = assertAnalysisCoversShortcomings(shortcomings, events);
    assertEquals(result.missing, ["m/y\x1fh"]);
  });

  it("publish invariant requires every (model, task_set) with occurrences to have publish event", () => {
    const occGroups = [{ model_slug: "m/a", task_set_hash: "h" }];
    const events = [
      {
        model_slug: "m/a",
        task_set_hash: "h",
        event_type: "publish.completed",
      },
    ];
    const result = assertPublishCoversOccurrences(occGroups, events);
    assertEquals(result.missing, []);
  });
});
