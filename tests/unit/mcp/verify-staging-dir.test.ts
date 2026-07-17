import { afterEach, describe, it } from "@std/testing/bdd";
import { assert, assertStringIncludes } from "@std/assert";
import { basename, join } from "@std/path";
import { createVerifyStagingDir } from "../../../mcp/al-tools-server.ts";

/**
 * TOCTOU containment (M1/M4 follow-up): the al_verify staging directory must
 * be created on the HOST outside any agent-writable workspace mount. If it
 * sat inside the mounted workspace, a container-side watcher could overwrite
 * the copied benchmark test or the compiled .app mid-verify to mint a passing
 * verdict, or read the hidden benchmark test. The server-chosen temp path is
 * never derived from a model argument.
 */
describe("createVerifyStagingDir", () => {
  const created: string[] = [];

  afterEach(async () => {
    for (const dir of created.splice(0)) {
      try {
        await Deno.remove(dir, { recursive: true });
      } catch {
        // best-effort
      }
    }
  });

  function withSep(path: string): string {
    return path.endsWith("\\") || path.endsWith("/") ? path : path + "\\";
  }

  it("creates the staging dir outside the workspace mount and project dir", async () => {
    // Simulate a sandbox workspace mount (host side of C:\workspace) and the
    // project directory the agent writes into.
    const workspaceHostPath = await Deno.makeTempDir({ prefix: "cg-ws-" });
    created.push(workspaceHostPath);
    const projectDir = join(workspaceHostPath, "project");

    const verifyDir = await createVerifyStagingDir();
    created.push(verifyDir);

    // Must be a real directory chosen by the server, not derived from input.
    const stat = await Deno.stat(verifyDir);
    assert(stat.isDirectory, "staging dir should exist");
    assertStringIncludes(basename(verifyDir), "cg-verify-");

    // Must NOT sit under the workspace mount (agent-writable) ...
    assert(
      !verifyDir.startsWith(withSep(workspaceHostPath)),
      `staging dir ${verifyDir} must not be under workspace mount ${workspaceHostPath}`,
    );
    // ... and must NOT sit under the project directory.
    assert(
      !verifyDir.startsWith(withSep(projectDir)),
      `staging dir ${verifyDir} must not be under project dir ${projectDir}`,
    );
  });

  it("creates a distinct directory on each call", async () => {
    const a = await createVerifyStagingDir();
    created.push(a);
    const b = await createVerifyStagingDir();
    created.push(b);
    assert(a !== b, "each staging dir must be unique");
  });
});
