import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import {
  assertAnalysisCoversShortcomings,
  assertPublishCoversOccurrences,
} from "../../../scripts/verify-backfill-invariants.ts";
import { PRE_P6_TASK_SET_SENTINEL } from "../../../src/lifecycle/types.ts";

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

  it("uses PRE_P6_TASK_SET_SENTINEL (not a hardcoded literal) for null task_set_hash keying", () => {
    // Shortcoming row with null task_set_hash matches event row also keyed on
    // the sentinel — both must agree on the same string. If the script had a
    // hardcoded literal that drifted from the canonical export, this would fail.
    const shortcomings = [{ model_slug: "m/x", task_set_hash: null }];
    const events = [
      {
        model_slug: "m/x",
        task_set_hash: PRE_P6_TASK_SET_SENTINEL,
        event_type: "analysis.completed",
      },
    ];
    const result = assertAnalysisCoversShortcomings(shortcomings, events);
    assertEquals(result.missing, []);
  });
});
