/**
 * Minimal HTTP stub standing in for al-tools-server in McpServerManager
 * tests. Serves /health on the requested port and ignores all other flags
 * the manager passes (--auth-token, --verdict-dir, --run-nonce, ...).
 */

const portIdx = Deno.args.indexOf("--port");
const port = Number(Deno.args[portIdx + 1]);

Deno.serve(
  { hostname: "127.0.0.1", port },
  () =>
    new Response(JSON.stringify({ status: "ok", server: "stub" }), {
      headers: { "Content-Type": "application/json" },
    }),
);
