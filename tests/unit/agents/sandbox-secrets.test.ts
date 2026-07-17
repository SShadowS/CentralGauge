/**
 * Per-run secrets mount (M6 + M1/M4 follow-up).
 *
 * Both the Anthropic API key AND the MCP bearer token are written to the
 * read-only secrets mount instead of being passed via docker `-e` (which is
 * visible in `docker inspect` and on the argv). entrypoint.ps1 reads them from
 * C:\cg-secrets\{api-key,mcp-auth-token}.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { writeSandboxSecrets } from "../../../src/agents/sandbox-executor.ts";

Deno.test("writeSandboxSecrets", async (t) => {
  await t.step(
    "writes both the api key and the mcp auth token onto the mount",
    async () => {
      const dir = await Deno.makeTempDir({ prefix: "cg-secrets-test-" });
      try {
        await writeSandboxSecrets(dir, {
          apiKey: "sk-test-key-123",
          mcpAuthToken: "nonce-token-abc",
        });

        assertEquals(
          await Deno.readTextFile(join(dir, "api-key")),
          "sk-test-key-123",
        );
        assertEquals(
          await Deno.readTextFile(join(dir, "mcp-auth-token")),
          "nonce-token-abc",
        );
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
    },
  );
});
