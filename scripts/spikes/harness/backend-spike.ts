// SPIKE (throwaway): harness bench M0
// Usage: deno run --allow-all scripts/spikes/harness/backend-spike.ts <container> <hostWorkspace> <token>
import { join, resolve, SEPARATOR } from "@std/path";
import { BcContainerProvider } from "../../../src/container/bc-container-provider.ts";

const [container, hostWorkspace, token] = Deno.args;
if (!container || !hostWorkspace || !token) {
  throw new Error("usage: see header");
}
const root = resolve(hostWorkspace);
const provider = new BcContainerProvider();
let requests = 0;

Deno.serve({ hostname: "0.0.0.0", port: 3200 }, async (req) => {
  if (req.headers.get("authorization") !== `Bearer ${token}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const url = new URL(req.url);
  if (req.method !== "POST" || url.pathname !== "/compile") {
    return new Response("not found", { status: 404 });
  }
  const { app } = await req.json() as { app?: string };
  if (!app || !/^[A-Za-z][A-Za-z0-9 ]*$/.test(app)) {
    return new Response("bad app name", { status: 400 });
  }
  const dir = resolve(join(root, app));
  if (!dir.startsWith(root + SEPARATOR)) {
    return new Response("outside workspace", { status: 400 });
  }
  requests++;
  const t0 = Date.now();
  const appJson = JSON.parse(await Deno.readTextFile(join(dir, "app.json")));
  const result = await provider.compileProject(container, {
    path: dir,
    appJson,
    sourceFiles: [],
    testFiles: [],
  });
  const body = {
    request: requests,
    success: result.success,
    errors: result.errors.length,
    backendMs: Date.now() - t0,
    compilerMs: result.duration,
  };
  console.log(JSON.stringify({ app, ...body }));
  return Response.json(body);
});
