import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

import { createHandler, startServer } from "../../../src/dashboard/server.ts";

const deps = {
  scratchDir: "/tmp/nope",
  listDrafts: () =>
    Promise.resolve([
      { id: "CG-AL-X054", dir: "/tmp/nope/CG-AL-X054", hasPrereq: false },
    ]),
  runQuick: () => Promise.reject(new Error("not called in this test")),
} as unknown as Parameters<typeof createHandler>[0];

describe("dashboard/server", () => {
  it("serves the draft list as JSON", async () => {
    const res = await createHandler(deps)(
      new Request("http://localhost/api/drafts"),
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.drafts[0].id, "CG-AL-X054");
  });

  it("serves the UI at the root", async () => {
    const res = await createHandler(deps)(new Request("http://localhost/"));
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type")?.includes("text/html"), true);
  });

  it("404s an unknown path", async () => {
    const res = await createHandler(deps)(
      new Request("http://localhost/nope"),
    );
    assertEquals(res.status, 404);
  });

  it("rejects a run request with no models", async () => {
    const res = await createHandler(deps)(
      new Request("http://localhost/api/run", {
        method: "POST",
        body: JSON.stringify({ draftId: "CG-AL-X054", models: [] }),
      }),
    );
    assertEquals(res.status, 400);
  });

  it("rejects a run request naming an unknown draft", async () => {
    const res = await createHandler(deps)(
      new Request("http://localhost/api/run", {
        method: "POST",
        body: JSON.stringify({ draftId: "CG-AL-NOPE", models: ["m"] }),
      }),
    );
    assertEquals(res.status, 400);
  });

  // Positive control for the two 400 tests above. Without it, a handler that
  // returned 400 for EVERY /api/run request would satisfy them both. This
  // asserts a well-formed request gets past validation and reaches runQuick —
  // the injected runQuick rejects, so anything other than a 400 proves the
  // request was accepted.
  it("accepts a well-formed run request", async () => {
    const res = await createHandler(deps)(
      new Request("http://localhost/api/run", {
        method: "POST",
        body: JSON.stringify({ draftId: "CG-AL-X054", models: ["m"] }),
      }),
    );
    assertEquals(res.status === 400, false);
  });

  it("binds loopback only", async () => {
    const server = await startServer({ scratchDir: "/tmp/nope", port: 0 });
    try {
      assertEquals(server.hostname, "127.0.0.1");
    } finally {
      await server.shutdown();
    }
  });
});
