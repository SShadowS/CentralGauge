/**
 * Unit tests for workbench workspace + checklist rendering.
 *
 * SAFETY: fixtures live under `Deno.makeTempDir()`. `resolveSymbolPaths` is
 * never called here - it shells out to `docker inspect`.
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

import type { WorkspaceContext } from "../../../src/workbench/workspace.ts";
import {
  renderChecklist,
  renderWorkspace,
} from "../../../src/workbench/workspace.ts";

const REPO = "U:\\Git\\CentralGauge";
const ID = "CG-AL-X053";

function draftCtx(over: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return {
    id: ID,
    slug: "day-close",
    draftDir: join(REPO, "scratch", ID),
    repoRoot: REPO,
    hasPrereq: false,
    testCodeunitId: 88805,
    container: "Cronus28",
    symbolPaths: ["C:\\ProgramData\\BcContainerHelper\\cc-abc\\symbols"],
    state: "draft",
    ...over,
  };
}

describe("workbench/workspace", () => {
  describe("renderWorkspace (draft state)", () => {
    it("lists the draft root plus both solution projects", () => {
      const ws = JSON.parse(renderWorkspace(draftCtx())) as {
        folders: Array<{ path: string; name?: string }>;
      };
      const paths = ws.folders.map((f) => f.path);
      assertEquals(paths.includes("."), true);
      assertEquals(paths.includes("correct"), true);
      assertEquals(paths.includes("naive"), true);
      assertEquals(paths.includes("prereq"), false);
    });

    it("lists prereq only when the draft has one", () => {
      const ws = JSON.parse(
        renderWorkspace(draftCtx({ hasPrereq: true })),
      ) as { folders: Array<{ path: string }> };
      assertEquals(ws.folders.map((f) => f.path).includes("prereq"), true);
    });

    it("hides the sub-projects from the draft root folder", () => {
      const ws = JSON.parse(renderWorkspace(draftCtx())) as {
        settings: Record<string, Record<string, boolean>>;
      };
      // Non-null assertion: repo tsconfig has noUncheckedIndexedAccess, so
      // indexing settings["files.exclude"] types as possibly undefined even
      // though renderWorkspace always sets it - the test knows the shape.
      const exclude = ws.settings["files.exclude"]!;
      assertEquals(exclude["correct"], true);
      assertEquals(exclude["naive"], true);
    });

    it("sets al.packageCachePath from symbolPaths", () => {
      const ws = JSON.parse(renderWorkspace(draftCtx())) as {
        settings: Record<string, unknown>;
      };
      assertEquals(ws.settings["al.packageCachePath"], [
        "C:\\ProgramData\\BcContainerHelper\\cc-abc\\symbols",
      ]);
    });

    it("omits al.packageCachePath entirely when no symbols resolved", () => {
      const ws = JSON.parse(
        renderWorkspace(draftCtx({ symbolPaths: [] })),
      ) as { settings: Record<string, unknown> };
      assertEquals("al.packageCachePath" in ws.settings, false);
    });

    it("gives every task an absolute repo-root cwd", () => {
      const ws = JSON.parse(renderWorkspace(draftCtx())) as {
        tasks: { tasks: Array<{ options?: { cwd?: string } }> };
      };
      for (const task of ws.tasks.tasks) {
        assertEquals(task.options?.cwd, REPO);
      }
    });

    it("sets an empty problemMatcher on every task", () => {
      const raw = renderWorkspace(draftCtx());
      const tasks = (JSON.parse(raw) as {
        tasks: { tasks: Array<{ problemMatcher?: unknown }> };
      }).tasks.tasks;
      for (const task of tasks) {
        assertEquals(task.problemMatcher, []);
      }
    });

    it("makes the full probe the default build task", () => {
      const ws = JSON.parse(renderWorkspace(draftCtx())) as {
        tasks: {
          tasks: Array<
            { label: string; group?: { kind: string; isDefault: boolean } }
          >;
        };
      };
      const def = ws.tasks.tasks.find((t) => t.group?.isDefault === true);
      assertEquals(def?.label, "probe");
    });

    it("passes repo-relative solution paths to the single-side tasks", () => {
      const ws = JSON.parse(renderWorkspace(draftCtx())) as {
        tasks: { tasks: Array<{ label: string; command: string }> };
      };
      const naive = ws.tasks.tasks.find((t) => t.label.includes("naive"));
      assertStringIncludes(naive?.command ?? "", `scratch/${ID}/naive`);
      assertStringIncludes(naive?.command ?? "", "--expect fail");
    });
  });

  describe("renderWorkspace (promoted state)", () => {
    const promoted = draftCtx({ state: "promoted", difficulty: "hard" });

    it("lists the committed paths and drops the solution projects", () => {
      const ws = JSON.parse(renderWorkspace(promoted)) as {
        folders: Array<{ path: string }>;
      };
      const paths = ws.folders.map((f) => f.path);
      assertEquals(paths.some((p) => p.includes("tasks/hard")), true);
      assertEquals(paths.some((p) => p.includes("tests/al/hard")), true);
      assertEquals(paths.some((p) => p.includes("site/catalog")), true);
      assertEquals(paths.includes("correct"), false);
      assertEquals(paths.includes("naive"), false);
    });

    it("includes the dependencies folder only with a prereq", () => {
      const ws = JSON.parse(
        renderWorkspace({ ...promoted, hasPrereq: true }),
      ) as { folders: Array<{ path: string }> };
      assertEquals(
        ws.folders.some((f) => f.path.includes(`dependencies/${ID}`)),
        true,
      );
    });

    it("offers a sync-taxonomy task", () => {
      const ws = JSON.parse(renderWorkspace(promoted)) as {
        tasks: { tasks: Array<{ label: string }> };
      };
      assertEquals(
        ws.tasks.tasks.some((t) => t.label.includes("taxonomy")),
        true,
      );
    });
  });

  describe("renderChecklist", () => {
    it("links every file the draft spans", () => {
      const md = renderChecklist(draftCtx());
      assertStringIncludes(md, "task.yml");
      assertStringIncludes(md, `correct/${ID}.Test.al`);
      assertStringIncludes(md, "NOTES.md");
    });

    it("states the reserved-prefix rule", () => {
      assertStringIncludes(renderChecklist(draftCtx()), `${ID}.`);
      assertStringIncludes(renderChecklist(draftCtx()), "must not");
    });

    it("warns about prereq symbols before the first probe", () => {
      const md = renderChecklist(draftCtx({ hasPrereq: true }));
      assertStringIncludes(md, "first probe");
    });

    it("links the taxonomy file in promoted state", () => {
      const md = renderChecklist(
        draftCtx({ state: "promoted", difficulty: "hard" }),
      );
      assertStringIncludes(md, "task-categories.yml");
    });

    it("notes the single-side task limits", () => {
      const md = renderChecklist(draftCtx());
      assertStringIncludes(md, ".probe.json");
    });
  });
});
