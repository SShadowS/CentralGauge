/**
 * Unit tests for benchmark app.json manifest mutators.
 *
 * These moved out of mcp/al-tools-server.ts, which cannot be statically
 * imported (container provider + credential reads at module scope).
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

import type { AppJson } from "../../../src/al/app-manifest.ts";
import {
  ensurePrereqDependency,
  ensureTestCodeunitRange,
  ensureTestDependencies,
} from "../../../src/al/app-manifest.ts";
import { TEST_TOOLKIT_DEPENDENCIES } from "../../../src/constants.ts";

describe("al/app-manifest", () => {
  describe("ensureTestDependencies", () => {
    it("adds every toolkit dependency to a manifest with none", () => {
      const appJson: AppJson = {};
      ensureTestDependencies(appJson);
      assertEquals(
        appJson.dependencies?.length,
        TEST_TOOLKIT_DEPENDENCIES.length,
      );
    });

    it("is idempotent", () => {
      const appJson: AppJson = {};
      ensureTestDependencies(appJson);
      ensureTestDependencies(appJson);
      assertEquals(
        appJson.dependencies?.length,
        TEST_TOOLKIT_DEPENDENCIES.length,
      );
    });

    it("preserves an unrelated existing dependency", () => {
      const appJson: AppJson = {
        dependencies: [{
          id: "aaaaaaaa-0000-0000-0000-000000000001",
          name: "Other",
          publisher: "CentralGauge",
          version: "1.0.0.0",
        }],
      };
      ensureTestDependencies(appJson);
      assertEquals(
        appJson.dependencies?.length,
        TEST_TOOLKIT_DEPENDENCIES.length + 1,
      );
    });
  });

  describe("ensureTestCodeunitRange", () => {
    it("adds 80000-89999 when absent", () => {
      const appJson: AppJson = { idRanges: [{ from: 70000, to: 79999 }] };
      ensureTestCodeunitRange(appJson);
      assertEquals(appJson.idRanges?.length, 2);
      assertEquals(appJson.idRanges?.[1], { from: 80000, to: 89999 });
    });

    it("does not add a second range when one already covers 80001", () => {
      const appJson: AppJson = { idRanges: [{ from: 80000, to: 89999 }] };
      ensureTestCodeunitRange(appJson);
      assertEquals(appJson.idRanges?.length, 1);
    });
  });

  describe("ensurePrereqDependency", () => {
    it("adds the prereq's identity as a dependency", () => {
      const appJson: AppJson = {};
      ensurePrereqDependency(appJson, {
        id: "a1b2c3d4-0a53-0000-0000-000000000001",
        name: "CG-AL-X053 Prereq",
        publisher: "CentralGauge",
        version: "1.0.0.0",
      });
      assertEquals(appJson.dependencies?.[0], {
        id: "a1b2c3d4-0a53-0000-0000-000000000001",
        name: "CG-AL-X053 Prereq",
        publisher: "CentralGauge",
        version: "1.0.0.0",
      });
    });

    it("is idempotent", () => {
      const appJson: AppJson = {};
      const prereq: AppJson = {
        id: "a1b2c3d4-0a53-0000-0000-000000000001",
        name: "CG-AL-X053 Prereq",
        publisher: "CentralGauge",
        version: "1.0.0.0",
      };
      ensurePrereqDependency(appJson, prereq);
      ensurePrereqDependency(appJson, prereq);
      assertEquals(appJson.dependencies?.length, 1);
    });
  });
});
