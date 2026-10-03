// AL LSP probe (M10): a minimal LSP client for the shipped AL language server
// plugin. It starts exactly what Claude Code starts: command, args and env
// come from the plugin's .lsp.json (env wins over the inherited environment).
//   --preflight        initialize, open one .al file of the first app,
//                      documentSymbol, shutdown. stderr only, so the
//                      inventory's single stdout line stays intact.
//   --script <steps>   run S1 steps with expectations; one JSON object on stdout.
// Every exit path, a clean one included, ends with a sweep of the server's
// whole process tree, and a clean shutdown must end the tree within
// CG_LSP_SHUTDOWN_MS. Each cleanup command (CIM table, identity kill) has its
// own deadline, CG_LSP_CMD_MS. A cleanup that cannot be verified exits 3.
// Identity is PID plus microsecond creation time: no handle is retained from
// discovery, so it is best effort (a PID reused with the same microsecond
// creation time, or a child a reused parent PID started inside the
// parent-death bound, would be taken for ours). The check and the kill share
// one handle, so nothing is killed between a verified check and the kill.
// The probe runs inside a per-cell container, so this residual cannot reach
// host processes.
// Exit: 0 ok, 2 timeout, 3 server/protocol/cleanup, 4 configuration, 6 assertion.
// node: built-ins only (Node in the image, Deno in the unit tests).
import { Buffer } from "node:buffer";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, normalize, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  fileTimeBounds,
  headerBytes,
  MAX_HEADER_BYTES,
} from "./lsp-probe-lib.mjs";

const EXIT = { ok: 0, timeout: 2, server: 3, config: 4, assertion: 6 };
/** A duration setting: finite and > 0, else exit 4 (0 would disable a deadline). */
function ms(name, fallback) {
  const raw = process.env[name] ?? fallback;
  const v = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(v) || v <= 0) {
    process.stderr.write(
      `[FAIL] lsp-probe: ${name}=${raw} must be a finite number of ms > 0\n`,
    );
    process.exit(EXIT.config);
  }
  return v;
}
const PLUGIN = process.env.CG_LSP_PLUGIN ??
  "C:\\cg-lsp\\al-language-server-go-windows";
const WORKSPACE = process.env.CG_LSP_WORKSPACE ?? "C:\\workspace";
const TIMEOUT_MS = ms("CG_LSP_TIMEOUT_MS", "180000");
const SHUTDOWN_MS = ms("CG_LSP_SHUTDOWN_MS", "10000");
// Deadline of each synchronous cleanup command (CIM table, identity kill): a
// hung one is killed on expiry, so it delays an exit by at most CMD_MS per
// call instead of blocking the probe (and its JavaScript timeout) forever.
const CMD_MS = ms("CG_LSP_CMD_MS", "30000");
const ROOT_VAR = "$" + "{CLAUDE_PLUGIN_ROOT}";
// Largest accepted frame body; a bigger Content-Length is a protocol failure.
const MAX_FRAME_BYTES = 64 * 1024 * 1024;
let child = null;
let childExited = false;
// Creation times are Windows FILETIMEs (100 ns since 1601) cut to whole
// microseconds (ft - ft % 10), the precision CIM reports; the identity kill
// cuts Process.StartTime the same way, so both compare exactly. spawnedAt is
// taken before spawn: a process created earlier is not one the probe started.
let spawnedAt = 0n;
// Clock reads are rounded outward (lsp-probe-lib.mjs fileTimeBounds).
const fileTimeLow = () => fileTimeBounds(Date.now()).low;
const fileTimeHigh = () => fileTimeBounds(Date.now()).high;

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
      "Get-CimInstance Win32_Process | ForEach-Object { $f = [int64]0; if ($_.CreationDate) { $f = $_.CreationDate.ToFileTimeUtc(); $f = $f - ($f % 10) }; [string]$_.ProcessId + ' ' + [string]$_.ParentProcessId + ' ' + [string]$f + ' ' + $_.Name }",
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
// When the server's exit was seen (FILETIME): an upper bound on its death.
let rootDeadBy = null;
const key = (r) => `${r.pid}:${r.created}`;
const isAlive = (table, t) =>
  table.some((r) => r.pid === t.pid && r.created === t.created);

/**
 * Takes a process table and adds to `tracked` every child of the server or of
 * any tracked process, alive or dead. A child of parent P is P's when it was
 * created no earlier than P and no later than P's death (first seen dead; for
 * the server, its exit event), and, if P's pid is now held by another
 * process Q, before Q was created (a child of a reused pid is newer than the
 * reuser). Returns the table.
 */
function snapshot() {
  const table = processTable();
  const now = fileTimeHigh();
  const root = table.find((r) => r.pid === child.pid);
  if (
    rootCreated === null && root && !childExited &&
    BigInt(root.created) >= spawnedAt
  ) {
    // Test only: CG_LSP_TEST_ROOT_CREATED records a wrong creation time.
    rootCreated = process.env.CG_LSP_TEST_ROOT_CREATED ?? root.created;
  }
  const parents = [...tracked.values()];
  if (rootCreated !== null) {
    parents.push({ pid: child.pid, created: rootCreated, root: true });
  }
  for (let i = 0; i < parents.length; i++) {
    const p = parents[i];
    const occupant = table.find((r) => r.pid === p.pid);
    const alive = occupant?.created === p.created;
    if (!alive && !p.root) p.deadBy ??= now;
    const upper = alive ? now : p.root ? (rootDeadBy ?? now) : p.deadBy;
    const reusedAt = occupant && !alive ? BigInt(occupant.created) : null;
    for (const r of table) {
      const c = BigInt(r.created);
      if (
        r.ppid === p.pid && r.pid !== child.pid && !tracked.has(key(r)) &&
        c >= BigInt(p.created) && c <= upper &&
        (reusedAt === null || c < reusedAt)
      ) {
        tracked.set(key(r), r);
        parents.push(r);
      }
    }
  }
  return table;
}

// One process at a time, never a tree: open the process once ($p.Handle
// caches a handle that StartTime and Kill then reuse), compare its start time
// with the recorded creation time, and kill through that same handle. A pid
// reused by another process fails the comparison and is never touched.
const KILL_PS = "$ErrorActionPreference = 'Stop'; " +
  "foreach ($t in $env:CG_LSP_KILL_TARGETS.Split(',')) { " +
  "$id, $c = $t.Split(':'); $p = $null; " +
  "try { $p = [System.Diagnostics.Process]::GetProcessById([int]$id) } catch { $id + ' gone'; continue }; " +
  "try { $null = $p.Handle; $f = $p.StartTime.ToFileTimeUtc(); $f = $f - ($f % 10) } " +
  "catch { if ($p.HasExited) { $id + ' gone' } else { $id + ' unverifiable' }; continue }; " +
  "if ([string]$f -ne $c) { $id + ' mismatch'; continue }; " +
  "if ($p.HasExited) { $id + ' gone'; continue }; " +
  "try { $p.Kill() } catch { }; " +
  "if ($p.WaitForExit(2000)) { $id + ' killed' } else { $id + ' failed' } }";

/**
 * Kills each {pid, created} target by identity (one bounded call) and waits
 * for each to exit. Reports every result on stderr; returns { results: pid
 * to status, open: the targets that may still be ours and alive
 * (unverifiable, failed, or no result) }.
 */
function killByIdentity(targets) {
  if (targets.length === 0) return { open: [], results: new Map() };
  const results = new Map();
  try {
    const out = runSync("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      KILL_PS,
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        CG_LSP_KILL_TARGETS: targets.map((t) => `${t.pid}:${t.created}`).join(
          ",",
        ),
      },
    });
    for (const l of out.split(/\r?\n/)) {
      const [pid, status] = l.trim().split(" ");
      if (status) results.set(Number(pid), status);
    }
  } catch (e) {
    process.stderr.write(`[cleanup] identity kill: ${errText(e)}\n`);
  }
  const open = [];
  for (const t of targets) {
    const status = results.get(t.pid) ?? "no result";
    process.stderr.write(`[cleanup] pid ${t.pid}: ${status}\n`);
    if (!["killed", "gone", "mismatch"].includes(status)) open.push(t);
  }
  return { open, results };
}

/**
 * Kills the server and every tracked process a fresh table still shows with
 * the recorded creation time, each by identity (never by bare pid, never
 * /T), confirming each exit; then sweeps for children the server started
 * since the last snapshot. Returns null when cleanup is verified, else why
 * not.
 */
function killTree() {
  if (!child?.pid) return null;
  let table = null;
  let why = null;
  try {
    // Test only: skip the snapshot right before the kill.
    if (!process.env.CG_LSP_TEST_SKIP_PREKILL_SNAPSHOT) table = snapshot();
  } catch (e) {
    why = `process table unreadable (${errText(e)}): the tree is unverified`;
  }
  // Nothing in here yields to the event loop, so if the server's exit has not
  // been seen yet, its handle stays open (and its pid unreusable) throughout.
  const held = !childExited;
  const targets = table
    ? [...tracked.values()].filter((t) => isAlive(table, t))
    : [];
  // The server first, killed by identity so its death is confirmed (it waits
  // for the exit), not assumed.
  const root = held && rootCreated
    ? { pid: child.pid, created: rootCreated }
    : null;
  if (root) targets.unshift(root);
  // Test only: extra targets, as if a recorded pid had been reused.
  targets.push(...JSON.parse(process.env.CG_LSP_TEST_EXTRA_KILL ?? "[]"));
  const first = killByIdentity(targets);
  const rootDead = !held ||
    ["killed", "gone"].includes(first.results.get(child.pid));
  if (!rootDead) {
    // Unconfirmed: still end it through the spawn handle, but report it.
    try {
      child.kill("SIGKILL");
    } catch { /* reported below */ }
    why ??= `server pid ${child.pid} not confirmed dead`;
  }
  if (held && rootDead) rootDeadBy ??= fileTimeHigh();
  let open = first.open.filter((t) => t !== root);
  // Final sweep, always: children started since the last snapshot (by the
  // server or any tracked process, dead or alive) still name their parent's
  // pid; find and kill them, with their trees.
  try {
    const after = snapshot();
    const late = [...tracked.values()].filter((t) =>
      isAlive(after, t) && !targets.includes(t)
    );
    open = open.concat(killByIdentity(late).open);
  } catch (e) {
    why ??= `process table unreadable after the kill (${errText(e)})`;
  }
  if (open.length > 0) {
    why ??= `${open.length} process(es) not confirmed dead: ${
      open.map((t) => t.pid).join(", ")
    }`;
  }
  return why;
}

/** Cleans up and exits; an unverified cleanup turns any exit into 3. */
function fail(code, msg) {
  process.stderr.write(`[FAIL] lsp-probe: ${msg}\n`);
  const why = killTree();
  if (why) {
    process.stderr.write(`[FAIL] lsp-probe: cleanup incomplete: ${why}\n`);
    process.exit(EXIT.server);
  }
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

/**
 * The body length of a header block (the bytes before CRLF CRLF), or a
 * string saying why the block is not acceptable. Lines are split on CRLF
 * only, and no line may hold a control character other than tab (so a bare
 * CR or LF is refused); every line a `field: value` header, exactly one
 * Content-Length (field name case-insensitive) whose value is digits only
 * and at most MAX_FRAME_BYTES.
 */
function frameLength(block) {
  const lengths = [];
  const show = (line) => JSON.stringify(line.slice(0, 80));
  for (const line of block.split("\r\n")) {
    // deno-lint-ignore no-control-regex
    if (/[\x00-\x08\x0a-\x1f\x7f]/.test(line)) {
      return `control character in header line ${show(line)}`;
    }
    const colon = line.indexOf(":");
    if (colon < 1 || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+:/.test(line)) {
      return `not a header line: ${show(line)}`;
    }
    if (line.slice(0, colon).toLowerCase() === "content-length") {
      // One token between optional spaces or tabs, digits only.
      const tokens = line.slice(colon + 1).split(/[ \t]+/).filter(Boolean);
      const value = tokens.length === 1 ? tokens[0] : "";
      if (value === "" || [...value].some((ch) => ch < "0" || ch > "9")) {
        return `bad Content-Length: ${show(line)}`;
      }
      lengths.push(value);
    }
  }
  if (lengths.length !== 1) {
    return `${lengths.length} Content-Length headers, need exactly one`;
  }
  const n = Number(lengths[0]);
  if (!Number.isSafeInteger(n) || n > MAX_FRAME_BYTES) {
    return `Content-Length ${lengths[0]} over ${MAX_FRAME_BYTES} bytes`;
  }
  return n;
}

const uri = (p) => pathToFileURL(p).href;
/**
 * One identity for a document, whether named by a workspace-relative path,
 * an absolute path or a file URI (percent-encoded or not): the decoded,
 * normalized, lower-cased Windows path. Windows file names ignore case.
 */
function docKey(x) {
  try {
    const p = /^file:/i.test(x) ? fileURLToPath(x) : resolve(WORKSPACE, x);
    return normalize(p).replaceAll("/", "\\").toLowerCase();
  } catch {
    return `unparsed:${String(x).toLowerCase()}`;
  }
}
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
  spawnedAt = fileTimeLow();
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
      rootDeadBy ??= fileTimeHigh();
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
      // The bound holds whether or not the block's terminator has arrived.
      if (headerBytes(buf, sep) > MAX_HEADER_BYTES) {
        fail(EXIT.server, `frame header over ${MAX_HEADER_BYTES} bytes`);
      }
      if (sep < 0) return;
      const len = frameLength(buf.subarray(0, sep).toString("latin1"));
      if (typeof len === "string") fail(EXIT.server, `frame header: ${len}`);
      const end = sep + 4 + len;
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
   * Diagnostics for the document docKey `k` after notification index `from`
   * (publishes match by docKey, so any spelling of the uri), ignoring ones that
   * name an older document version. Resolves { note } when the latest
   * publish of version >= minVersion satisfies pred and stays the latest for
   * settleMs. A publish without a version cannot be tied to an edit, so the
   * first one resolves { unversioned } at once: the caller fails the step as
   * not provable, never a pass after settling.
   */
  const waitDiagnostics = (k, minVersion, pred, from, settleMs) =>
    new Promise((res) => {
      let timer = null;
      const publishes = () =>
        notes.slice(from).filter((n) =>
          n.method === "textDocument/publishDiagnostics" &&
          docKey(String(n.params?.uri)) === k
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

/**
 * Opens a workspace-relative file once per docKey (any spelling of the same
 * file is the same document, under the uri of its first opening); a later
 * text is a didChange with the next version.
 */
function docs(c) {
  const open = new Map();
  return (rel, text) => {
    const key = docKey(rel);
    let d = open.get(key);
    if (!d) {
      const p = join(WORKSPACE, rel);
      d = { uri: uri(p), text: text ?? readFileSync(p, "utf8"), version: 1 };
      open.set(key, d);
      c.notify("textDocument/didOpen", {
        textDocument: {
          uri: d.uri,
          languageId: "al",
          version: 1,
          text: d.text,
        },
      });
    } else if (text !== undefined) {
      d.text = text;
      d.version++;
      c.notify("textDocument/didChange", {
        textDocument: { uri: d.uri, version: d.version },
        contentChanges: [{ text }],
      });
    }
    return { key, uri: d.uri, text: d.text, version: d.version };
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
    // Final sweep after the exit: also finds children started since the last
    // snapshot (they still name the dead server or a tracked pid as parent).
    const table = snapshot();
    // Same pid and same creation time: the very process tracked earlier.
    const survivors = [...tracked.values()].filter((t) => isAlive(table, t));
    if (survivors.length > 0) {
      // fail() kills them, each by identity.
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
    // Per document (docKey): the notification mark and version of its last edit.
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
        edits.set(d.key, { mark, version: d.version });
      } else if (s.op === "diagnostics") {
        const has = (n) =>
          n.params.diagnostics.some((x) =>
            String(x.code?.value ?? x.code) === s.code
          );
        const k = doc(s.file).key;
        // A file never edited is gated on its opened version 1, from the start.
        const e = edits.get(k) ?? { mark: 0, version: 1 };
        const w = await c.waitDiagnostics(
          k,
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
