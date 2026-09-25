// al-tools MCP server (spec 1a D5, section 5 item 4): a stdio front end to the
// same cg-al backend, never to BC. Newline-delimited JSON-RPC 2.0. The token
// is read from a file (never argv, never env); CG_BACKEND_URL and
// CG_EXECUTION_ID are the runner's non-secret env. Arguments are validated
// against the backend's bounds (src/harness/backend.ts CompileBody, TestBody)
// before any backend call. Runs under Node (image) and Deno (unit tests).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";

const DEF = JSON.parse(
  readFileSync(
    process.env.CG_AL_TOOLS_DEF ?? "C:\\al-tools-tools.json",
    "utf8",
  ),
);
const SECRETS = process.env.CG_SECRETS_DIR ?? "C:\\cg-secrets";
const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
// Pairing with src/harness/backend.ts: requestDeadlineMs defaults to
// 30 * 60_000. The client waits that long plus a margin, so the backend has
// answered (or given up) and released its one-request slot before the client
// could give up; a client timeout therefore means the backend is stuck.
const BACKEND_DEADLINE_MS = 30 * 60_000;
const CLIENT_MARGIN_MS = 60_000;
const CALL_TIMEOUT_MS = envMs(
  "CG_AL_TOOLS_CALL_TIMEOUT_MS",
  BACKEND_DEADLINE_MS + CLIENT_MARGIN_MS,
);
// A queued call's deadline starts when it arrives.
const QUEUE_WAIT_MS = envMs("CG_AL_TOOLS_QUEUE_WAIT_MS", 10 * 60_000);
const MAX_QUEUED = 4;
const MAX_RESULT_BYTES = 256 * 1024;
const APP = /^[A-Za-z][A-Za-z0-9 ]{0,63}$/;
function envMs(name, fallback) {
  const v = process.env[name];
  if (v === undefined) return fallback;
  if (!/^[1-9][0-9]{0,9}$/.test(v)) {
    throw new Error(`${name} must be a positive integer (milliseconds)`);
  }
  return Number(v);
}
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const result = (o, isError) => ({
  content: [{ type: "text", text: JSON.stringify(o) }],
  isError,
});

/** [op, body] or an error string. */
function validate(name, args) {
  if (!isObj(args)) return "arguments must be an object";
  const keys = Object.keys(args);
  const list = (k, max, ok) => {
    const v = args[k];
    if (v === undefined) return null;
    if (!Array.isArray(v) || v.length < 1 || v.length > max || !v.every(ok)) {
      return `${k} is malformed`;
    }
    return v;
  };
  if (name === "al_compile") {
    if (keys.some((k) => k !== "apps")) return "unknown argument";
    const apps = list("apps", 32, (x) => typeof x === "string" && APP.test(x));
    if (typeof apps === "string") return apps;
    return ["compile", apps === null ? {} : { apps }];
  }
  if (name === "al_test") {
    if (keys.some((k) => k !== "codeunits")) return "unknown argument";
    const cus = list(
      "codeunits",
      64,
      // backend.ts agentCodeunit: the Test app band without the fixture band (84900-84999) and 80013.
      (x) => Number.isInteger(x) && x >= 80000 && x <= 84899 && x !== 80013,
    );
    if (typeof cus === "string") return cus;
    return ["test", cus === null ? {} : { codeunits: cus }];
  }
  if (name === "al_symbols") {
    return keys.length === 0 ? ["symbols", {}] : "al_symbols takes no arguments";
  }
  return `unknown tool ${String(name)}`;
}

/** Set after a client timeout: the backend may still hold the request, so nothing more is sent. */
let dead = false;

/** The body up to MAX_RESULT_BYTES; over it, the prefix and truncated. */
async function readCapped(r) {
  const chunks = [];
  let n = 0;
  let truncated = false;
  const reader = r.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    if (n + value.length > MAX_RESULT_BYTES) {
      chunks.push(value.subarray(0, MAX_RESULT_BYTES - n));
      n = MAX_RESULT_BYTES;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    n += value.length;
  }
  const all = new Uint8Array(n);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  return { text: new TextDecoder().decode(all), truncated };
}

async function call(op, body) {
  if (dead) {
    return result({
      op,
      error:
        "al-tools unavailable: an earlier backend call timed out and the backend may still be busy",
    }, true);
  }
  const tokenFile = join(SECRETS, "backend-token");
  let token;
  try {
    token = readFileSync(tokenFile, "utf8").trim();
  } catch {
    token = "";
  }
  // The environment's fault, never the agent's code (as cg-al.ps1, exit 2).
  if (token === "") {
    return result({ op, error: `backend token unavailable (${tokenFile})` }, true);
  }
  let status = 0;
  let raw = "";
  try {
    const r = await fetch(`${process.env.CG_BACKEND_URL}/v1/${op}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "x-cg-execution": process.env.CG_EXECUTION_ID ?? "",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    status = r.status;
    const b = await readCapped(r);
    if (b.truncated) {
      return result({
        op,
        status,
        truncated: true,
        limit_bytes: MAX_RESULT_BYTES,
        result: b.text,
      }, true);
    }
    raw = b.text;
  } catch (e) {
    if (e?.name === "TimeoutError") {
      dead = true;
      return result({
        op,
        error:
          `backend call timed out after ${CALL_TIMEOUT_MS} ms; al-tools is unavailable for the rest of this session`,
      }, true);
    }
    // The name only: a fetch error message can echo the URL and headers.
    raw = JSON.stringify({ error: `backend unreachable: ${e?.name ?? "error"}` });
  }
  let parsed = raw;
  try {
    parsed = JSON.parse(raw);
  } catch { /* not JSON: returned as text */ }
  const ok = status === 200 && isObj(parsed) && parsed.ok === true;
  return result({ op, status, result: parsed }, !ok);
}

// The backend admits one request per execution at a time (429 otherwise, M1-19),
// and a client may send several tools/call requests at once: backend calls run
// one after another, in arrival order. At most MAX_QUEUED wait behind the one in
// flight; each waits at most QUEUE_WAIT_MS from arrival and is then answered, never sent.
let chain = Promise.resolve();
let admitted = 0;
function enqueue(op, body) {
  if (admitted >= 1 + MAX_QUEUED) {
    return Promise.resolve(result({
      op,
      error:
        `queue full: at most ${MAX_QUEUED} al-tools calls may wait behind the one running; not sent`,
    }, true));
  }
  admitted++;
  let released = false;
  const release = () => {
    if (!released) admitted--;
    released = true;
  };
  let expired = false;
  let timer;
  const waited = new Promise((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      release();
      resolve(result({
        op,
        error:
          `waited ${QUEUE_WAIT_MS} ms in the queue behind other al-tools calls; not sent`,
      }, true));
    }, QUEUE_WAIT_MS);
  });
  const turn = chain.then(async () => {
    clearTimeout(timer);
    if (expired) return null;
    try {
      return await call(op, body);
    } finally {
      release();
    }
  });
  chain = turn.then(() => {}, () => {});
  return Promise.race([turn.then((r) => r ?? waited), waited]);
}

async function handle(msg) {
  // Batches (an array), a wrong jsonrpc tag or a missing method are refused, never dropped.
  if (!isObj(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    const id = isObj(msg) && (typeof msg.id === "string" ||
        typeof msg.id === "number")
      ? msg.id
      : null;
    return send({
      jsonrpc: "2.0",
      id,
      error: { code: -32600, message: "invalid request" },
    });
  }
  if (!Object.hasOwn(msg, "id")) return; // a notification: no reply
  const { id, method, params } = msg;
  if (typeof id !== "string" && typeof id !== "number") {
    return send({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "invalid request: id must be a string or a number" },
    });
  }
  if (method === "initialize") {
    const asked = params?.protocolVersion;
    return send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "al-tools", version: DEF.version },
      },
    });
  }
  if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
  if (method === "tools/list") {
    return send({ jsonrpc: "2.0", id, result: { tools: DEF.tools } });
  }
  if (method === "tools/call") {
    if (!isObj(params)) {
      return send({
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: "invalid params: params must be an object" },
      });
    }
    const v = validate(params.name, params.arguments);
    return send({
      jsonrpc: "2.0",
      id,
      result: typeof v === "string"
        ? result({ error: v }, true)
        : await enqueue(v[0], v[1]),
    });
  }
  send({
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `method not found: ${method}` },
  });
}

const pending = new Set();
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (line.trim() === "") return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return send({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "parse error" },
    });
  }
  const p = handle(msg).catch(() =>
    send({
      jsonrpc: "2.0",
      id: msg?.id ?? null,
      error: { code: -32603, message: "internal error" },
    })
  );
  pending.add(p);
  p.finally(() => pending.delete(p));
});
// No process.exit: it can cut buffered stdout. The process ends when stdin
// closes and the last reply is written.
rl.on("close", async () => {
  await Promise.all([...pending]);
  process.exitCode = 0;
});
