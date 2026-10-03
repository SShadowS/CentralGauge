// Fake AL language server for lsp-probe tests (M10-01). Content-Length framed
// JSON-RPC on stdio. Modes (env): FAKE_EMPTY no document symbols; FAKE_HANG
// never answers; FAKE_DIE exits on initialize; FAKE_IGNORE_EXIT ignores the
// exit notification; FAKE_ORPHAN starts a detached grandchild whose command
// line carries FAKE_ORPHAN's value; FAKE_STALE publishes the previous
// version's diagnostics 300 ms after the current ones; FAKE_NOVERSION omits
// the version on every publish; FAKE_NOVERSION_FIRST sends each publish once
// without and then once with its version; FAKE_INTERMEDIATE starts a child
// that starts a detached grandchild (command line carries the value) and is
// killed on the first didOpen, before documentSymbol answers; FAKE_MALFORMED
// answers initialize with a frame that is not JSON (with FAKE_GATE=<path> it
// first writes <path>.pid and waits for <path>.go); FAKE_FRAME answers
// initialize with the given header lines ('|' separated) and body {};
// FAKE_LATE_ORPHAN starts the marked detached child on shutdown (its pid
// goes to <FAKE_GATE>.pid when set); FAKE_CHATTER sends a
// window/logMessage every 50 ms. Hover reports the proxy env and argv[2].
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import process from "node:process";

const env = (k) => process.env[k] ?? "";
let orphan = null;
// Detached: a non-detached child sits in the runtime's kill-on-close job and
// dies with this server, and a detached powershell without a console exits at
// once. A detached copy of this runtime does neither.
function spawnOrphan(marker) {
  orphan = spawn(process.execPath, [
    "eval",
    `setTimeout(() => {}, 120000); // ${marker}`,
  ], { detached: true, stdio: "ignore", windowsHide: true });
  orphan.unref();
}
let buf = Buffer.alloc(0);
const docs = new Map();
const send = (o) => {
  const b = Buffer.from(JSON.stringify(o), "utf8");
  process.stdout.write(`Content-Length: ${b.length}\r\n\r\n`);
  process.stdout.write(b);
};
const diagnostics = (text) =>
  text.includes("Foo :=")
    ? [{
      code: "AL0118",
      message: "The name 'Foo' does not exist in the current context",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 3 },
      },
    }]
    : [];
const publishOne = (uri, version, text) =>
  send({
    jsonrpc: "2.0",
    method: "textDocument/publishDiagnostics",
    params: {
      uri,
      ...(version === undefined ? {} : { version }),
      diagnostics: diagnostics(text),
    },
  });
const publish = (uri, version, text) => {
  if (env("FAKE_NOVERSION_FIRST")) publishOne(uri, undefined, text);
  publishOne(uri, env("FAKE_NOVERSION") ? undefined : version, text);
};
// FAKE_INTERMEDIATE: the child, and a promise that settles once it is gone.
let intermediate = null;
let intermediateGone = Promise.resolve();
const INTERMEDIATE_JS = 'import { spawn } from "node:child_process";' +
  'spawn(Deno.execPath(), ["eval", "setTimeout(() => {}, 120000); // " + Deno.env.get("FAKE_INTERMEDIATE")],' +
  ' { detached: true, stdio: "ignore", windowsHide: true }).unref();' +
  'console.log("ready"); setInterval(() => {}, 1000);';
function changed(uri, version, text) {
  const prev = docs.get(uri);
  docs.set(uri, { version, text });
  publish(uri, version, text);
  if (env("FAKE_STALE") && prev) {
    setTimeout(() => publish(uri, prev.version, prev.text), 300);
  }
}

const CAPABILITIES = {
  capabilities: {
    hoverProvider: true,
    referencesProvider: true,
    documentSymbolProvider: true,
    workspaceSymbolProvider: true,
  },
};

function handle(m) {
  if (env("FAKE_HANG")) return;
  const reply = (result) => send({ jsonrpc: "2.0", id: m.id, result });
  switch (m.method) {
    case "initialize":
      if (env("FAKE_DIE")) process.exit(7);
      if (env("FAKE_ORPHAN")) spawnOrphan(env("FAKE_ORPHAN"));
      if (env("FAKE_MALFORMED")) {
        const bad = () =>
          process.stdout.write("Content-Length: 5\r\n\r\n{oops");
        const gate = env("FAKE_GATE");
        if (!gate) return void bad();
        writeFileSync(`${gate}.pid`, String(orphan?.pid ?? ""));
        const poll = setInterval(() => {
          if (existsSync(`${gate}.go`)) {
            clearInterval(poll);
            bad();
          }
        }, 50);
        return;
      }
      if (env("FAKE_FRAME")) {
        process.stdout.write(
          env("FAKE_FRAME").split("|").join("\r\n") + "\r\n\r\n{}",
        );
        return;
      }
      if (env("FAKE_INTERMEDIATE")) {
        // Answer only once the grandchild exists, so it is in the probe's tree.
        intermediate = spawn(process.execPath, ["eval", INTERMEDIATE_JS], {
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
        });
        intermediateGone = new Promise((r) => intermediate.once("exit", r));
        intermediate.stdout.once("data", () => reply(CAPABILITIES));
        return;
      }
      return reply(CAPABILITIES);
    case "textDocument/documentSymbol":
      return intermediateGone.then(() =>
        reply(
          env("FAKE_EMPTY") ? [] : [{
            name: "CGR Lease Math",
            kind: 5,
            children: [{ name: "RateFactor", kind: 6 }],
          }],
        )
      );
    case "textDocument/hover":
      return reply({
        contents: {
          kind: "plaintext",
          value: `proxy=[${process.env.HTTPS_PROXY ?? "unset"}] http=[${
            process.env.HTTP_PROXY ?? "unset"
          }] root=[${process.argv[2] ?? ""}]`,
        },
      });
    case "textDocument/references":
      return reply([{
        uri: m.params.textDocument.uri,
        range: {
          start: { line: 2, character: 23 },
          end: { line: 2, character: 33 },
        },
      }]);
    case "workspace/symbol":
      return reply(
        m.params.query === "CG Canary"
          ? []
          : [{ name: m.params.query, kind: 5 }],
      );
    case "textDocument/didOpen":
      intermediate?.kill();
      intermediate = null;
      return changed(
        m.params.textDocument.uri,
        m.params.textDocument.version,
        m.params.textDocument.text,
      );
    case "textDocument/didChange":
      return changed(
        m.params.textDocument.uri,
        m.params.textDocument.version,
        m.params.contentChanges[0].text,
      );
    case "shutdown":
      if (env("FAKE_LATE_ORPHAN")) {
        spawnOrphan(env("FAKE_LATE_ORPHAN"));
        if (env("FAKE_GATE")) {
          writeFileSync(`${env("FAKE_GATE")}.pid`, String(orphan.pid));
        }
      }
      return reply(null);
    case "exit":
      if (!env("FAKE_IGNORE_EXIT")) process.exit(0);
  }
}

process.stdin.on("data", (d) => {
  buf = Buffer.concat([buf, d]);
  for (;;) {
    const sep = buf.indexOf("\r\n\r\n");
    if (sep < 0) return;
    const len = Number(
      /Content-Length: *(\d+)/i.exec(buf.subarray(0, sep).toString("ascii"))[1],
    );
    if (buf.length < sep + 4 + len) return;
    const m = JSON.parse(buf.subarray(sep + 4, sep + 4 + len).toString("utf8"));
    buf = buf.subarray(sep + 4 + len);
    handle(m);
  }
});
if (env("FAKE_HANG") || env("FAKE_IGNORE_EXIT")) setInterval(() => {}, 1000);
if (env("FAKE_CHATTER")) {
  setInterval(() =>
    send({
      jsonrpc: "2.0",
      method: "window/logMessage",
      params: { type: 4, message: "indexing" },
    }), 50);
}
