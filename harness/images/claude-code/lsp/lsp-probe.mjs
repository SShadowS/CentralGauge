// AL LSP probe (M10): a minimal LSP client for the shipped AL language server
// plugin. It starts exactly what Claude Code starts: command, args and env
// come from the plugin's .lsp.json (env wins over the inherited environment).
//   --preflight        initialize, open one .al file of the first app,
//                      documentSymbol, shutdown. stderr only, so the
//                      inventory's single stdout line stays intact.
//   --script <steps>   run S1 steps with expectations; one JSON object on stdout.
// Every exit path kills the server's whole process tree; a clean shutdown must
// end the tree within CG_LSP_SHUTDOWN_MS. Each cleanup command (CIM table,
// taskkill) has its own deadline, CG_LSP_CMD_MS.
// Exit: 0 ok, 2 timeout, 3 server/protocol/cleanup, 4 configuration, 6 assertion.
// node: built-ins only (Node in the image, Deno in the unit tests).
import { Buffer } from "node:buffer";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const PLUGIN = process.env.CG_LSP_PLUGIN ??
  "C:\\cg-lsp\\al-language-server-go-windows";
const WORKSPACE = process.env.CG_LSP_WORKSPACE ?? "C:\\workspace";
const TIMEOUT_MS = Number(process.env.CG_LSP_TIMEOUT_MS ?? "180000");
const SHUTDOWN_MS = Number(process.env.CG_LSP_SHUTDOWN_MS ?? "10000");
const ROOT_VAR = "$" + "{CLAUDE_PLUGIN_ROOT}";
// Deadline of each synchronous cleanup command (CIM table, taskkill): a hung
// one is killed on expiry, so it delays an exit by at most CMD_MS per call
// instead of blocking the probe (and its JavaScript timeout) forever.
const CMD_MS = Number(process.env.CG_LSP_CMD_MS ?? "30000");
const EXIT = { ok: 0, timeout: 2, server: 3, config: 4, assertion: 6 };
let child = null;
let childExited = false;
// Server start as a Windows FILETIME (100 ns since 1601), taken before spawn:
// a process created earlier is not one the probe started.
let spawnedAt = 0n;
const fileTimeNow = () => (BigInt(Date.now()) + 11644473600000n) * 10000n;

const runSync = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, {
    windowsHide: true,
    timeout: CMD_MS,
    killSignal: "SIGKILL",
    ...opts,
  });

/**
 * Every process as pid, parent pid, creation FILETIME (string, identity with
 * the pid) and image name (CIM sees orphans too). CG_LSP_TEST_TABLE_CMD (a
 * JSON argv) replaces the command; tests only.
 */
function processTable() {
  const [cmd, ...args] = process.env.CG_LSP_TEST_TABLE_CMD
    ? JSON.parse(process.env.CG_LSP_TEST_TABLE_CMD)
    : [
      "powershell",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process | ForEach-Object { [string]$_.ProcessId + ' ' + [string]$_.ParentProcessId + ' ' + [string]$(if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 }) + ' ' + $_.Name }",
    ];
  const out = runSync(cmd, args, { encoding: "utf8" });
  return out.split(/\r?\n/).filter((l) => l.trim()).map((l) => {
    const [pid, ppid, created, ...name] = l.trim().split(" ");
    return {
      pid: Number(pid),
      ppid: Number(ppid),
      created,
      name: name.join(" "),
    };
  });
}

// Every process ever seen in the server's tree, keyed by pid and creation
// time. It accumulates over snapshots, so a grandchild stays tracked after the
// process between it and the server exits (its ppid then names a dead pid).
const tracked = new Map();
let rootCreated = null;
const key = (r) => `${r.pid}:${r.created}`;
const isAlive = (table, t) =>
  table.some((r) => r.pid === t.pid && r.created === t.created);

/**
 * Takes a process table and adds to `tracked` every child of a process whose
 * identity holds right now: the server while its creation time still matches,
 * and every tracked process still alive. A child must be created after its
 * parent, so a reused parent pid cannot adopt older processes. Returns the
 * table.
 */
function snapshot() {
  const table = processTable();
  const root = table.find((r) => r.pid === child.pid);
  if (
    rootCreated === null && root && !childExited &&
    BigInt(root.created) >= spawnedAt
  ) rootCreated = root.created;
  const parents = [...tracked.values()].filter((t) => isAlive(table, t));
  if (root && root.created === rootCreated) parents.push(root);
  for (let i = 0; i < parents.length; i++) {
    const p = parents[i];
    for (const r of table) {
      if (
        r.ppid === p.pid && r.pid !== child.pid && !tracked.has(key(r)) &&
        BigInt(r.created) >= BigInt(p.created)
      ) {
        tracked.set(key(r), r);
        parents.push(r);
      }
    }
  }
  return table;
}

// ponytail: identity is a pid plus its creation time from a snapshot taken
// just before the kill; a pid reused within that gap (milliseconds) would
// still be hit. Close it with process handles if that ever matters.
function killPid(pid) {
  try {
    runSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } catch { /* already gone, or the deadline passed */ }
}

/**
 * The server by pid only before its exit is seen (the open handle keeps the
 * pid from reuse); after that, only tracked processes whose identity a fresh
 * table confirms. Without a table those cannot be confirmed and are left.
 */
function killTree() {
  if (!child?.pid) return;
  let table = null;
  try {
    table = snapshot();
  } catch { /* no table: the root tree only */ }
  if (!childExited) killPid(child.pid);
  if (!table) return;
  for (const t of tracked.values()) if (isAlive(table, t)) killPid(t.pid);
}

function fail(code, msg) {
  process.stderr.write(`[FAIL] lsp-probe: ${msg}\n`);
  killTree();
  process.exit(code);
}

// Crash paths clean up too.
const errText = (e) => e instanceof Error ? e.message : String(e);
process.on(
  "uncaughtException",
  (e) => fail(EXIT.server, `uncaught: ${errText(e)}`),
);
process.on(
  "unhandledRejection",
  (e) => fail(EXIT.server, `unhandled rejection: ${errText(e)}`),
);

function serverSpec() {
  const file = join(PLUGIN, ".lsp.json");
  let al;
  try {
    al = JSON.parse(readFileSync(file, "utf8")).al;
  } catch (e) {
    fail(EXIT.config, `${file}: ${e.message}`);
  }
  if (!al || typeof al.command !== "string") {
    fail(EXIT.config, `${file} has no al.command`);
  }
  const sub = (s) => String(s).replaceAll(ROOT_VAR, PLUGIN);
  return {
    command: sub(al.command),
    args: (al.args ?? []).map(sub),
    env: { ...process.env, ...(al.env ?? {}) },
  };
}

const uri = (p) => pathToFileURL(p).href;
const sameUri = (a, b) =>
  decodeURIComponent(a).toLowerCase() === decodeURIComponent(b).toLowerCase();
const appDirs = () =>
  readdirSync(WORKSPACE, { withFileTypes: true })
    .filter((e) =>
      e.isDirectory() && existsSync(join(WORKSPACE, e.name, "app.json"))
    )
    .map((e) => e.name).sort();

function firstAl(dir) {
  const entries = readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const f = firstAl(p);
      if (f) return f;
    } else if (e.name.toLowerCase().endsWith(".al")) return p;
  }
  return null;
}

function connect(spec) {
  spawnedAt = fileTimeNow();
  child = spawn(spec.command, spec.args, {
    env: spec.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  child.on(
    "error",
    (e) => fail(EXIT.server, `cannot start ${spec.command}: ${e.message}`),
  );
  child.stderr.resume();
  child.stdin.on(
    "error",
    (e) => fail(EXIT.server, `server stdin: ${e.message}`),
  );
  const exited = new Promise((res) =>
    child.once("exit", () => {
      childExited = true;
      res(true);
    })
  );
  let buf = Buffer.alloc(0);
  let nextId = 1;
  const pending = new Map();
  const notes = [];
  const waiters = new Set();
  const send = (o) => {
    const b = Buffer.from(JSON.stringify(o), "utf8");
    child.stdin.write(`Content-Length: ${b.length}\r\n\r\n`);
    child.stdin.write(b);
  };
  child.stdout.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      const sep = buf.indexOf("\r\n\r\n");
      if (sep < 0) return;
      const m = /Content-Length: *(\d+)/i.exec(
        buf.subarray(0, sep).toString("ascii"),
      );
      if (!m) fail(EXIT.server, "frame without Content-Length");
      const end = sep + 4 + Number(m[1]);
      if (buf.length < end) return;
      let msg;
      try {
        msg = JSON.parse(buf.subarray(sep + 4, end).toString("utf8"));
      } catch (e) {
        fail(EXIT.server, `malformed frame: ${errText(e)}`);
      }
      buf = buf.subarray(end);
      if (msg.method === undefined) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        p?.(msg);
      } else if (msg.id !== undefined) {
        // A server request: configuration gets one null per item, the rest null.
        const items = msg.params?.items;
        send({
          jsonrpc: "2.0",
          id: msg.id,
          result:
            msg.method === "workspace/configuration" && Array.isArray(items)
              ? items.map(() => null)
              : null,
        });
      } else {
        notes.push(msg);
        for (const w of [...waiters]) w();
      }
    }
  });
  const request = (method, params) =>
    new Promise((res, rej) => {
      const id = nextId++;
      pending.set(id, (m) =>
        m.error
          ? rej(new Error(`${method}: ${m.error.message}`))
          : res(m.result));
      send({ jsonrpc: "2.0", id, method, params });
    });
  const notify = (method, params) => send({ jsonrpc: "2.0", method, params });
  /**
   * Diagnostics for u after notification index `from`, ignoring publishes that
   * name an older document version. Resolves { note } when the latest
   * publish of version >= minVersion satisfies pred and stays the latest for
   * settleMs. A publish without a version cannot be tied to an edit, so the
   * first one resolves { unversioned } at once: the caller fails the step as
   * not provable, never a pass after settling.
   */
  const waitDiagnostics = (u, minVersion, pred, from, settleMs) =>
    new Promise((res) => {
      let timer = null;
      const publishes = () =>
        notes.slice(from).filter((n) =>
          n.method === "textDocument/publishDiagnostics" &&
          sameUri(n.params.uri, u)
        );
      const latest = () =>
        publishes().reverse().find((n) => n.params.version >= minVersion);
      const settle = (r) => {
        clearTimeout(timer);
        waiters.delete(check);
        res(r);
      };
      let current = null;
      // Called on every notification; the settle timer restarts only when
      // the latest matching publish changes, not on unrelated traffic.
      function check() {
        const unversioned = publishes().find((n) =>
          typeof n.params.version !== "number"
        );
        if (unversioned) return settle({ unversioned });
        const n = latest() ?? null;
        if (n === current) return;
        current = n;
        clearTimeout(timer);
        if (n && pred(n)) {
          timer = setTimeout(() => settle({ note: n }), settleMs);
        }
      }
      waiters.add(check);
      check();
    });
  return { request, notify, waitDiagnostics, mark: () => notes.length, exited };
}

/** Opens a workspace-relative file once; a later text is a didChange with the next version. */
function docs(c) {
  const open = new Map();
  return (rel, text) => {
    const p = join(WORKSPACE, rel);
    const d = open.get(p);
    if (!d) {
      const t = text ?? readFileSync(p, "utf8");
      open.set(p, { text: t, version: 1 });
      c.notify("textDocument/didOpen", {
        textDocument: { uri: uri(p), languageId: "al", version: 1, text: t },
      });
    } else if (text !== undefined) {
      d.text = text;
      d.version++;
      c.notify("textDocument/didChange", {
        textDocument: { uri: uri(p), version: d.version },
        contentChanges: [{ text }],
      });
    }
    const cur = open.get(p);
    return { uri: uri(p), text: cur.text, version: cur.version };
  };
}

async function session(fn) {
  const c = connect(serverSpec());
  let done = false;
  child.on("exit", (code) => {
    if (!done) {
      fail(EXIT.server, `server exited before shutdown (exit ${code})`);
    }
  });
  const timer = setTimeout(
    () => fail(EXIT.timeout, `no result within ${TIMEOUT_MS} ms`),
    TIMEOUT_MS,
  );
  try {
    const apps = appDirs();
    if (apps.length === 0) fail(EXIT.config, `no app.json under ${WORKSPACE}`);
    const t0 = Date.now();
    await c.request("initialize", {
      processId: process.pid,
      rootUri: uri(WORKSPACE),
      workspaceFolders: apps.map((a) => ({
        uri: uri(join(WORKSPACE, a)),
        name: a,
      })),
      capabilities: {
        textDocument: {
          hover: { contentFormat: ["markdown", "plaintext"] },
          publishDiagnostics: { versionSupport: true },
        },
        workspace: { workspaceFolders: true, configuration: true },
      },
    });
    c.notify("initialized", {});
    snapshot();
    const out = await fn(c, apps, t0);
    // Cleanup is part of qualification: every process ever tracked in the
    // tree must be gone after exit.
    snapshot();
    done = true;
    await c.request("shutdown", null);
    c.notify("exit", null);
    const gone = await Promise.race([
      c.exited,
      new Promise((r) => setTimeout(() => r(false), SHUTDOWN_MS)),
    ]);
    if (!gone) {
      fail(EXIT.server, `server did not exit within ${SHUTDOWN_MS} ms of exit`);
    }
    const table = processTable();
    // Same pid and same creation time: the very process tracked earlier.
    const survivors = [...tracked.values()].filter((t) => isAlive(table, t));
    if (survivors.length > 0) {
      for (const s of survivors) killPid(s.pid);
      fail(
        EXIT.server,
        `${survivors.length} subprocess(es) survived shutdown: ${
          survivors.map((s) => s.name).join(", ")
        }`,
      );
    }
    return out;
  } catch (e) {
    fail(EXIT.server, e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
}

const hoverText = (h) => {
  const one = (x) => typeof x === "string" ? x : x?.value ?? "";
  const c = h?.contents;
  return Array.isArray(c) ? c.map(one).join("\n") : one(c);
};
const symbolNames = (xs) =>
  (xs ?? []).flatMap((s) => [s.name, ...symbolNames(s.children)]);
const location = (l) =>
  `${relative(WORKSPACE, fileURLToPath(l.uri)).replaceAll("\\", "/")}:${
    l.range.start.line + 1
  }`;

/** null when the step's expectation holds (or it has none), else why not. */
function verdict(s, result) {
  const e = s.expect;
  if (!e) return null;
  if (s.op === "symbols") {
    const got = symbolNames(result);
    const miss = e.names.filter((n) => !got.includes(n));
    return miss.length
      ? `missing symbols ${miss.join(", ")} (got ${got.join(", ")})`
      : null;
  }
  if (s.op === "hover") {
    const t = hoverText(result);
    const miss = e.contains.filter((x) => !t.includes(x));
    return miss.length
      ? `hover lacks ${miss.join(", ")}: ${t.slice(0, 300)}`
      : null;
  }
  if (s.op === "references") {
    const got = [...new Set((result ?? []).map(location))].sort();
    const want = [...e.locations].sort();
    return JSON.stringify(got) === JSON.stringify(want)
      ? null
      : `references ${JSON.stringify(got)} != ${JSON.stringify(want)}`;
  }
  if (s.op === "wsymbols") {
    const got = (result ?? []).map((x) => x.name);
    if (e.none) {
      return got.length ? `expected no symbols, got ${got.join(", ")}` : null;
    }
    const miss = e.names.filter((n) => !got.includes(n));
    return miss.length ? `missing workspace symbols ${miss.join(", ")}` : null;
  }
  return null;
}

const mode = process.argv[2];
if (mode === "--preflight") {
  const r = await session(async (c, apps, t0) => {
    const file = firstAl(join(WORKSPACE, apps[0]));
    if (!file) fail(EXIT.config, `no .al file under ${apps[0]}`);
    const d = docs(c)(relative(WORKSPACE, file));
    const syms = await c.request("textDocument/documentSymbol", {
      textDocument: { uri: d.uri },
    });
    if (!Array.isArray(syms) || syms.length === 0) {
      fail(EXIT.server, `documentSymbol on ${file} returned no symbols`);
    }
    return { ms: Date.now() - t0, symbols: symbolNames(syms).length };
  });
  process.stderr.write(
    `[OK] lsp-probe preflight: ${r.symbols} symbols in ${r.ms} ms\n`,
  );
  process.exit(EXIT.ok);
} else if (mode === "--script" && process.argv[3]) {
  let steps;
  try {
    steps = JSON.parse(readFileSync(process.argv[3], "utf8"));
  } catch (e) {
    fail(EXIT.config, `steps: ${e.message}`);
  }
  const r = await session(async (c, _apps, t0) => {
    const doc = docs(c);
    const out = [];
    // Per file (document uri): the notification mark and version of its last edit.
    const edits = new Map();
    for (const [i, s] of steps.entries()) {
      process.stderr.write(`[step ${i}] ${s.op}\n`);
      const t = Date.now();
      const position = { line: s.line, character: s.character };
      let result = null;
      let why = null;
      if (s.op === "symbols") {
        result = await c.request("textDocument/documentSymbol", {
          textDocument: { uri: doc(s.file).uri },
        });
      } else if (s.op === "hover") {
        result = await c.request("textDocument/hover", {
          textDocument: { uri: doc(s.file).uri },
          position,
        });
      } else if (s.op === "references") {
        result = await c.request("textDocument/references", {
          textDocument: { uri: doc(s.file).uri },
          position,
          context: { includeDeclaration: true },
        });
      } else if (s.op === "wsymbols") {
        result = await c.request("workspace/symbol", { query: s.query });
      } else if (s.op === "edit") {
        const cur = doc(s.file).text;
        if (!cur.includes(s.find)) {
          fail(EXIT.config, `edit: ${s.file} does not contain ${s.find}`);
        }
        const mark = c.mark();
        const d = doc(s.file, cur.replace(s.find, s.replace));
        edits.set(d.uri, { mark, version: d.version });
      } else if (s.op === "diagnostics") {
        const has = (n) =>
          n.params.diagnostics.some((x) =>
            String(x.code?.value ?? x.code) === s.code
          );
        const u = doc(s.file).uri;
        // A file never edited is gated on its opened version 1, from the start.
        const e = edits.get(u) ?? { mark: 0, version: 1 };
        const w = await c.waitDiagnostics(
          u,
          e.version,
          (n) => has(n) === s.present,
          e.mark,
          s.settleMs ?? 2000,
        );
        result = (w.note ?? w.unversioned).params.diagnostics;
        if (w.unversioned) {
          why =
            `publishDiagnostics for ${s.file} has no document version: not provable against document version ${e.version}`;
        }
      } else if (s.op === "hold") {
        await new Promise((res) => setTimeout(res, s.ms));
      } else fail(EXIT.config, `unknown step op ${s.op}`);
      snapshot();
      why ??= verdict(s, result);
      out.push({ op: s.op, ms: Date.now() - t, ok: why === null, why, result });
    }
    return {
      total_ms: Date.now() - t0,
      ok: out.every((x) => x.ok),
      steps: out,
    };
  });
  process.stdout.write(JSON.stringify(r) + "\n");
  process.exit(r.ok ? EXIT.ok : EXIT.assertion);
} else {
  fail(EXIT.config, "usage: lsp-probe.mjs --preflight | --script <steps.json>");
}
