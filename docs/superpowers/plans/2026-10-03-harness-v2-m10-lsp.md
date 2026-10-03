# Harness Bench v2 M10: AL LSP component Implementation Plan (rev 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Shared interfaces:** every cross-plan name, path, record shape, tag and date in this plan is defined in `H:\cg-coord\plans-v2\2026-10-03-harness-v2-interfaces.md` (the appendix). Where this plan and the appendix differ, the appendix wins and this plan is the bug. Rev 3 answers `H:\cg-coord\reviews\PLANS-v2-002\review-m10.md` (REJECT); see "Review responses (round 2)" and "Round 3 changes" at the end.

**Goal:** Give Claude Code arms an optional, fail-closed `lsp` component (`components.lsp: [al]`) that runs the owner's AL language server plugin offline as ContainerUser inside the sandbox, proven first by the S1 spike (spec section 5) and counted in the trace for M11.

**Architecture:** One layer in the claude-code image installs three hash-pinned downloads under `C:\cg-lsp`: the owner's Go wrapper release, the Microsoft AL extension and a private .NET 10 runtime. The image carries a `centralgauge.lsp.al` label whose hash is the repo definition `al-lsp.json`, checked like the al-tools MCP label. All four v2 arms run the one campaign image `2.1.282-r3`, built once after M9 and M10 merge (cross-plan ruling 1). An arm that declares `lsp: [al]` gets `settings.lsp`, `--plugin-dir` and `ENABLE_LSP_TOOL`. M10 plugs into M9's generic inventory (ruling 3; appendix sections 3 and 4). Before the agent starts, M9's `cg-inventory.ps1` runs M10's LSP preflight and reports `lsp:al` in `installed`. After start, M9's `componentInventory` allows the declared plugin (`LSP_PLUGINS.al`, values set here from S1) and runs the ONE positive check (preflight, plugin and LSP tool); M10 adds no second check. The trace records LSP tool calls as `lsp:<operation>`, counts them as `lsp_calls: { total, by_op } | null` (ruling 9) and audits shell access to the LSP files on a best-effort basis.

**Treatment definition (spec 4, review finding 6):** "LSP on" means Claude Code's LSP tool, backed by the AL language server, is enabled for the arm (an integration-enabled treatment, not a claim that off arms cannot reach the server). The files are in every arm's image (same image across the factorial); "LSP off" arms are not prevented from reading or running them through a shell. Shell calls whose recorded command names the LSP install or its binaries are counted (`lsp_shell_calls`, M10-07) and reported per arm; the audit is a regex over recorded commands, so indirect scripts, aliases and renamed or copied executables are not detected. Pre-registered (M11-16 stage A text): the count is exploratory and no cell is excluded or re-run because of it.

**Tech Stack:** Deno 2 / TypeScript (harness), zod, Windows PowerShell 5.1 (run.ps1, inventory, image scripts), Node 22 `node:` built-ins (probe, runs under Deno in tests), Docker Windows containers with Hyper-V isolation, Claude Code 2.1.282 (`--plugin-dir`), al-lsp-for-agents v1.17.0, Microsoft AL Language extension, ASP.NET Core runtime 10.0.

**Spec:** `docs/superpowers/specs/2026-10-03-harness-v2-design.md` on master `2f8d2fca` (read with `git -C U:/Git/CentralGauge show master:docs/superpowers/specs/2026-10-03-harness-v2-design.md`). Sections 4, 5, 6, 8.2, 10, 12, 13. Also: `H:\cg-coord\decisions\2026-10-02-h-01-image-revision.md`, `H:\cg-coord\reviews\PLANS-v2-002\cross-plan-rulings.md` (1 to 10), `H:\cg-coord\decisions\2026-10-03-v2-plans-round3.md`, `H:\cg-coord\decisions\2026-10-03-al-lsp-wrapper-licence.md`, the M9 plan `2026-10-03-harness-v2-m9-realistic.md` (tasks M9-02 to M9-08).

**Dependencies outside M10 (ruling 8, ruling 3):** every code task depends on H-01 merged to master (`image_revision`, ContainerUser, cg-lockdown); code lands on branch `harness/lane-infra-m10-lsp` from master after that merge. M10-06 depends on M9-02 (`cg-inventory.ps1`), M9-03 (run.ps1 inventory call), M9-04 (adapter `componentInventory` with the declared-component plugin/LSP allow-list), M9-05 (`inventoryProblems` make `setup_failed`) and M9-08 (arm configs). M10-01, M10-02, M10-04, M10-05 and M10-07 do not wait for M9.

**Schedule:** start 2026-10-03; S1 report and gate decision by 2026-10-08; dev-image stub proofs green by 2026-10-14; final r3 verified and real cells measured by 2026-10-21 (M10-09 needs the r3 that M9-17 Step 2 builds on 10-18; M8 screening starts 10-25), provided M9-04 and M9-05 merge by 2026-10-12 (otherwise the orchestrator moves the date; M10-06 cannot merge before them).

---

## What the plugin actually is (read 2026-10-03 on this machine)

| Fact | Value and where it was read |
| --- | --- |
| Plugin | `al-language-server-go-windows@claude-code-lsps` 1.17.0, installed at `C:\Users\SShadowS\.claude\plugins\cache\claude-code-lsps\al-language-server-go-windows\1.17.0`, marketplace repo `SShadowS/claude-code-lsps` commit `8fbcf674`; source repo `SShadowS/al-lsp-for-agents` (owner's own code) |
| Claude Code wiring | plugin-root `.lsp.json`: server `al`, `command ${CLAUDE_PLUGIN_ROOT}/bin/al-lsp-wrapper.exe`, `args ["--launcher","claude-code"]`, `extensionToLanguage {.al, .dal}`, `transport stdio`, `maxRestarts 3`. README: `ENABLE_LSP_TOOL=1` turns Claude Code's LSP tool on. Claude Code 2.1.x loads a plugin for one session with `--plugin-dir` |
| Binaries in the plugin | `bin\al-lsp-wrapper.exe` (Go LSP proxy), `bin\al-call-hierarchy.exe` (call hierarchy, code lens, code-quality diagnostics), `bin\alsem.exe` (al-sem CLI, not started by the wrapper) |
| The language server | NOT bundled: the wrapper starts Microsoft's `Microsoft.Dynamics.Nav.EditorServices.Host.exe` from the VS Code AL extension (`wrapper/paths.go`: `--al-extension-path` > `AL_LSP_ALT_EXT_DIR` > `AL_EXTENSION_PATH` > `~/.vscode*/extensions` > marketplace download only with `--auto-download-al-extension`, off by default). Owner's local extension: `ms-dynamics-smb.al-18.0.2732683` |
| Runtime dependency | AL 18 is framework-dependent: the host's `runtimeconfig.json` needs `Microsoft.NETCore.App 10.0.0` and `Microsoft.AspNetCore.App 10.0.0`, found via `DOTNET_ROOT` first (`wrapper/dotnet_runtime.go`). The Go binaries need nothing |
| Extras the wrapper starts | `al-call-hierarchy.exe`; `almcp` (nuget `al` tool or the extension's `bin\almcp.exe`) only for `al/symbolRelations` and `al/inspectPage` |
| Writable paths | wrapper log and pid lock in `os.TempDir()`, preview cache in `os.UserCacheDir()`, AL host cwd = extension dir; the local extension writes `bin\EditorServices.log` and `bin\userid.txt` into its own `bin` |
| Multi-app support | `AL_LSP_SOURCE_ROOTS` (sibling apps from source), ancestor `.alpackages` found automatically, `AL_LSP_PACKAGE_CACHE` for extra symbol folders |
| Subprocess cleanup | the wrapper puts the AL host in a Job Object with kill-on-close (`wrapper/job_windows.go`); whether that covers every subprocess is unproven, so the probe (M10-01) and S1 (M10-02) check the whole process tree |
| LSP operations via Claude Code | goToDefinition, goToImplementation, hover, documentSymbol, findReferences, prepareCallHierarchy, incomingCalls, outgoingCalls, workspaceSymbol |
| Release asset | GitHub release `v1.17.0` (Latest) of `SShadowS/al-lsp-for-agents`: `al-lsp-wrapper-windows-x64.zip` (wrapper + al-call-hierarchy) |
| Licences | wrapper: MIT, usable everywhere (ruling 7). AL extension: Microsoft `LICENSE.txt`, owner-approved for the private image (spec 13) |

The sandbox already gives the server its inputs (H-01 code): `stageRefappTask` writes the seven refapp app folders (`Core`, `Fleet`, `Integration`, `Leasing`, `Rental`, `Reporting`, `Test`), each with `app.json`, into `C:\workspace`, and restores the locked Microsoft symbols into `C:\workspace\.alpackages`. `C:\task` holds only `prompt.md`, attachments and `task.json`. No staging change is needed; S1 proves the server reads them and audits that nothing else is reachable.

## Global Constraints

- The agent, the probe and the language server run as `ContainerUser`; nothing in M10 adds an admin step at run time.
- Image tags (ruling 1, appendix section 1): one campaign tag `centralgauge/harness-claude-code:2.1.282-r3`, built once after M9 and M10 merge (M9-17 Step 2). Spike and proof images use `centralgauge/harness-claude-code:2.1.282-r3-dev-<task id>` (revision `3-dev-<task id>`, M9-16 `IMAGE_REVISION`); probe configs may name a dev revision, no experiment may (`loadExperiment` refuses it). Frozen tags (`2.1.282`, `-r2`, and `-r3` once built) are never rebuilt or retagged; every build recipe starts with `if DOCKER_CONTEXT=desktop-windows docker image inspect <tag> >/dev/null 2>&1; then echo "[FAIL] <tag> exists"; exit 1; fi`.
- One image for all four arms; arms differ only by declared components.
- Offline: the server must work with no network (`--network none`); LSP processes get `HTTPS_PROXY=""`, `HTTP_PROXY=""`; no marketplace download flag; no non-loopback connection owned by an LSP process.
- The server indexes only `C:\workspace` (incl. `.alpackages`) and its own install; S1 proves the boundary with a canary outside the workspace, and audits that no oracle byte is in the container.
- Fail closed: a declared LSP that does not pass preflight and init checks is `setup_failed`; any LSP plugin, LSP tool or `ENABLE_LSP_TOOL` in an arm that did not declare it is `setup_failed`.
- Missing telemetry stays missing, never zero (spec 6). Passive post-edit diagnostics are reported separately, never folded into tool calls or reported as zero.
- Parser version (ruling 2, appendix section 2): bumped once to `claude-code-trace@5` by the first of M9-04 / M10-07 to merge (M11-03 is withdrawn); the later one does not change it.
- PowerShell commands passed from bash are single-quoted (or run with `-File`), so bash never expands `$LASTEXITCODE` or `$_`; every subprocess the probe starts has a deadline; the probe kills only processes whose PID and creation time it recorded.
- Shell-form `RUN` lines contain no double quote (H-01 run 004).
- run.ps1, the inventory and image scripts are Windows PowerShell 5.1: UTF-8 named on every read; stdout of run.ps1 is the `cg_inventory` line then stream-json; diagnostics to stderr.
- Every command whose exit status is evidence preserves it (no trailing command that masks `$LASTEXITCODE`).
- Console output `[OK]` / `[FAIL]` tags, no emoji. No em dash in any file.
- Tests: `deno test --allow-all <files>`; never `tests/unit/container` while a bench is live; no `--parallel`. After code: `deno check`, `deno lint`, `deno fmt` on changed files only, then `graphify update .`.
- Container commands from lane-ops prefix `DOCKER_CONTEXT=desktop-windows`. Kill only a PID you started; never kill by image name.

## Review Focus

1. A non-LSP arm that can still see the LSP (leftover plugin, inherited `ENABLE_LSP_TOOL`, a tool named `LSP`) must fail setup. Tests: M10-06 inventory env test, M9's allow-list tests extended in M10-06, M10-06 execution test case "plain arm with plugin".
2. The server or a sidecar outlives the probe (ignores `exit`, orphaned grandchild). Expected: the probe kills the whole tree and exits 3. Tests: M10-01 `FAKE_IGNORE_EXIT` and `FAKE_ORPHAN` cases.
3. Delayed or out-of-order diagnostics satisfy a check they should not. Expected: version-correlated matching; an unversioned publish after an edit fails the step (6), never a pass. Tests: M10-01 `FAKE_STALE` and `FAKE_STALE` + `FAKE_NOVERSION`.
4. The LSP operation name is model input stored in the trace. Expected: `[A-Za-z]{1,40}` or `lsp:invalid`. Test: M10-07.
5. A config sneaks the LSP in through `settings.lsp`. Expected: refused at config resolution. Test: M10-06 reserved-key test.

---

## File Structure

| File | Task | Responsibility |
| --- | --- | --- |
| `harness/images/claude-code/lsp/lsp-probe.mjs` (create) | M10-01 | LSP client: `--preflight` (inventory) and `--script` (S1) with assertions and tree cleanup |
| `tests/fixtures/harness/lsp/fake-al-ls.mjs` (create) | M10-01 | Scripted fake server (hang, die, ignore exit, orphan, stale diagnostics) |
| `tests/unit/harness/lsp-probe.test.ts` (create) | M10-01 | Probe tests and stub scenario check |
| `scripts/harness/stub-scenarios/arm-lsp.json` (create) | M10-01 | Credential-free scenario driving LSP calls through real Claude Code |
| `H:\Temp3\harness-spike\M10-S1\**` (scratch) | M10-02 | Spike context, `s1-run.ps1`, step file, results |
| `harness/images/claude-code/lsp/al-lsp.json` (create) | M10-04 | Definition: pins, lineage, diagnostics policy, plugin.json, .lsp.json; its hashJson is the image label |
| `harness/images/claude-code/lsp/install-lsp.ps1` (create) | M10-04 | Image step: download, hash-check, gunzip if needed, unpack, per-file checks, plugin files |
| `harness/images/claude-code/Dockerfile.windows` (modify, after M9-03) | M10-04 | LSP layer next to M9's `cg-inventory.ps1`, all locked |
| `src/harness/images.ts` (modify) | M10-05 | LSP label, facts, shipped-file check, definitions, runtimeFacts |
| `cli/commands/harness-command.ts`, `src/harness/campaign.ts` (modify) | M10-05 | Build adds the label; callers use `serverDefinitions`; a stub cell's `--image` is what runtimeFacts reads |
| `harness/images/claude-code/cg-inventory.ps1` (modify, M9 file) | M10-06 | LSP preflight and env check inside M9's inventory (ruling 3 hook) |
| `harness/images/claude-code/run.ps1` (modify, after M9-03) | M10-06 | `--plugin-dir`, `ENABLE_LSP_TOOL` set or cleared |
| `src/harness/adapters/claude-code.ts` (modify, after M9-04) | M10-06, M10-07 | `settings.lsp`; the values of M9's `LSP_PLUGINS.al` from S1 (the positive check stays M9-04's); parser per ruling 2 |
| `harness/configs/cc-v2-plain-lsp.yml`, `cc-v2-realistic-lsp.yml` + their M9-08 test (modify, M9 files) | M10-06 | Slug `al-lsp` to `al`, only if M9 merged `al-lsp` |
| `src/harness/adapters/claude-trace.ts`, `src/harness/trace.ts`, `src/harness/trace-metrics.ts` (modify) | M10-07 | `lsp:<operation>`, `lsp_calls: { total, by_op } \| null`, `lsp_shell_calls: number \| null`, capability `lsp_call` |

## Task overview

| Id | Lane | Dates | Deps | One line |
| --- | --- | --- | --- | --- |
| M10-01 | lane-infra | 10-03 to 10-05 | none | probe with assertions, version-correlated diagnostics, tree cleanup; fake server; stub scenario |
| M10-02 | lane-ops | 10-04 to 10-08 | M10-01 (Step 4 on), r2 image on host | S1 spike on dev tag `r3-dev-M10-02`: all spec-5 checks with acceptance bounds, pins, captures |
| M10-03 | orchestrator | 10-08 | M10-02 | S1 gate; fixes need an S1 rerun; owner question on blockers |
| M10-04 | lane-infra | 10-09 to 10-10 | M10-03 PASS, M9-03 merged | al-lsp.json, install-lsp.ps1, Dockerfile layer |
| M10-05 | lane-infra | 10-10 to 10-11 | M10-04 | images.ts LSP facts and runtimeFacts; build label; stub `--image` facts |
| M10-06 | lane-infra | 10-11 to 10-13 | M10-05, M9-02/03/04/05/08, S1 captures | inventory hook (preflight, env), run.ps1, `LSP_PLUGINS.al` values, slug, combined execution test |
| M10-07 | lane-infra | 10-09 to 10-11 | S1 captures | trace `lsp:<operation>`, `lsp_calls: { total, by_op } \| null`, `lsp_shell_calls`, passive diagnostics count |
| M10-08 | lane-ops | 10-14 | M10-04 to M10-07, M9-02 to M9-05, M9-08 and M9-16 merged | dev integration image `r3-dev-M10-08`; stub proofs (on, off, refusals) |
| M10-09 | lane-ops | 10-19 to 10-21 | M10-08, M9-17 Step 2 (r3 built 10-18) | verify the final r3 for LSP; two real cells with startup and RAM |

lane-admin: not needed. Hyper-V containers, `docker stats`, `docker inspect` and in-container CIM/NetTCPIP queries run from the non-elevated lane-ops shell, and nothing touches HNS, the firewall or the proxy. If S1 needs a host-side look for a leftover utility VM (`hcsdiag list`, elevated), lane-ops records the gap and the orchestrator asks whether lane-admin runs that one read-only command.

---

### Task M10-01: LSP probe, fake server, stub scenario

**Lane:** lane-infra. **Deps:** none. **May touch:** the four files below only.

**Files:**
- Create: `harness/images/claude-code/lsp/lsp-probe.mjs`
- Create: `tests/fixtures/harness/lsp/fake-al-ls.mjs`
- Create: `scripts/harness/stub-scenarios/arm-lsp.json`
- Test: `tests/unit/harness/lsp-probe.test.ts`

**Interfaces:**
- Produces: `node C:\cg-lsp\lsp-probe.mjs --preflight` (exit 0 ok, 2 timeout, 3 server/protocol/cleanup failure, 4 configuration; stderr only) and `--script <steps.json>` (stdout one JSON object `{ total_ms, ok, steps: [{ op, ms, ok, why, result }] }`; exit 6 when any `expect` fails). Env: `CG_LSP_PLUGIN` (default `C:\cg-lsp\al-language-server-go-windows`), `CG_LSP_WORKSPACE` (default `C:\workspace`), `CG_LSP_TIMEOUT_MS` (180000), `CG_LSP_SHUTDOWN_MS` (10000). Step ops: `symbols`, `hover`, `references`, `wsymbols` (with `expect`), `edit` (`find`/`replace`), `diagnostics` (`code`, `present`, optional `settleMs`), `hold` (`ms`). Positions are 0-based.
- Cleanup contract: on every exit path the probe kills the server's whole process tree (CIM process table, `taskkill /T /F` per PID); after a clean shutdown it waits up to `CG_LSP_SHUTDOWN_MS` for the server to exit and fails (3) if it does not, or if any process that was in the server's tree before shutdown is still alive.

- [ ] **Step 1: Write the fake language server**

`tests/fixtures/harness/lsp/fake-al-ls.mjs`:

```js
// Fake AL language server for lsp-probe tests (M10-01). Content-Length framed
// JSON-RPC on stdio. Modes (env): FAKE_EMPTY no document symbols; FAKE_HANG
// never answers; FAKE_DIE exits on initialize; FAKE_IGNORE_EXIT ignores the
// exit notification; FAKE_ORPHAN starts a detached grandchild whose command
// line carries FAKE_ORPHAN's value; FAKE_STALE publishes the previous
// version's diagnostics 300 ms after the current ones; FAKE_NOVERSION omits
// the version on every publish. Hover reports the proxy env and argv[2].
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import process from "node:process";

const env = (k) => process.env[k] ?? "";
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
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
    }]
    : [];
const publish = (uri, version, text) =>
  send({
    jsonrpc: "2.0",
    method: "textDocument/publishDiagnostics",
    params: {
      uri,
      ...(env("FAKE_NOVERSION") ? {} : { version }),
      diagnostics: diagnostics(text),
    },
  });
function changed(uri, version, text) {
  const prev = docs.get(uri);
  docs.set(uri, { version, text });
  publish(uri, version, text);
  if (env("FAKE_STALE") && prev) {
    setTimeout(() => publish(uri, prev.version, prev.text), 300);
  }
}

function handle(m) {
  if (env("FAKE_HANG")) return;
  const reply = (result) => send({ jsonrpc: "2.0", id: m.id, result });
  switch (m.method) {
    case "initialize":
      if (env("FAKE_DIE")) process.exit(7);
      if (env("FAKE_ORPHAN")) {
        spawn("powershell", [
          "-NoProfile",
          "-Command",
          `Start-Sleep 120 # ${env("FAKE_ORPHAN")}`,
        ], { detached: true, stdio: "ignore", windowsHide: true }).unref();
      }
      return reply({ capabilities: { hoverProvider: true, referencesProvider: true, documentSymbolProvider: true, workspaceSymbolProvider: true } });
    case "textDocument/documentSymbol":
      return reply(
        env("FAKE_EMPTY") ? [] : [{
          name: "CGR Lease Math",
          kind: 5,
          children: [{ name: "RateFactor", kind: 6 }],
        }],
      );
    case "textDocument/hover":
      return reply({
        contents: {
          kind: "plaintext",
          value: `proxy=[${process.env.HTTPS_PROXY ?? "unset"}] root=[${process.argv[2] ?? ""}]`,
        },
      });
    case "textDocument/references":
      return reply([{
        uri: m.params.textDocument.uri,
        range: { start: { line: 2, character: 23 }, end: { line: 2, character: 33 } },
      }]);
    case "workspace/symbol":
      return reply(m.params.query === "CG Canary" ? [] : [{ name: m.params.query, kind: 5 }]);
    case "textDocument/didOpen":
      return changed(m.params.textDocument.uri, m.params.textDocument.version, m.params.textDocument.text);
    case "textDocument/didChange":
      return changed(m.params.textDocument.uri, m.params.textDocument.version, m.params.contentChanges[0].text);
    case "shutdown":
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
    const len = Number(/Content-Length: *(\d+)/i.exec(buf.subarray(0, sep).toString("ascii"))[1]);
    if (buf.length < sep + 4 + len) return;
    const m = JSON.parse(buf.subarray(sep + 4, sep + 4 + len).toString("utf8"));
    buf = buf.subarray(sep + 4 + len);
    handle(m);
  }
});
if (env("FAKE_HANG") || env("FAKE_IGNORE_EXIT")) setInterval(() => {}, 1000);
```

- [ ] **Step 2: Write the failing tests**

`tests/unit/harness/lsp-probe.test.ts`:

```ts
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join, resolve } from "@std/path";
import { checkScenario } from "../../../scripts/harness/stub-anthropic.mjs";

const PROBE = resolve("harness/images/claude-code/lsp/lsp-probe.mjs");
const FAKE = resolve("tests/fixtures/harness/lsp/fake-al-ls.mjs");
const ROOT_VAR = "$" + "{CLAUDE_PLUGIN_ROOT}";
const FILE = "Core\\src\\LeaseMath.Codeunit.al";
const LINE = "exit(1 + Months / 100);";
const WINDOWS = Deno.build.os === "windows";

async function setup(withApp = true) {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  const plugin = join(dir, "plugin");
  const ws = join(dir, "workspace");
  await Deno.mkdir(plugin, { recursive: true });
  await Deno.mkdir(join(ws, "Core", "src"), { recursive: true });
  if (withApp) await Deno.writeTextFile(join(ws, "Core", "app.json"), "{}");
  await Deno.writeTextFile(
    join(ws, ...FILE.split("\\")),
    'codeunit 70002 "CGR Lease Math"\n{\n    internal procedure RateFactor(Months: Integer): Decimal\n    begin\n        exit(1 + Months / 100);\n    end;\n}\n',
  );
  await Deno.writeTextFile(
    join(plugin, ".lsp.json"),
    JSON.stringify({
      al: {
        command: Deno.execPath(),
        args: ["run", "-A", FAKE, ROOT_VAR],
        transport: "stdio",
        env: { HTTPS_PROXY: "" },
      },
    }),
  );
  return { dir, plugin, ws };
}

async function probe(
  s: { plugin: string; ws: string },
  args: string[],
  env: Record<string, string> = {},
) {
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", PROBE, ...args],
    env: {
      CG_LSP_PLUGIN: s.plugin,
      CG_LSP_WORKSPACE: s.ws,
      CG_LSP_SHUTDOWN_MS: "1500",
      HTTPS_PROXY: "http://proxy.invalid:3128",
      ...env,
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const t = new TextDecoder();
  return { code: out.code, stdout: t.decode(out.stdout), stderr: t.decode(out.stderr) };
}

async function steps(s: { dir: string }, list: unknown[]) {
  const p = join(s.dir, `steps-${crypto.randomUUID()}.json`);
  await Deno.writeTextFile(p, JSON.stringify(list));
  return p;
}

const EDIT_CYCLE = [
  { op: "edit", file: FILE, find: LINE, replace: `Foo := 1; ${LINE}` },
  { op: "diagnostics", file: FILE, code: "AL0118", present: true, settleMs: 600 },
  { op: "edit", file: FILE, find: `Foo := 1; ${LINE}`, replace: LINE },
  { op: "diagnostics", file: FILE, code: "AL0118", present: false, settleMs: 600 },
];

/** Live processes whose command line contains marker (CIM), excluding this inspector itself. */
async function withMarker(marker: string): Promise<number> {
  const out = await new Deno.Command("powershell", {
    args: ["-NoProfile", "-Command", `@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*${marker}*' -and $_.Name -eq 'powershell.exe' }).Count`],
    stdout: "piped",
  }).output();
  return Number(new TextDecoder().decode(out.stdout).trim());
}

Deno.test({ name: "lsp-probe preflight: documentSymbol answered; stderr only; clean exit", ignore: !WINDOWS, async fn() {
  const r = await probe(await setup(), ["--preflight"]);
  assertEquals([r.code, r.stdout], [0, ""], r.stderr);
  assertStringIncludes(r.stderr, "[OK] lsp-probe preflight: 2 symbols");
} });

Deno.test({ name: "lsp-probe preflight: no symbols or an early death is a server failure (3)", ignore: !WINDOWS, async fn() {
  const s = await setup();
  const empty = await probe(s, ["--preflight"], { FAKE_EMPTY: "1" });
  assertEquals(empty.code, 3);
  assertStringIncludes(empty.stderr, "returned no symbols");
  assertEquals((await probe(s, ["--preflight"], { FAKE_DIE: "1" })).code, 3);
} });

Deno.test({ name: "lsp-probe preflight: a hanging server is a timeout (2) near the bound", ignore: !WINDOWS, async fn() {
  const t0 = Date.now();
  const r = await probe(await setup(), ["--preflight"], { FAKE_HANG: "1", CG_LSP_TIMEOUT_MS: "1500" });
  assertEquals(r.code, 2);
  assert(Date.now() - t0 < 20_000);
} });

Deno.test({ name: "lsp-probe: a server that ignores exit is killed and fails cleanup (3)", ignore: !WINDOWS, async fn() {
  const r = await probe(await setup(), ["--preflight"], { FAKE_IGNORE_EXIT: "1" });
  assertEquals(r.code, 3);
  assertStringIncludes(r.stderr, "did not exit");
} });

Deno.test({ name: "lsp-probe: an orphaned grandchild that survives shutdown fails cleanup (3) and is killed", ignore: !WINDOWS, async fn() {
  const marker = `cg-m10-orphan-${crypto.randomUUID()}`;
  const r = await probe(await setup(), ["--preflight"], { FAKE_ORPHAN: marker });
  assertEquals(r.code, 3, r.stderr);
  assertStringIncludes(r.stderr, "survived shutdown");
  assertEquals(await withMarker(marker), 0, "the probe killed the survivor");
} });

Deno.test({ name: "lsp-probe: missing .lsp.json or no app.json is a configuration error (4)", ignore: !WINDOWS, async fn() {
  assertEquals((await probe(await setup(false), ["--preflight"])).code, 4);
  const s = await setup();
  await Deno.remove(join(s.plugin, ".lsp.json"));
  assertEquals((await probe(s, ["--preflight"])).code, 4);
} });

Deno.test({ name: "lsp-probe script: expectations pass; .lsp.json env wins; plugin root substituted; diagnostics follow edits", ignore: !WINDOWS, async fn() {
  const s = await setup();
  const r = await probe(s, ["--script", await steps(s, [
    { op: "symbols", file: FILE, expect: { names: ["CGR Lease Math", "RateFactor"] } },
    { op: "hover", file: FILE, line: 2, character: 23, expect: { contains: ["proxy=[]", `root=[${s.plugin}]`] } },
    { op: "references", file: FILE, line: 2, character: 23, expect: { locations: ["Core/src/LeaseMath.Codeunit.al:3"] } },
    { op: "wsymbols", query: "CG Canary", expect: { none: true } },
    ...EDIT_CYCLE,
  ])]);
  assertEquals(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assertEquals(out.ok, true);
  assertEquals(out.steps[5].result[0].code, "AL0118");
  assertEquals(out.steps[7].result, []);
} });

Deno.test({ name: "lsp-probe script: a wrong answer is an assertion failure (6), reported per step", ignore: !WINDOWS, async fn() {
  const s = await setup();
  const r = await probe(s, ["--script", await steps(s, [
    { op: "symbols", file: FILE, expect: { names: ["LeaseTotal"] } },
    { op: "references", file: FILE, line: 2, character: 23, expect: { locations: ["Leasing/src/LeaseMgt.Codeunit.al:11"] } },
    { op: "hover", file: FILE, line: 2, character: 23, expect: { contains: ["Library Assert"] } },
  ])]);
  assertEquals(r.code, 6);
  const out = JSON.parse(r.stdout);
  assertEquals(out.steps.map((x: { ok: boolean }) => x.ok), [false, false, false]);
  assertStringIncludes(out.steps[0].why, "LeaseTotal");
} });

Deno.test({ name: "lsp-probe script: stale diagnostics of an older version are ignored", ignore: !WINDOWS, async fn() {
  const s = await setup();
  const r = await probe(s, ["--script", await steps(s, EDIT_CYCLE)], { FAKE_STALE: "1" });
  assertEquals(r.code, 0, r.stderr);
} });

Deno.test({ name: "lsp-probe script: unversioned diagnostics after an edit cannot be correlated: assertion failure (6), never a pass", ignore: !WINDOWS, async fn() {
  const s = await setup();
  const r = await probe(s, ["--script", await steps(s, EDIT_CYCLE)], {
    FAKE_STALE: "1",
    FAKE_NOVERSION: "1",
    CG_LSP_TIMEOUT_MS: "5000",
  });
  assertEquals(r.code, 6);
  assertStringIncludes(r.stdout, "unversioned diagnostics after an edit");
} });

Deno.test("arm-lsp stub scenario: valid for the stub and drives the S1 LSP operations", async () => {
  const s = JSON.parse(await Deno.readTextFile("scripts/harness/stub-scenarios/arm-lsp.json"));
  checkScenario(s);
  const ops = s.steps.flatMap((st: { content: { name?: string; input?: { operation?: string } }[] }) => st.content)
    .filter((b: { name?: string }) => b.name === "LSP")
    .map((b: { input?: { operation?: string } }) => b.input?.operation);
  assertEquals(ops, ["documentSymbol", "hover", "findReferences"]);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `deno test --allow-all tests/unit/harness/lsp-probe.test.ts`
Expected: FAIL, `lsp-probe.mjs` and `arm-lsp.json` not found.

- [ ] **Step 4: Write the probe**

`harness/images/claude-code/lsp/lsp-probe.mjs`:

```js
// AL LSP probe (M10): a minimal LSP client for the shipped AL language server
// plugin. It starts exactly what Claude Code starts: command, args and env
// come from the plugin's .lsp.json (env wins over the inherited environment).
//   --preflight        initialize, open one .al file of the first app,
//                      documentSymbol, shutdown. stderr only, so the
//                      inventory's single stdout line stays intact.
//   --script <steps>   run S1 steps with expectations; one JSON object on stdout.
// Every exit path kills the server's whole process tree; a clean shutdown must
// end the tree within CG_LSP_SHUTDOWN_MS.
// Exit: 0 ok, 2 timeout, 3 server/protocol/cleanup, 4 configuration, 6 assertion.
// node: built-ins only (Node in the image, Deno in the unit tests).
import { Buffer } from "node:buffer";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const PLUGIN = process.env.CG_LSP_PLUGIN ?? "C:\\cg-lsp\\al-language-server-go-windows";
const WORKSPACE = process.env.CG_LSP_WORKSPACE ?? "C:\\workspace";
const TIMEOUT_MS = Number(process.env.CG_LSP_TIMEOUT_MS ?? "180000");
const SHUTDOWN_MS = Number(process.env.CG_LSP_SHUTDOWN_MS ?? "10000");
const ROOT_VAR = "$" + "{CLAUDE_PLUGIN_ROOT}";
const EXIT = { ok: 0, timeout: 2, server: 3, config: 4, assertion: 6 };
/** Deadline of every CIM or kill subprocess, so cleanup can never outlive TIMEOUT_MS by much. */
const CIM_MS = Number(process.env.CG_LSP_CIM_MS ?? "15000");
let child = null;

/**
 * Every process as pid, parent pid, creation time (FILETIME, UTC) and image
 * name (CIM sees orphans too). pid + created is the process identity.
 */
function processTable() {
  const out = execFileSync("powershell", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Get-CimInstance Win32_Process | ForEach-Object { [string]$_.ProcessId + ' ' + [string]$_.ParentProcessId + ' ' + $(if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 }) + ' ' + $_.Name }",
  ], { encoding: "utf8", windowsHide: true, timeout: CIM_MS });
  return out.split(/\r?\n/).filter((l) => l.trim()).map((l) => {
    const [pid, ppid, created, ...name] = l.trim().split(" ");
    return { pid: Number(pid), ppid: Number(ppid), created, name: name.join(" ") };
  });
}

function descendants(table, root) {
  const found = [];
  const queue = [root];
  while (queue.length > 0) {
    const p = queue.shift();
    for (const r of table) {
      if (r.ppid === p && r.pid !== root && !found.some((f) => f.pid === r.pid)) {
        found.push(r);
        queue.push(r.pid);
      }
    }
  }
  return found;
}

/**
 * Kills exactly the recorded process: the CIM row for its pid must still have
 * the recorded creation time, so a reused PID is never killed. Bounded by CIM_MS.
 */
function killProc(p) {
  try {
    execFileSync("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(p.pid)}'; if ($p -and $p.CreationDate -and $p.CreationDate.ToFileTimeUtc() -eq [Int64]'${String(p.created).replace(/[^0-9]/g, "")}') { Stop-Process -Id ${Number(p.pid)} -Force }`,
    ], { stdio: "ignore", windowsHide: true, timeout: CIM_MS });
  } catch { /* gone, or the bounded call timed out: callers re-check survivors */ }
}

function killTree() {
  if (!child?.pid) return;
  try {
    const table = processTable();
    const root = table.find((r) => r.pid === child.pid);
    for (const p of [...descendants(table, child.pid), ...(root ? [root] : [])]) killProc(p);
  } catch {
    // No table within CIM_MS: kill the root through its own handle (never by a bare PID).
    child.kill("SIGKILL");
  }
}

function fail(code, msg) {
  process.stderr.write(`[FAIL] lsp-probe: ${msg}\n`);
  killTree();
  process.exit(code);
}

function serverSpec() {
  const file = join(PLUGIN, ".lsp.json");
  let al;
  try {
    al = JSON.parse(readFileSync(file, "utf8")).al;
  } catch (e) {
    fail(EXIT.config, `${file}: ${e.message}`);
  }
  if (!al || typeof al.command !== "string") fail(EXIT.config, `${file} has no al.command`);
  const sub = (s) => String(s).replaceAll(ROOT_VAR, PLUGIN);
  return { command: sub(al.command), args: (al.args ?? []).map(sub), env: { ...process.env, ...(al.env ?? {}) } };
}

const uri = (p) => pathToFileURL(p).href;
const sameUri = (a, b) => decodeURIComponent(a).toLowerCase() === decodeURIComponent(b).toLowerCase();
const appDirs = () =>
  readdirSync(WORKSPACE, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(WORKSPACE, e.name, "app.json")))
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
  child = spawn(spec.command, spec.args, { env: spec.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  child.on("error", (e) => fail(EXIT.server, `cannot start ${spec.command}: ${e.message}`));
  child.stderr.resume();
  const exited = new Promise((res) => child.once("exit", () => res(true)));
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
      const m = /Content-Length: *(\d+)/i.exec(buf.subarray(0, sep).toString("ascii"));
      if (!m) fail(EXIT.server, "frame without Content-Length");
      const end = sep + 4 + Number(m[1]);
      if (buf.length < end) return;
      const msg = JSON.parse(buf.subarray(sep + 4, end).toString("utf8"));
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
          result: msg.method === "workspace/configuration" && Array.isArray(items) ? items.map(() => null) : null,
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
      pending.set(id, (m) => m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result));
      send({ jsonrpc: "2.0", id, method, params });
    });
  const notify = (method, params) => send({ jsonrpc: "2.0", method, params });
  /**
   * Diagnostics for u after notification index `from`, ignoring publishes that
   * name an older document version. Resolves when the latest such publish
   * satisfies pred and stays the latest for settleMs. After an edit
   * (minVersion > 1) a publish WITHOUT a version cannot be correlated with the
   * edit: it resolves `{ unversioned: true }` and the step fails (6). Settling
   * alone is never treated as correlation (round 2 finding 4).
   */
  const waitDiagnostics = (u, minVersion, pred, from, settleMs) =>
    new Promise((res) => {
      let timer = null;
      const latest = () =>
        notes.slice(from).reverse().find((n) =>
          n.method === "textDocument/publishDiagnostics" && sameUri(n.params.uri, u) &&
          (typeof n.params.version !== "number" || n.params.version >= minVersion)
        );
      const check = () => {
        const n = latest();
        clearTimeout(timer);
        if (n && minVersion > 1 && typeof n.params.version !== "number") {
          waiters.delete(check);
          res({ unversioned: true });
          return;
        }
        if (n && pred(n)) {
          timer = setTimeout(() => {
            if (latest() === n) {
              waiters.delete(check);
              res(n);
            }
          }, settleMs);
        }
      };
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
      c.notify("textDocument/didOpen", { textDocument: { uri: uri(p), languageId: "al", version: 1, text: t } });
    } else if (text !== undefined) {
      d.text = text;
      d.version++;
      c.notify("textDocument/didChange", { textDocument: { uri: uri(p), version: d.version }, contentChanges: [{ text }] });
    }
    const cur = open.get(p);
    return { uri: uri(p), text: cur.text, version: cur.version };
  };
}

async function session(fn) {
  const c = connect(serverSpec());
  let done = false;
  child.on("exit", (code) => {
    if (!done) fail(EXIT.server, `server exited before shutdown (exit ${code})`);
  });
  const timer = setTimeout(() => fail(EXIT.timeout, `no result within ${TIMEOUT_MS} ms`), TIMEOUT_MS);
  try {
    const apps = appDirs();
    if (apps.length === 0) fail(EXIT.config, `no app.json under ${WORKSPACE}`);
    const t0 = Date.now();
    await c.request("initialize", {
      processId: process.pid,
      rootUri: uri(WORKSPACE),
      workspaceFolders: apps.map((a) => ({ uri: uri(join(WORKSPACE, a)), name: a })),
      capabilities: {
        textDocument: { hover: { contentFormat: ["markdown", "plaintext"] }, publishDiagnostics: { versionSupport: true } },
        workspace: { workspaceFolders: true, configuration: true },
      },
    });
    c.notify("initialized", {});
    const out = await fn(c, apps, t0);
    // Cleanup is part of qualification: the tree as it stands now must be gone after exit.
    const before = descendants(processTable(), child.pid);
    done = true;
    await c.request("shutdown", null);
    c.notify("exit", null);
    const gone = await Promise.race([c.exited, new Promise((r) => setTimeout(() => r(false), SHUTDOWN_MS))]);
    if (!gone) fail(EXIT.server, `server did not exit within ${SHUTDOWN_MS} ms of exit`);
    const table = processTable();
    const survivors = before.filter((b) => table.some((r) => r.pid === b.pid && r.created === b.created && r.name === b.name));
    if (survivors.length > 0) {
      for (const s of survivors) killProc(s);
      fail(EXIT.server, `${survivors.length} subprocess(es) survived shutdown: ${survivors.map((s) => s.name).join(", ")}`);
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
const symbolNames = (xs) => (xs ?? []).flatMap((s) => [s.name, ...symbolNames(s.children)]);
const location = (l) => `${relative(WORKSPACE, fileURLToPath(l.uri)).replaceAll("\\", "/")}:${l.range.start.line + 1}`;

/** null when the step's expectation holds (or it has none), else why not. */
function verdict(s, result) {
  const e = s.expect;
  if (!e) return null;
  if (s.op === "symbols") {
    const got = symbolNames(result);
    const miss = e.names.filter((n) => !got.includes(n));
    return miss.length ? `missing symbols ${miss.join(", ")} (got ${got.join(", ")})` : null;
  }
  if (s.op === "hover") {
    const t = hoverText(result);
    const miss = e.contains.filter((x) => !t.includes(x));
    return miss.length ? `hover lacks ${miss.join(", ")}: ${t.slice(0, 300)}` : null;
  }
  if (s.op === "references") {
    const got = [...new Set((result ?? []).map(location))].sort();
    const want = [...e.locations].sort();
    return JSON.stringify(got) === JSON.stringify(want) ? null : `references ${JSON.stringify(got)} != ${JSON.stringify(want)}`;
  }
  if (s.op === "wsymbols") {
    const got = (result ?? []).map((x) => x.name);
    if (e.none) return got.length ? `expected no symbols, got ${got.join(", ")}` : null;
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
    const syms = await c.request("textDocument/documentSymbol", { textDocument: { uri: d.uri } });
    if (!Array.isArray(syms) || syms.length === 0) fail(EXIT.server, `documentSymbol on ${file} returned no symbols`);
    return { ms: Date.now() - t0, symbols: symbolNames(syms).length };
  });
  process.stderr.write(`[OK] lsp-probe preflight: ${r.symbols} symbols in ${r.ms} ms\n`);
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
    let mark = 0;
    let minVersion = 0;
    for (const [i, s] of steps.entries()) {
      process.stderr.write(`[step ${i}] ${s.op}\n`);
      const t = Date.now();
      const position = { line: s.line, character: s.character };
      let result = null;
      let forced = null;
      if (s.op === "symbols") {
        result = await c.request("textDocument/documentSymbol", { textDocument: { uri: doc(s.file).uri } });
      } else if (s.op === "hover") {
        result = await c.request("textDocument/hover", { textDocument: { uri: doc(s.file).uri }, position });
      } else if (s.op === "references") {
        result = await c.request("textDocument/references", { textDocument: { uri: doc(s.file).uri }, position, context: { includeDeclaration: true } });
      } else if (s.op === "wsymbols") {
        result = await c.request("workspace/symbol", { query: s.query });
      } else if (s.op === "edit") {
        const cur = doc(s.file).text;
        if (!cur.includes(s.find)) fail(EXIT.config, `edit: ${s.file} does not contain ${s.find}`);
        mark = c.mark();
        minVersion = doc(s.file, cur.replace(s.find, s.replace)).version;
      } else if (s.op === "diagnostics") {
        const has = (n) => n.params.diagnostics.some((x) => String(x.code?.value ?? x.code) === s.code);
        const w = await c.waitDiagnostics(doc(s.file).uri, minVersion, (n) => has(n) === s.present, mark, s.settleMs ?? 2000);
        if (w.unversioned) forced = "unversioned diagnostics after an edit: correlation impossible";
        else result = w.params.diagnostics;
      } else if (s.op === "hold") {
        await new Promise((res) => setTimeout(res, s.ms));
      } else fail(EXIT.config, `unknown step op ${s.op}`);
      const why = forced ?? verdict(s, result);
      out.push({ op: s.op, ms: Date.now() - t, ok: why === null, why, result });
    }
    return { total_ms: Date.now() - t0, ok: out.every((x) => x.ok), steps: out };
  });
  process.stdout.write(JSON.stringify(r) + "\n");
  process.exit(r.ok ? EXIT.ok : EXIT.assertion);
} else fail(EXIT.config, "usage: lsp-probe.mjs --preflight | --script <steps.json>");
```

- [ ] **Step 5: Write the stub scenario**

`scripts/harness/stub-scenarios/arm-lsp.json` (Claude Code LSP tool positions written 1-based; M10-02 confirms from the tool schema and fixes this file if they are 0-based):

```json
{
  "steps": [
    { "content": [{ "type": "tool_use", "id": "toolu_stub_lsp_01", "name": "ToolSearch", "input": { "query": "select:LSP", "max_results": 1 } }], "stop_reason": "tool_use" },
    { "content": [{ "type": "tool_use", "id": "toolu_stub_lsp_02", "name": "LSP", "input": { "operation": "documentSymbol", "filePath": "C:\\workspace\\Core\\src\\LeaseMath.Codeunit.al", "line": 1, "character": 1 } }], "stop_reason": "tool_use" },
    { "content": [{ "type": "tool_use", "id": "toolu_stub_lsp_03", "name": "LSP", "input": { "operation": "hover", "filePath": "C:\\workspace\\Test\\src\\LeasingTests.Codeunit.al", "line": 7, "character": 27 } }], "stop_reason": "tool_use" },
    { "content": [{ "type": "tool_use", "id": "toolu_stub_lsp_04", "name": "LSP", "input": { "operation": "findReferences", "filePath": "C:\\workspace\\Core\\src\\LeaseMath.Codeunit.al", "line": 3, "character": 24 } }], "stop_reason": "tool_use" },
    { "content": [{ "type": "tool_use", "id": "toolu_stub_lsp_05", "name": "Read", "input": { "file_path": "C:\\workspace\\Leasing\\src\\LeaseMgt.Codeunit.al" } }], "stop_reason": "tool_use" },
    { "content": [{ "type": "tool_use", "id": "toolu_stub_lsp_06", "name": "Edit", "input": { "file_path": "C:\\workspace\\Leasing\\src\\LeaseMgt.Codeunit.al", "old_string": "exit(Round(BaseRate * LeaseMath.RateFactor(Months), 0.01));", "new_string": "Foo := 1; exit(Round(BaseRate * LeaseMath.RateFactor(Months), 0.01));" } }], "stop_reason": "tool_use" },
    { "content": [{ "type": "tool_use", "id": "toolu_stub_lsp_07", "name": "Bash", "input": { "command": "sleep 20" } }], "stop_reason": "tool_use" },
    { "content": [{ "type": "tool_use", "id": "toolu_stub_lsp_08", "name": "Edit", "input": { "file_path": "C:\\workspace\\Leasing\\src\\LeaseMgt.Codeunit.al", "old_string": "Foo := 1; exit(Round(BaseRate * LeaseMath.RateFactor(Months), 0.01));", "new_string": "exit(Round(BaseRate * LeaseMath.RateFactor(Months), 0.01));" } }], "stop_reason": "tool_use" },
    { "content": [{ "type": "text", "text": "done" }], "stop_reason": "end_turn" }
  ]
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `deno test --allow-all tests/unit/harness/lsp-probe.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 7: Check, lint, format, commit**

```bash
deno check tests/unit/harness/lsp-probe.test.ts
deno lint harness/images/claude-code/lsp tests/fixtures/harness/lsp tests/unit/harness/lsp-probe.test.ts
deno fmt harness/images/claude-code/lsp/lsp-probe.mjs tests/fixtures/harness/lsp/fake-al-ls.mjs tests/unit/harness/lsp-probe.test.ts scripts/harness/stub-scenarios/arm-lsp.json
graphify update .
git add harness/images/claude-code/lsp/lsp-probe.mjs tests/fixtures/harness/lsp/fake-al-ls.mjs tests/unit/harness/lsp-probe.test.ts scripts/harness/stub-scenarios/arm-lsp.json
git commit -m "feat(harness): AL LSP probe with assertions, versioned diagnostics and process-tree cleanup (M10-01)"
```

**Acceptance:** 12 tests green; wrong answers exit 6; stale diagnostics never pass and unversioned ones after an edit exit 6; an ignored `exit` or a surviving grandchild exits 3 and leaves no process behind; every CIM and kill subprocess has the `CIM_MS` deadline; only processes whose PID and creation time were recorded are killed.

---

### Task M10-02: S1 spike (spec section 5 gate)

**Lane:** lane-ops. **Deps:** `centralgauge/harness-claude-code:2.1.282-r2` (H-01) present on the host (`DOCKER_CONTEXT=desktop-windows docker image inspect centralgauge/harness-claude-code:2.1.282-r2`; if absent, stop and ask the orchestrator); M10-01 merged for Steps 4 to 9 (Steps 1 to 3 start 10-04). **May touch:** `H:\Temp3\harness-spike\M10-S1\**`, `H:\cg-coord\m10\**`, stub-cell records under the results dir; nothing in the repo. No real model, no credential.

**Rules:** kill only PIDs you started (record each in `$S/pids.txt`); never kill by image name. Spike tags `centralgauge/harness-claude-code:2.1.282-r3-dev-M10-02` (and `-M10-02b`, `-M10-02c` for variants). Every container command ends with `exit $rc` of the evidence command.

**Acceptance bounds (S1 PASS needs all):** preflight median at most 60 s and max at most 120 s (5 runs); first cross-app `references` answer at most 180 s after `initialize`; peak guest memory in use during the stub cell at most 85% of the guest's total memory; every `expect` passes; cleanup leaves no process; zero non-loopback connections owned by LSP processes; canary invisible; no oracle hash in the container; workspace unchanged.

- [ ] **Step 1: Fetch the inputs and record hashes and lineage**

```bash
S=/h/Temp3/harness-spike/M10-S1; mkdir -p $S/ctx $S/capture
gh release download v1.17.0 -R SShadowS/al-lsp-for-agents -p al-lsp-wrapper-windows-x64.zip -D $S/ctx
curl -fL -o $S/ctx/al.download "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/ms-dynamics-smb/vsextensions/al/18.0.2732683/vspackage"
```

.NET: from `https://dotnet.microsoft.com/en-us/download/dotnet/10.0` take the newest 10.0 patch's "ASP.NET Core Runtime, Windows x64 zip" URL and published SHA512; download to `$S/ctx/dotnet.zip`. Record per artifact: URL, version, `Get-FileHash` of the downloaded bytes (SHA256 for wrapper and `al.download`, SHA512 for dotnet). Record whether `al.download` starts with bytes `1F 8B` (gzip); the pin is always the hash of the downloaded bytes, and install-lsp.ps1 gunzips when needed. Record SHA256 of `al-lsp-wrapper.exe` and `al-call-hierarchy.exe` after unzip. Lineage: on the backend side (Cronus281 compiler folder used by the cg-al backend) record the compiler version and SHA256 of `Microsoft.Dynamics.Nav.CodeAnalysis.dll`; on the extension side the same for `extension\bin\Microsoft.Dynamics.Nav.CodeAnalysis.dll`. Also check the marketplace for an AL extension version whose CodeAnalysis version equals the backend's; if one exists, repeat this step for it as candidate B.

- [ ] **Step 2: Build the spike image**

`$S/ctx/Dockerfile.windows`:

```dockerfile
ARG BASE
FROM ${BASE}
USER ContainerAdministrator
COPY al-lsp-wrapper-windows-x64.zip C:/s1/wrapper.zip
COPY al.zip C:/s1/al.zip
COPY dotnet.zip C:/s1/dotnet.zip
COPY lsp-probe.mjs C:/cg-lsp/lsp-probe.mjs
COPY lsp.json C:/cg-lsp/al-language-server-go-windows/.lsp.json
COPY plugin.json C:/cg-lsp/al-language-server-go-windows/.claude-plugin/plugin.json
COPY run.ps1 C:/run.ps1
COPY mem-sampler.ps1 C:/s1/mem-sampler.ps1
COPY s1-unpack.ps1 C:/s1/s1-unpack.ps1
RUN powershell -NoProfile -ExecutionPolicy Bypass -File C:\s1\s1-unpack.ps1; if ($LASTEXITCODE -ne 0) { throw ('unpack failed: ' + $LASTEXITCODE) }
RUN powershell -NoProfile -ExecutionPolicy Bypass -File C:\cg-lockdown.ps1 C:\cg-lsp C:\run.ps1; if ($LASTEXITCODE -ne 0) { throw ('cg-lockdown failed: ' + $LASTEXITCODE) }
USER ContainerUser
```

`$S/ctx/s1-unpack.ps1` (`$Strip` lists files removed for variant b; empty for the first build):

```powershell
param([string[]]$Strip = @())
$ErrorActionPreference = 'Stop'
Expand-Archive C:\s1\wrapper.zip C:\s1\w
New-Item -ItemType Directory -Force C:\cg-lsp\al-language-server-go-windows\bin | Out-Null
Get-ChildItem C:\s1\w -Recurse -File -Include al-lsp-wrapper.exe, al-call-hierarchy.exe | Copy-Item -Destination C:\cg-lsp\al-language-server-go-windows\bin
Expand-Archive C:\s1\al.zip C:\s1\al
Move-Item C:\s1\al\extension C:\cg-lsp\al
foreach ($f in $Strip) { Remove-Item -LiteralPath "C:\cg-lsp\al\bin\$f" -Force }
Expand-Archive C:\s1\dotnet.zip C:\cg-lsp\dotnet
Remove-Item -Recurse -Force C:\s1\w, C:\s1\al, C:\s1\wrapper.zip, C:\s1\al.zip, C:\s1\dotnet.zip
exit 0
```

`$S/ctx/al.zip` is `al.download` (gunzipped first if Step 1 found `1F 8B`). `$S/ctx/lsp.json` is the `lsp_json` object of M10-04 Step 3; `$S/ctx/plugin.json` is `{"name":"al-language-server-go-windows","version":"1.17.0"}`. `$S/ctx/run.ps1` is the H-01 run.ps1 with `$env:ENABLE_LSP_TOOL = '1'` after the `$mcpArgs` line and `$claudeArgs += $mcpArgs + @('--plugin-dir', 'C:\cg-lsp\al-language-server-go-windows')`, plus as its first line after the H-01 guard a guest-memory sampler for Step 6, started from a script file so no quoting is nested:

```powershell
Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'C:\s1\mem-sampler.ps1'
```

`$S/ctx/mem-sampler.ps1` (copied into the image by `COPY mem-sampler.ps1 C:/s1/mem-sampler.ps1` before the `s1-unpack.ps1` step, which leaves it in place):

```powershell
while ($true) {
  $o = Get-CimInstance Win32_OperatingSystem
  Add-Content C:\workspace\.s1-mem.csv ((Get-Date -Format o) + ',' + $o.TotalVisibleMemorySize + ',' + $o.FreePhysicalMemory)
  Start-Sleep 1
}
```

Build:

```bash
cp harness/images/claude-code/lsp/lsp-probe.mjs $S/ctx/
TAG=centralgauge/harness-claude-code:2.1.282-r3-dev-M10-02
if DOCKER_CONTEXT=desktop-windows docker image inspect $TAG >/dev/null 2>&1; then echo "[FAIL] $TAG exists"; exit 1; fi
R2=$(DOCKER_CONTEXT=desktop-windows docker image inspect -f '{{.Id}}' centralgauge/harness-claude-code:2.1.282-r2)
DOCKER_CONTEXT=desktop-windows docker build -f $S/ctx/Dockerfile.windows --build-arg BASE=$R2 -t $TAG $S/ctx
```

The spike image inherits the r2 labels, so `harness cell cc-sonnet-plain ... --stub-provider --image <id>` accepts it (the config's r2 tag exists).

- [ ] **Step 3: Stage the workspace, the canary, the step file and the run script**

Stage HX-001 (its overlay touches only `Fleet/`, so the fixture lines are the refapp's) with the harness's own staging, for example from a stub cell's kept workspace; confirm the lines with `Select-String`. Hash the staged tree (`Get-FileHash` over every file, sorted) into `$S/ws-before.txt`.

`$S/s1-steps.json` (0-based positions):

```json
[
  { "op": "symbols", "file": "Core\\src\\LeaseMath.Codeunit.al", "expect": { "names": ["CGR Lease Math", "RateFactor", "LeaseTotal", "SplitInstallments"] } },
  { "op": "hover", "file": "Test\\src\\LeasingTests.Codeunit.al", "line": 6, "character": 26, "expect": { "contains": ["Library Assert"] } },
  { "op": "references", "file": "Core\\src\\LeaseMath.Codeunit.al", "line": 2, "character": 23, "expect": { "locations": ["Core/src/LeaseMath.Codeunit.al:3", "Core/src/LeaseMath.Codeunit.al:10", "Leasing/src/LeaseMgt.Codeunit.al:11"] } },
  { "op": "wsymbols", "query": "CG Canary", "expect": { "none": true } },
  { "op": "wsymbols", "query": "CGR Lease Math", "expect": { "names": ["CGR Lease Math"] } },
  { "op": "edit", "file": "Leasing\\src\\LeaseMgt.Codeunit.al", "find": "exit(Round(BaseRate * LeaseMath.RateFactor(Months), 0.01));", "replace": "Foo := 1; exit(Round(BaseRate * LeaseMath.RateFactor(Months), 0.01));" },
  { "op": "diagnostics", "file": "Leasing\\src\\LeaseMgt.Codeunit.al", "code": "AL0118", "present": true },
  { "op": "edit", "file": "Leasing\\src\\LeaseMgt.Codeunit.al", "find": "Foo := 1; exit(Round(BaseRate * LeaseMath.RateFactor(Months), 0.01));", "replace": "exit(Round(BaseRate * LeaseMath.RateFactor(Months), 0.01));" },
  { "op": "diagnostics", "file": "Leasing\\src\\LeaseMgt.Codeunit.al", "code": "AL0118", "present": false }
]
```

`$S/s1-run.ps1` (runs inside the container as ContainerUser; samplers run concurrently with the probe; the probe's exit code is the script's exit code):

```powershell
param([string]$Steps = 'C:\s1out\s1-steps.json', [string]$Tag = 'a')
$ErrorActionPreference = 'Stop'
$out = 'C:\s1out'
# Canary outside the workspace: the server must never index it.
$canary = Join-Path $env:USERPROFILE 'cg-canary\Canary'
New-Item -ItemType Directory -Force "$canary\src" | Out-Null
Set-Content "$canary\app.json" '{"id":"c6a1e000-0000-4000-8000-0000000000ff","name":"CG Canary","publisher":"CentralGauge","version":"1.0.0.0","platform":"28.0.0.0","application":"28.0.0.0","idRanges":[{"from":70090,"to":70099}],"runtime":"17.0"}'
Set-Content "$canary\src\Canary.Codeunit.al" 'codeunit 70099 "CG Canary Oracle" { procedure Canary(): Integer begin exit(4711); end; }'
$mem = Start-Process powershell -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command', "while (`$true) { `$o = Get-CimInstance Win32_OperatingSystem; Add-Content $out\mem-$Tag.csv ((Get-Date -Format o) + ',' + `$o.TotalVisibleMemorySize + ',' + `$o.FreePhysicalMemory); Start-Sleep 1 }"
$net = Start-Process powershell -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command', "while (`$true) { Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { @('127.0.0.1','::1','0.0.0.0','::') -notcontains `$_.RemoteAddress } | ForEach-Object { Add-Content $out\net-$Tag.csv ((Get-Date -Format o) + ',' + `$_.RemoteAddress + ':' + `$_.RemotePort + ',' + `$_.OwningProcess + ',' + (Get-Process -Id `$_.OwningProcess -ErrorAction SilentlyContinue).ProcessName) }; Start-Sleep 1 }"
$t0 = Get-Date
node C:\cg-lsp\lsp-probe.mjs --script $Steps > "$out\probe-$Tag.json" 2> "$out\probe-$Tag.err"
$rc = $LASTEXITCODE
Add-Content "$out\probe-$Tag.err" ('[s1] probe exit ' + $rc + ' after ' + ((Get-Date) - $t0).TotalSeconds + ' s')
Stop-Process -Id $mem.Id, $net.Id -Force
Copy-Item (Join-Path $env:TEMP 'al-lsp-wrapper-go-*.log') $out -ErrorAction SilentlyContinue
Get-DnsClientCache -ErrorAction SilentlyContinue | Out-File "$out\dns-$Tag.txt"
Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine | Out-File "$out\ps-$Tag.txt"
exit $rc
```

- [ ] **Step 4: Direct probe runs as ContainerUser, offline**

```bash
WS=<staged workspace dir>
DOCKER_CONTEXT=desktop-windows docker run --rm --isolation hyperv --network none --user ContainerUser \
  --mount type=bind,source=$WS,target=C:\\workspace --mount type=bind,source=$S,target=C:\\s1out \
  -e CG_LSP_TIMEOUT_MS=900000 centralgauge/harness-claude-code:2.1.282-r3-dev-M10-02 \
  powershell -NoProfile -ExecutionPolicy Bypass -File 'C:\s1out\s1-run.ps1' -Tag a
echo "exit $?"
```

Expected: exit 0; `probe-a.json` has `"ok":true`. Record from `probe-a.json`: `total_ms`, `ms` of the first `references` (cross-app) step plus the initialize time from `probe-a.err`; from `mem-a.csv`: guest total and peak in use (total minus free); from `net-a.csv`: must be empty; whether diagnostics carried `version` (from the wrapper log or by re-running with a step file whose diagnostics step sets `settleMs` 0). Repeat on the sandbox internal network (`--network <name harness cell uses>`, no proxy env) as `-Tag b`; `net-b.csv` must hold no row whose process is the wrapper, `al-call-hierarchy`, `Microsoft.Dynamics.Nav.EditorServices.Host`, `dotnet` or `almcp`. After both runs hash the workspace into `$S/ws-after.txt`; it must equal `ws-before.txt` (any new file, for example `.alcache`, is a finding).

- [ ] **Step 5: Writable paths, stripped launchers, preflight timing, analyzer codes**

1. From `probe-a.err`, the wrapper log and the exit: does the AL host need write access to `C:\cg-lsp\al\bin` (`EditorServices.log`, `userid.txt`)? Record works / works with warning / fails.
2. Build variant b (`-M10-02b`, `s1-unpack.ps1 -Strip alc.exe,alc.dll,altool.exe,altool.dll,aldoc.exe,aldoc.dll,almcp.exe,almcp.dll`); rerun Step 4 (`-Tag c`). Record whether every step still passes; as ContainerUser run `Get-ChildItem -Recurse C:\cg-lsp -Include alc*,altool*,aldoc*,almcp*` (must be empty) and `dotnet C:\cg-lsp\al\bin\alc.dll` via `C:\cg-lsp\dotnet\dotnet.exe` (must fail: file absent). If the server fails without one of these files, record which one is needed.
3. Time `node C:\cg-lsp\lsp-probe.mjs --preflight` five times on the variant that passed (ms each, from its stderr line).
4. Diagnostic codes: from every `publishDiagnostics` in the wrapper log, list the distinct codes and their sources (compiler `AL*`, sidecar codes, any analyzer `AA*`/`AW*`/`PTE*`). This freezes the diagnostic policy input for M10-03.

- [ ] **Step 6: End to end through real Claude Code with the stub provider (no credential)**

```bash
deno task start harness cell cc-sonnet-plain HX-001 --stub-provider scripts/harness/stub-scenarios/arm-lsp.json --image <variant id>
```

While it runs, a host loop you started samples `docker stats --no-stream --format '{{.Name}},{{.MemUsage}}'` for the sandbox container every 2 s into `$S/stats-e2e.csv` (record its PID; stop it by PID). After it ends, copy `.s1-mem.csv` out of the cell's kept workspace (the in-VM sampler from the spike run.ps1: Claude Code plus LSP together, guest-wide) and delete it from that copy. Capture into `$S/capture/`: the `system/init` record (exact `tools`, exact `plugins` entry for the plugin: `name`, `path`, `source`); every `LSP` `tool_use` and `tool_result` (input field names, line base, result text); the LSP tool's input schema from the stub's logged request `tools`, if logged; the record that carries diagnostics after the first `Edit` (record type, field, text), or "not in the stream"; container end time after `done` and the cell's `confirmedGone`. Repeat once with `ENABLE_LSP_TOOL` removed from the spike run.ps1 (variant `-M10-02c`), and once with the r2 image (no plugin) for the negative init.

- [ ] **Step 7: Timeout cleanup against a live host**

Write `$S/hold-steps.json`: `[{"op":"references","file":"Core\\src\\LeaseMath.Codeunit.al","line":2,"character":23},{"op":"hold","ms":600000}]`. Start `docker run -d --name cg-spike-m10-hold ... s1-run.ps1 -Steps C:\s1out\hold-steps.json -Tag d` (offline). Wait until `probe-d.err` shows `[step 1] hold` (the references answer came back, so the AL host is up). Confirm the host is alive: `docker exec cg-spike-m10-hold powershell -Command "Get-Process Microsoft.Dynamics.Nav.EditorServices.Host, al-call-hierarchy | Select-Object Id, ProcessName"` (listing only). Then `docker rm -f cg-spike-m10-hold` (what the harness does on a cell timeout). Record: the command returns; `docker ps -a --filter name=cg-spike-m10-hold` is empty within 30 s. From Step 6: after `claude` exits the container ends without waiting on LSP processes. From the M10-01 probe: `--preflight` on the real server exits 0 (it would exit 3 on a surviving process).

- [ ] **Step 8: Oracle isolation audit**

1. Mounts: `docker inspect` of the Step 6 sandbox (Mounts): workspace, task, config, secrets, stub only.
2. Hash audit: on the host, SHA256 of every file under `harness-tasks/tasks/HX-001/` except `prompt.md`, attachments and `overlay/`, and of every file of HX-001's correct solution and reference tests; in the container (Step 4 run), SHA256 of every file under `C:\workspace`, `C:\task`, `C:\config`, `C:\cg-lsp`, `%USERPROFILE%`. No hash may appear in both sets except files the agent legitimately sees (shipped tests that the refapp itself contains): list each overlap with its path and reason.
3. Boundary: the `wsymbols "CG Canary"` step passed (the server does not index a readable AL app outside `C:\workspace`), and the wrapper log names no project root, package folder or source root outside `C:\workspace` and `C:\cg-lsp`.

- [ ] **Step 9: Write the S1 report and hand over captures**

`H:\Temp3\harness-spike\M10-S1-results.md`: one row per spec-5 item and per acceptance bound (ContainerUser; offline with `--network none` and on the internal network with attribution; writable paths; binary discovery; .NET from `DOTNET_ROOT`; path/URI handling; symbols from `.alpackages`; cross-app references; diagnostics refresh with version correlation; asserted known results; cleanup on clean exit and on `docker rm -f`; startup times vs bounds; guest peak memory vs total for the probe alone and for Claude Code plus LSP; canary; hash audit; workspace unchanged; stripped files; ENABLE_LSP_TOOL needed or not; init shapes; tool input names and line base; passive diagnostics shape; diagnostic codes seen; lineage of both CodeAnalysis versions), each PASS / FAIL / FINDING with its evidence file. A "Pins" table (URL, version, algorithm, hash of downloaded bytes, gzip yes/no, per-exe hashes, lineage hashes). Copy `$S/capture/` to `H:\cg-coord\m10\s1-capture\`. Post the report path to the orchestrator.

**Acceptance (S1 PASS):** every bound met, every row PASS; captures present.

---

### Task M10-03: S1 gate decision (fallback decision point)

**Lane:** orchestrator. **Deps:** M10-02 report. **Date:** 2026-10-08.

- [ ] **Step 1: Classify each FAIL or FINDING**

Fixable inside M10 without owner input, when the fix is identical for all four arms; every fix needs an S1 rerun of the affected steps (lane-ops, new dev tag `-M10-02d` and on) before M10-04 starts:
- the AL host needs write access to its two log files: install-lsp.ps1 pre-creates `C:\cg-lsp\al\bin\EditorServices.log` and `userid.txt`, and a Dockerfile step after the lockdown grants ContainerUser Modify on those two files only;
- `ENABLE_LSP_TOOL` not needed: run.ps1 still sets it in LSP arms and clears it in the others;
- guest memory too small: every sandbox gets `--memory <peak + 1>g` in `buildRunArgs` (all arms), and the per-cell figure goes to M7's load test;
- a stripped file is needed: keep it, list it in the image definition, and rely on the shell-call audit (M10-07);
- tool positions 0-based: fix `arm-lsp.json`.

Policy decisions this step freezes (they go into `al-lsp.json` and cannot change after screening starts): AL extension version (the backend-matching candidate B if S1 qualified it, else 18.0.2732683 with every diagnostic disagreement listed; the backend build stays authoritative for scoring, LSP diagnostics are advisory); sidecar diagnostics policy (`on`, the owner's local behaviour, or `off` via `--no-diagnostics`), decided from the S1 code list; the stripped-file list.

Blockers that kill or change the LSP arm (ask the owner):
- B1: the server cannot run as ContainerUser offline;
- B2: cross-app references or `.alpackages` symbols do not resolve;
- B3: Claude Code 2.1.282 does not load the plugin from `--plugin-dir` or exposes no LSP tool;
- B4: per-cell guest memory makes concurrency 2 impossible under the host bars (stop under 10 GB free, resume at 14 GB);
- B5: a process survives cleanup, or the canary, hash or network audit fails.

- [ ] **Step 2: If any blocker, ask the owner**

"S1 failed on <B1..B5, evidence path>. Options: (a) fix it in your al-lsp-for-agents wrapper; we pin the new release and rerun S1 (about 2 days plus your fix); (b) run the LSP arms with the limitation and narrow the claims to it, only for B2 (for example no cross-app references), never for ContainerUser, offline operation, oracle isolation or cleanup; (c) for B3, move every arm to a newer Claude Code version (new harness_version and image revision for all arms; frozen images untouched); (d) drop the LSP factor: C1 and C2 go, the claims and the power simulation are revised (M11) before screening starts. Which one?" Record the answer as a decision file; (d) cancels M10-04 to M10-09; (a) and (c) repeat M10-02.

**Acceptance:** a decision file by 2026-10-08 naming PASS, PASS-with-fixes (each fix and its S1 rerun result), or the owner's option, plus the frozen policy decisions.

---

### Task M10-04: Image layer (definition, install script, Dockerfile)

**Lane:** lane-infra. **Deps:** M10-03 PASS (or PASS-with-fixes and reruns green), H-01 merged, M9-03 merged (it adds `cg-inventory.ps1` to the same Dockerfile). **May touch:** `harness/images/claude-code/lsp/al-lsp.json`, `harness/images/claude-code/lsp/install-lsp.ps1`, `harness/images/claude-code/Dockerfile.windows`, `tests/unit/harness/images.test.ts`.

**Interfaces:**
- Produces: `harness/images/claude-code/lsp/al-lsp.json` with `version`, `pins.{wrapper,al_extension,dotnet}.{url,algorithm,hash}`, `pins.wrapper.files` (exe name to SHA256), `pins.al_extension.{version,remove}`, `lineage.{extension,backend}.{version,sha256}`, `diagnostics` (`"sidecar-on"` or `"sidecar-off"`), `plugin_json`, `lsp_json`. In the image: `C:\cg-lsp\al-lsp.json` (byte copy), `C:\cg-lsp\lsp-probe.mjs`, `C:\cg-lsp\al-language-server-go-windows\{.lsp.json,.claude-plugin\plugin.json,bin\...}`, `C:\cg-lsp\al\`, `C:\cg-lsp\dotnet\`.

- [ ] **Step 1: Write the failing tests** (append to `tests/unit/harness/images.test.ts`; add `assertMatch`)

```ts
Deno.test("claude-code image: the LSP layer installs from al-lsp.json pins and is locked with M9's inventory before USER", async () => {
  const df = await Deno.readTextFile("harness/images/claude-code/Dockerfile.windows");
  for (
    const s of [
      "COPY lsp/al-lsp.json C:/cg-lsp/al-lsp.json",
      "COPY lsp/lsp-probe.mjs C:/cg-lsp/lsp-probe.mjs",
      "COPY lsp/install-lsp.ps1 C:/cg-install-lsp.ps1",
      "COPY cg-inventory.ps1 C:/cg-inventory.ps1",
    ]
  ) assertStringIncludes(df, s);
  const lock = df.split(/\r?\n/).find((l) => l.includes("cg-lockdown.ps1"))!;
  for (const p of ["C:\\cg-npm", "C:\\run.ps1", "C:\\cg-inventory.ps1", "C:\\cg-lsp"]) {
    assertStringIncludes(lock, p);
  }
  for (const line of df.split("\n").filter((l) => l.startsWith("RUN "))) {
    assert(!line.includes('"'), `no double quote in a shell-form RUN: ${line}`);
  }
  assert(df.indexOf("install-lsp.ps1") < df.indexOf("cg-lockdown.ps1"));
  assert(df.indexOf("cg-lockdown.ps1") < df.indexOf("USER ContainerUser"));
});

Deno.test("al-lsp.json: pins, lineage and diagnostics policy are complete; the shipped .lsp.json is offline, multi-app and matches the policy", async () => {
  const d = JSON.parse(await Deno.readTextFile("harness/images/claude-code/lsp/al-lsp.json"));
  const H256 = /^[0-9a-f]{64}$/;
  assertMatch(d.version, /^al-lsp@\d+$/);
  assertEquals(d.pins.wrapper.release, "v1.17.0");
  assertEquals(Object.keys(d.pins.wrapper.files).sort(), ["al-call-hierarchy.exe", "al-lsp-wrapper.exe"]);
  for (const h of Object.values(d.pins.wrapper.files)) assertMatch(h as string, H256);
  for (const k of ["wrapper", "al_extension", "dotnet"]) {
    const p = d.pins[k];
    assertMatch(p.url, /^https:\/\//);
    assertMatch(p.hash, p.algorithm === "SHA512" ? /^[0-9a-f]{128}$/ : H256, `${k} hash`);
  }
  for (const side of ["extension", "backend"]) {
    assertMatch(d.lineage[side].version, /^\d+\.\d+/);
    assertMatch(d.lineage[side].sha256, H256);
  }
  assert(["sidecar-on", "sidecar-off"].includes(d.diagnostics));
  const al = d.lsp_json.al;
  assertEquals(al.command, "$" + "{CLAUDE_PLUGIN_ROOT}/bin/al-lsp-wrapper.exe");
  assertEquals(al.transport, "stdio");
  const i = al.args.indexOf("--al-extension-path");
  assertEquals(al.args.slice(i, i + 2), ["--al-extension-path", "C:\\cg-lsp\\al"]);
  assert(!al.args.includes("--auto-download-al-extension"));
  assertEquals(al.args.includes("--no-diagnostics"), d.diagnostics === "sidecar-off");
  assertEquals(
    [al.env.HTTPS_PROXY, al.env.HTTP_PROXY, al.env.AL_LSP_SOURCE_ROOTS, al.env.DOTNET_ROOT],
    ["", "", "C:\\workspace", "C:\\cg-lsp\\dotnet"],
  );
  assertEquals([al.initializationOptions, al.settings], [{}, {}]);
  assertEquals(d.plugin_json.name, "al-language-server-go-windows");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `deno test --allow-all tests/unit/harness/images.test.ts --filter "LSP layer|al-lsp.json"`
Expected: FAIL, `al-lsp.json` missing, Dockerfile strings missing.

- [ ] **Step 3: Write `al-lsp.json`**

Values in angle brackets come from the S1 Pins table and the M10-03 decision file; the Step 1 test refuses anything that is not a real hash or version. `remove` is the M10-03 stripped-file list; `args` gets `"--no-diagnostics"` appended exactly when `diagnostics` is `"sidecar-off"`.

```json
{
  "version": "al-lsp@1",
  "pins": {
    "wrapper": {
      "release": "v1.17.0",
      "url": "https://github.com/SShadowS/al-lsp-for-agents/releases/download/v1.17.0/al-lsp-wrapper-windows-x64.zip",
      "algorithm": "SHA256",
      "hash": "<S1 Pins: wrapper zip sha256>",
      "files": {
        "al-lsp-wrapper.exe": "<S1 Pins: sha256>",
        "al-call-hierarchy.exe": "<S1 Pins: sha256>"
      }
    },
    "al_extension": {
      "version": "<M10-03: 18.0.2732683 or candidate B>",
      "url": "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/ms-dynamics-smb/vsextensions/al/<version>/vspackage",
      "algorithm": "SHA256",
      "hash": "<S1 Pins: sha256 of the downloaded bytes>",
      "remove": ["alc.exe", "alc.dll", "altool.exe", "altool.dll", "aldoc.exe", "aldoc.dll", "almcp.exe", "almcp.dll"]
    },
    "dotnet": {
      "version": "<S1 Pins: 10.0.x>",
      "url": "<S1 Pins: aspnetcore-runtime-10.0.x-win-x64.zip URL>",
      "algorithm": "SHA512",
      "hash": "<S1 Pins: sha512>"
    }
  },
  "lineage": {
    "extension": { "version": "<S1: extension CodeAnalysis version>", "sha256": "<S1>" },
    "backend": { "version": "<S1: backend CodeAnalysis version>", "sha256": "<S1>" }
  },
  "diagnostics": "<M10-03: sidecar-on or sidecar-off>",
  "plugin_json": {
    "name": "al-language-server-go-windows",
    "version": "1.17.0",
    "description": "AL language server wrapper (Go) for Windows, al-lsp-for-agents v1.17.0, pinned for the CentralGauge sandbox"
  },
  "lsp_json": {
    "al": {
      "command": "${CLAUDE_PLUGIN_ROOT}/bin/al-lsp-wrapper.exe",
      "args": ["--launcher", "claude-code", "--al-extension-path", "C:\\cg-lsp\\al"],
      "extensionToLanguage": { ".al": "al", ".dal": "al" },
      "transport": "stdio",
      "env": {
        "DOTNET_ROOT": "C:\\cg-lsp\\dotnet",
        "DOTNET_CLI_TELEMETRY_OPTOUT": "1",
        "AL_LSP_SOURCE_ROOTS": "C:\\workspace",
        "HTTPS_PROXY": "",
        "HTTP_PROXY": ""
      },
      "initializationOptions": {},
      "settings": {},
      "maxRestarts": 3
    }
  }
}
```

The backend lineage is recorded, not installed: a backend compiler change changes this file, hence the image label, so the LSP and the compiler are re-frozen together.

- [ ] **Step 4: Write `install-lsp.ps1`**

```powershell
# M10: install the AL language server plugin from the pins in C:\cg-lsp\al-lsp.json.
# The hash of every downloaded artifact is checked; a gzip-wrapped VSIX is
# decompressed after the check; every installed executable is checked again.
# Any mismatch fails the image build. Build time only (ContainerAdministrator);
# cg-lockdown makes C:\cg-lsp read-only afterwards.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$utf8 = New-Object System.Text.UTF8Encoding $false
$def = Get-Content 'C:\cg-lsp\al-lsp.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$tmp = 'C:\cg-lsp-tmp'
$plugin = 'C:\cg-lsp\al-language-server-go-windows'
New-Item -ItemType Directory -Force -Path $tmp, "$plugin\bin", "$plugin\.claude-plugin" | Out-Null

function Get-Pinned($pin, [string]$out) {
  Invoke-WebRequest -UseBasicParsing -Uri $pin.url -OutFile $out
  $got = (Get-FileHash -LiteralPath $out -Algorithm $pin.algorithm).Hash.ToLowerInvariant()
  if ($got -ne $pin.hash) { throw ('hash mismatch for ' + $pin.url + ': got ' + $got) }
}

function Test-Gzip([string]$path) {
  $s = [IO.File]::OpenRead($path)
  try { $b = New-Object byte[] 2; $n = $s.Read($b, 0, 2); return ($n -eq 2 -and $b[0] -eq 0x1f -and $b[1] -eq 0x8b) } finally { $s.Close() }
}

# 1. Wrapper release: only the named executables, each hash-checked.
Get-Pinned $def.pins.wrapper "$tmp\wrapper.zip"
Expand-Archive -LiteralPath "$tmp\wrapper.zip" -DestinationPath "$tmp\wrapper"
foreach ($p in $def.pins.wrapper.files.PSObject.Properties) {
  $found = @(Get-ChildItem -LiteralPath "$tmp\wrapper" -Recurse -File -Filter $p.Name)
  if ($found.Count -ne 1) { throw ('wrapper archive must hold exactly one ' + $p.Name) }
  Copy-Item -LiteralPath $found[0].FullName -Destination "$plugin\bin\$($p.Name)"
  $h = (Get-FileHash -LiteralPath "$plugin\bin\$($p.Name)" -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($h -ne $p.Value) { throw ('hash mismatch for ' + $p.Name + ': got ' + $h) }
}

# 2. AL extension (a VSIX is a zip, sometimes served gzip-wrapped): its extension folder only.
Get-Pinned $def.pins.al_extension "$tmp\al.download"
if (Test-Gzip "$tmp\al.download") {
  $in = [IO.File]::OpenRead("$tmp\al.download")
  $gz = New-Object IO.Compression.GZipStream($in, [IO.Compression.CompressionMode]::Decompress)
  $out = [IO.File]::Create("$tmp\al.zip")
  try { $gz.CopyTo($out) } finally { $out.Close(); $gz.Close(); $in.Close() }
} else {
  Move-Item -LiteralPath "$tmp\al.download" -Destination "$tmp\al.zip"
}
Expand-Archive -LiteralPath "$tmp\al.zip" -DestinationPath "$tmp\al"
Move-Item -LiteralPath "$tmp\al\extension" -Destination 'C:\cg-lsp\al'
foreach ($name in $def.pins.al_extension.remove) {
  Remove-Item -LiteralPath "C:\cg-lsp\al\bin\$name" -Force
}
$ca = (Get-FileHash -LiteralPath 'C:\cg-lsp\al\bin\Microsoft.Dynamics.Nav.CodeAnalysis.dll' -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ca -ne $def.lineage.extension.sha256) { throw ('extension CodeAnalysis differs from lineage: ' + $ca) }

# 3. ASP.NET Core runtime 10 (holds Microsoft.NETCore.App too), private to the LSP.
Get-Pinned $def.pins.dotnet "$tmp\dotnet.zip"
Expand-Archive -LiteralPath "$tmp\dotnet.zip" -DestinationPath 'C:\cg-lsp\dotnet'

# 4. Plugin files from the hashed definition (single source of truth).
[IO.File]::WriteAllText("$plugin\.lsp.json", (ConvertTo-Json -InputObject $def.lsp_json -Depth 10), $utf8)
[IO.File]::WriteAllText("$plugin\.claude-plugin\plugin.json", (ConvertTo-Json -InputObject $def.plugin_json -Depth 10), $utf8)

Remove-Item -LiteralPath $tmp -Recurse -Force
[Console]::Out.WriteLine('[OK] install-lsp: wrapper ' + $def.pins.wrapper.release + ', AL ' + $def.pins.al_extension.version + ', .NET ' + $def.pins.dotnet.version + ', diagnostics ' + $def.diagnostics)
exit 0
```

- [ ] **Step 5: Edit the Dockerfile** (on top of M9-03's version; the result is):

```dockerfile
# Claude Code harness image. Campaign build: `harness images build claude-code --version 2.1.282 --revision 3`
# (once, after M9 and M10 merge; dev builds use -r3-dev-<task> tags, never a config).
# BASE has no default: `harness images build` passes the inspected immutable base image and then
# verifies that the built image's layers start with the base's layers (M1-24).
ARG BASE
FROM ${BASE}
# A machine-wide npm prefix (H-01): ContainerUser can read and run it.
RUN $env:PATH = 'C:\Program Files\nodejs;' + $env:PATH; \
    npm install -g --prefix C:\cg-npm @anthropic-ai/claude-code@2.1.282; \
    [Environment]::SetEnvironmentVariable('PATH', 'C:\cg-npm;' + [Environment]::GetEnvironmentVariable('PATH', 'Machine'), [EnvironmentVariableTarget]::Machine)
# M10: the AL language server plugin (al-lsp-for-agents wrapper, Microsoft AL extension, private
# .NET 10), hash-pinned in lsp/al-lsp.json. Every arm's image has it; only an arm that declares
# components.lsp loads it (run.ps1 --plugin-dir; cg-inventory.ps1 preflight).
COPY lsp/al-lsp.json C:/cg-lsp/al-lsp.json
COPY lsp/lsp-probe.mjs C:/cg-lsp/lsp-probe.mjs
COPY lsp/install-lsp.ps1 C:/cg-install-lsp.ps1
RUN powershell -NoProfile -ExecutionPolicy Bypass -File C:\cg-install-lsp.ps1; \
    if ($LASTEXITCODE -ne 0) { throw ('install-lsp failed: ' + $LASTEXITCODE) }; \
    Remove-Item -Force C:\cg-install-lsp.ps1
COPY run.ps1 C:/run.ps1
COPY cg-inventory.ps1 C:/cg-inventory.ps1
# H-01 run 004: what this image adds is read-only for the agent user.
RUN powershell -NoProfile -ExecutionPolicy Bypass -File C:\cg-lockdown.ps1 C:\cg-npm C:\run.ps1 C:\cg-inventory.ps1 C:\cg-lsp; \
    if ($LASTEXITCODE -ne 0) { throw ('cg-lockdown failed: ' + $LASTEXITCODE) }
# H-01: defense in depth; the harness also passes --user ContainerUser.
USER ContainerUser
CMD ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\run.ps1"]
```

M9-03's test asserts the lockdown line contains `C:\cg-inventory.ps1` and `--revision 3`; both still hold. If M10-03 granted Modify on the two log files, add that `RUN icacls ...` line after the lockdown line (single quotes only).

- [ ] **Step 6: Run the tests**

Run: `deno test --allow-all tests/unit/harness/images.test.ts tests/unit/harness/claude-code.test.ts`
Expected: PASS (M9-03's Dockerfile test included).

- [ ] **Step 7: Format, commit**

```bash
deno fmt tests/unit/harness/images.test.ts harness/images/claude-code/lsp/al-lsp.json
deno lint tests/unit/harness/images.test.ts
graphify update .
git add harness/images/claude-code/lsp/al-lsp.json harness/images/claude-code/lsp/install-lsp.ps1 harness/images/claude-code/Dockerfile.windows tests/unit/harness/images.test.ts
git commit -m "feat(harness): claude-code image LSP layer from hash-pinned al-lsp.json with lineage and diagnostics policy (M10-04)"
```

**Acceptance:** tests green; every artifact, executable and the extension's CodeAnalysis are hash-checked at build; policy and pins live in the hashed definition.

---

### Task M10-05: LSP label, image facts, runtimeFacts, build label, stub `--image` facts

**Lane:** lane-infra. **Deps:** M10-04, H-01 merged. **May touch:** `src/harness/images.ts`, `cli/commands/harness-command.ts` (`harnessImagesBuild`, the `runtimeFacts` call in `harnessCell`), `src/harness/campaign.ts` (its `runtimeFacts` call), `tests/unit/harness/images.test.ts`, `tests/unit/cli/commands/harness-command.test.ts`.

**Interfaces:**
- Consumes: `AL_LSP_DEF` (M10-04).
- Produces (`src/harness/images.ts`): `LSP_LABEL_PREFIX`, `AL_LSP_DEF`, `AL_LSP_SHIPPED = "C:\\cg-lsp\\al-lsp.json"`, `lspFacts(ref, labels)`, `lspLabel(root): Promise<[string, string] | null>`, `lspDefinitions(root)`, `serverDefinitions(root, { mcp, lsp })`, `ImageFacts.lsp?`. `runtimeFacts` sets `servers.al` for an LSP arm (`resolveManifest`'s `servers(c.lsp, facts, "lsp")` reads it unchanged). In a stub cell, `--image` is the image `runtimeFacts` reads, so dev-tag proofs work before the campaign tag exists.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/harness/images.test.ts` (import `AL_LSP_DEF`, `AL_LSP_SHIPPED`, `lspLabel`, `serverDefinitions`):

```ts
Deno.test("lspLabel: the value is al-lsp.json's version and its hashJson; no file, no label", async () => {
  const [k, v] = (await lspLabel("."))!;
  assertEquals(k, "centralgauge.lsp.al");
  const def = JSON.parse(await Deno.readTextFile(AL_LSP_DEF));
  assertEquals(v, `${def.version} ${await hashJson(def)}`);
  assertEquals(await lspLabel(await Deno.makeTempDir()), null);
});

Deno.test("imageFacts: an LSP label needs the shipped al-lsp.json to hash to it; unknown LSP labels refused", async () => {
  const [k, v] = (await lspLabel("."))!;
  const shipped = await Deno.readTextFile(AL_LSP_DEF);
  const d = new FakeDocker();
  d.addImage("ok", ID, { ...LABELS, [k]: v });
  d.shipFile(ID, AL_LSP_SHIPPED, shipped);
  assertEquals(Object.keys((await imageFacts(d, "ok", "HOST1")).lsp ?? {}), ["al"]);
  const other = `sha256:${"e".repeat(64)}`;
  const def = JSON.parse(shipped);
  def.lsp_json.al.args = [...def.lsp_json.al.args, "--extra"];
  d.addImage("drift", other, { ...LABELS, [k]: v });
  d.shipFile(other, AL_LSP_SHIPPED, JSON.stringify(def));
  await assertRejects(() => imageFacts(d, "drift", "HOST1"), ConfigurationError, "differs from its label");
  d.addImage("none", `sha256:${"f".repeat(64)}`, { ...LABELS, [k]: v });
  await assertRejects(() => imageFacts(d, "none", "HOST1"), ConfigurationError, "cannot read");
  d.addImage("unknown", `sha256:${"c".repeat(64)}`, { ...LABELS, "centralgauge.lsp.pyright": v });
  await assertRejects(() => imageFacts(d, "unknown", "HOST1"), ConfigurationError, "unknown LSP component");
  d.addImage("plain", `sha256:${"9".repeat(64)}`, LABELS);
  assertEquals((await imageFacts(d, "plain", "HOST1")).lsp, undefined);
});

Deno.test("runtimeFacts: an LSP arm needs the image's LSP label and the repo definition with the same hash", () => {
  const cfg = HarnessConfigSchema.parse({
    id: "cc-lsp",
    harness: "claude-code",
    harness_version: "2.1.282",
    image_revision: "3",
    models: { main: "anthropic/claude-sonnet-5" },
    components: { lsp: ["al"] },
    limits: { timeout_min: 30, max_budget_usd: 5 },
  });
  const image = { digest: ID, base_digest: BASE, harness: "claude-code", version: "2.1.282", revision: "3" };
  assertThrows(() => runtimeFacts(cfg, image, claudeCodeAdapter, catalog), ConfigurationError, "has no LSP component al");
  const lsp = { al: { version: "al-lsp@1", tool_schema_hash: "1".repeat(64) } };
  assertThrows(() => runtimeFacts(cfg, { ...image, lsp }, claudeCodeAdapter, catalog), ConfigurationError, "no repo definition loaded for LSP component al");
  assertThrows(
    () => runtimeFacts(cfg, { ...image, lsp }, claudeCodeAdapter, catalog, { al: { hash: "2".repeat(64), tools: [] } }),
    ConfigurationError,
    "differs from image",
  );
  const f = runtimeFacts(cfg, { ...image, lsp }, claudeCodeAdapter, catalog, { al: { hash: "1".repeat(64), tools: [] } });
  assertEquals(f.servers, lsp);
  assertEquals(f.native_settings["mcp_tools"], undefined);
});

Deno.test("serverDefinitions: only the kinds a config names; the LSP definition lists no MCP tools", async () => {
  assertEquals(await serverDefinitions(".", { mcp: [], lsp: [] }), {});
  const both = await serverDefinitions(".", { mcp: ["al-tools"], lsp: ["al"] });
  assertEquals(Object.keys(both).sort(), ["al", "al-tools"]);
  assertEquals(both["al"]!.tools, []);
  assertEquals(both["al"]!.hash, (await lspLabel("."))![1].split(" ")[1]);
});
```

Append to `tests/unit/cli/commands/harness-command.test.ts` (import `AL_LSP_DEF`, `AL_LSP_SHIPPED`, `lspLabel`; the helpers `makeEnv`, `writeCatalog`, `cellOpts`, `rootedOpener`, `scenarioFile`, `noInterrupt` already live in this file):

```ts
Deno.test("harnessImagesBuild: claude-code carries the LSP label from al-lsp.json; the built image must show it", async () => {
  const root = await Deno.realPath(await Deno.makeTempDir());
  const docker = new FakeDocker();
  await Deno.mkdir(join(root, "harness", "images", "claude-code", "lsp"), { recursive: true });
  await Deno.copyFile(AL_LSP_DEF, join(root, AL_LSP_DEF));
  const [lk, lv] = (await lspLabel(root))!;
  const baseId = `sha256:${"b".repeat(64)}`;
  docker.addImage(BASE_IMAGE, baseId, {}, ["l1"]);
  const tag = "centralgauge/harness-claude-code:2.1.282-r3";
  const id = `sha256:${"c".repeat(64)}`;
  const labels = {
    "centralgauge.harness": "claude-code",
    "centralgauge.harness.version": "2.1.282",
    "centralgauge.harness.base_digest": baseId,
    "centralgauge.harness.revision": "3",
  };
  docker.addImage(tag, id, labels, ["l1", "l2"]);
  const o = { root, version: "2.1.282", revision: "3" };
  await assertRejects(() => harnessImagesBuild("claude-code", o, docker), ConfigurationError, `label ${lk} did not land`);
  const args = docker.builds.at(-1)!;
  const i = args.indexOf(`${lk}=${lv}`);
  assert(i > 0 && args[i - 1] === "--label" && i < args.indexOf("-t"));
  docker.addImage(tag, id, { ...labels, [lk]: lv }, ["l1", "l2"]);
  docker.shipFile(id, AL_LSP_SHIPPED, await Deno.readTextFile(AL_LSP_DEF));
  assertEquals((await harnessImagesBuild("claude-code", o, docker)).lsp?.["al"]?.tool_schema_hash, lv.split(" ")[1]);
});

Deno.test("harnessCell: a stub cell's --image is the image runtimeFacts reads (dev-tag LSP proofs)", async () => {
  const t = await makeEnv();
  await writeCatalog(t);
  await Deno.mkdir(join(t.repo.root, "harness", "images", "claude-code", "lsp"), { recursive: true });
  await Deno.copyFile(AL_LSP_DEF, join(t.repo.root, AL_LSP_DEF));
  await Deno.writeTextFile(
    join(t.repo.root, "harness", "configs", "cc-dev-lsp.yml"),
    'id: cc-dev-lsp\nharness: claude-code\nharness_version: "2.1.282"\nimage_revision: "2"\nmodels: { main: anthropic/claude-sonnet-5 }\nsettings: {}\ncomponents: { lsp: [al] }\nlimits: { timeout_min: 30, max_budget_usd: 5 }\n',
  );
  const dev = `sha256:${"7".repeat(64)}`;
  const [lk, lv] = (await lspLabel(t.repo.root))!;
  t.docker.addImage(dev, dev, {
    "centralgauge.harness": "claude-code",
    "centralgauge.harness.version": "2.1.282",
    "centralgauge.harness.base_digest": `sha256:${"b".repeat(64)}`,
    "centralgauge.harness.revision": "2",
    [lk]: lv,
  });
  t.docker.shipFile(dev, AL_LSP_SHIPPED, await Deno.readTextFile(AL_LSP_DEF));
  const results = join(t.repo.root, "results", "harness");
  const base = { resultsDir: results, supervised: false, stubProvider: await scenarioFile(t) };
  // The config's own tag has no LSP label: without --image the arm is refused.
  await assertRejects(
    () => harnessCell("cc-dev-lsp", "HX-001", cellOpts(t, base), rootedOpener(t), () => false, noInterrupt),
    ConfigurationError,
  );
  const r = await harnessCell("cc-dev-lsp", "HX-001", cellOpts(t, { ...base, image: dev }), rootedOpener(t), () => false, noInterrupt);
  assertEquals(r.executions.length, 1);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `deno test --allow-all tests/unit/harness/images.test.ts tests/unit/cli/commands/harness-command.test.ts --filter "LSP|lspLabel|serverDefinitions|--image is the image"`
Expected: FAIL, exports missing.

- [ ] **Step 3: Implement in `src/harness/images.ts`**

After `AL_TOOLS_SHIPPED`:

```ts
/**
 * LSP component labels (M10): `centralgauge.lsp.<name>` = `<version> <sha256>`
 * on the claude-code image, the hashJson of the repo definition.
 */
export const LSP_LABEL_PREFIX = "centralgauge.lsp.";
const LSP_COMPONENTS: readonly string[] = ["al"];
export const AL_LSP_DEF = "harness/images/claude-code/lsp/al-lsp.json";
/** Where the claude-code Dockerfile puts the definition the image was built from. */
export const AL_LSP_SHIPPED = "C:\\cg-lsp\\al-lsp.json";
```

Add `lsp?: Record<string, { version: string; tool_schema_hash: string }>;` to `ImageFacts` after `mcp?`.

Replace `mcpFacts` with a shared parser (MCP message text unchanged):

```ts
type ComponentFacts = Record<string, { version: string; tool_schema_hash: string }>;

function componentFacts(
  ref: string,
  l: Record<string, string>,
  prefix: string,
  known: readonly string[],
  kind: "MCP" | "LSP",
): ComponentFacts {
  const out: ComponentFacts = {};
  for (const [k, v] of Object.entries(l)) {
    if (!k.startsWith(prefix)) continue;
    const name = k.slice(prefix.length);
    if (!known.includes(name)) {
      throw new ConfigurationError(
        `image ${ref}: label ${k} names an unknown ${kind} component "${name}" (known: ${known.join(", ")})`,
      );
    }
    const [version, hash, ...rest] = v.split(" ");
    if (!version || !MCP_VERSION.test(version) || !hash || !SHA256_HEX.test(hash) || rest.length > 0) {
      throw new ConfigurationError(`image ${ref}: label ${k} must be "<version> <sha256>", got "${v}"`);
    }
    out[name] = { version, tool_schema_hash: hash };
  }
  return out;
}

/** The MCP component facts in an image's labels; malformed or unknown labels are refused. */
export const mcpFacts = (ref: string, l: Record<string, string>) =>
  componentFacts(ref, l, MCP_LABEL_PREFIX, MCP_COMPONENTS, "MCP");
/** The LSP component facts in an image's labels (M10); same rules. */
export const lspFacts = (ref: string, l: Record<string, string>) =>
  componentFacts(ref, l, LSP_LABEL_PREFIX, LSP_COMPONENTS, "LSP");

/** The label is trusted at build time only: the bytes the image ships must hash to it. */
async function verifyShipped(
  docker: DockerCli,
  id: string,
  owner: string,
  ref: string,
  path: string,
  want: string,
  fix: string,
): Promise<void> {
  const text = await docker.readImageFile(id, path, owner);
  let hash: string;
  try {
    if (text === null) throw new Error("not found");
    hash = await hashJson(JSON.parse(text));
  } catch (e) {
    throw new ConfigurationError(
      `image ${ref}: cannot read the shipped ${path} (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  if (hash !== want) {
    throw new ConfigurationError(
      `image ${ref}: shipped ${path} hashes to ${hash}, which differs from its label ${want}: ${fix}`,
    );
  }
}
```

In `imageFacts`, replace from `const mcp = mcpFacts(ref, l);` through the end of the al-tools `if` with:

```ts
  const mcp = mcpFacts(ref, l);
  const lsp = lspFacts(ref, l);
  if (owner !== null) {
    if (mcp["al-tools"]) {
      await verifyShipped(docker, img.Id, owner, ref, AL_TOOLS_SHIPPED, mcp["al-tools"].tool_schema_hash, "rebuild the base image");
    }
    if (lsp["al"]) {
      await verifyShipped(docker, img.Id, owner, ref, AL_LSP_SHIPPED, lsp["al"].tool_schema_hash, "rebuild the claude-code image");
    }
  }
```

and add `...(Object.keys(lsp).length > 0 ? { lsp } : {}),` after `mcp,` in the return (no key on images without LSP; existing deep-equal tests stay green).

Replace `readAlToolsDef` with:

```ts
/** A component definition file, read once and version-checked. */
async function readDef(root: string, rel: string, what: string): Promise<{ version: string; tools?: unknown }> {
  const path = join(root, rel);
  let def: { version?: unknown; tools?: unknown };
  try {
    def = JSON.parse(await Deno.readTextFile(path));
  } catch (e) {
    throw new ConfigurationError(`${path}: cannot read the ${what}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (typeof def?.version !== "string" || !MCP_VERSION.test(def.version)) {
    throw new ConfigurationError(`${path}: version missing or contains whitespace`);
  }
  return def as { version: string; tools?: unknown };
}
const readAlToolsDef = (root: string) => readDef(root, AL_TOOLS_DEF, "al-tools tool definition");
```

After `mcpDefinitions`:

```ts
/**
 * The claude-code image's LSP label. null when the build root has no
 * al-lsp.json: the real Dockerfile COPYs that file, so a real build cannot
 * succeed without it; temp build roots in tests stay label-free.
 */
export async function lspLabel(root: string): Promise<[string, string] | null> {
  try {
    await Deno.stat(join(root, AL_LSP_DEF));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
  const def = await readDef(root, AL_LSP_DEF, "AL LSP definition");
  return [`${LSP_LABEL_PREFIX}al`, `${def.version} ${await hashJson(def)}`];
}

/** The repo's LSP definition: the hash the label must carry; no MCP tool list. */
export async function lspDefinitions(root: string): Promise<McpDefinitions> {
  const def = await readDef(root, AL_LSP_DEF, "AL LSP definition");
  return { al: { hash: await hashJson(def), tools: [] } };
}

/** The definitions runtimeFacts needs for exactly the server kinds a config names. */
export async function serverDefinitions(
  root: string,
  c: { mcp: readonly string[]; lsp: readonly string[] },
): Promise<McpDefinitions> {
  return {
    ...(c.mcp.length > 0 ? await mcpDefinitions(root) : {}),
    ...(c.lsp.length > 0 ? await lspDefinitions(root) : {}),
  };
}
```

In `runtimeFacts`, replace the `LSP components are not implemented` block, the MCP loop and the `names` line with:

```ts
  const servers: RuntimeFacts["servers"] = {};
  const fact = (kind: "MCP" | "LSP", name: string, table: ImageFacts["mcp"], defFile: string, fix: string) => {
    const f = table && Object.hasOwn(table, name) ? table[name] : undefined;
    if (!f) {
      throw new ConfigurationError(`${config.id}: image ${image.digest} has no ${kind} component ${name} (${fix})`);
    }
    // Definition drift: the repo's file is not the one the image shipped.
    const def = Object.hasOwn(defs, name) ? defs[name] : undefined;
    if (!def) {
      throw new ConfigurationError(`${config.id}: no repo definition loaded for ${kind} component ${name}`);
    }
    if (def.hash !== f.tool_schema_hash) {
      throw new ConfigurationError(`${config.id}: definition ${defFile} differs from image ${image.digest}: rebuild`);
    }
    servers[name] = f;
  };
  for (const name of config.components.mcp) {
    fact("MCP", name, image.mcp, AL_TOOLS_DEF, "rebuild the base image, then the harness image");
  }
  for (const name of config.components.lsp) {
    fact("LSP", name, image.lsp, AL_LSP_DEF, "build the claude-code image with the LSP layer");
  }
  const native = adapter.nativeSettings(config, catalog);
  // The expected MCP tool inventory (M2-09): MCP servers only, sorted.
  const names = [...config.components.mcp].sort();
```

The rest of `runtimeFacts` is unchanged.

- [ ] **Step 4: Callers, build label, stub image**

`src/harness/campaign.ts` and `cli/commands/harness-command.ts` (`harnessCell`): replace `config.components.mcp.length > 0 ? await mcpDefinitions(<root>) : {}` with `await serverDefinitions(<root>, config.components)` (`env.repoRoot` in campaign.ts, `o.root` in harness-command.ts) and fix the imports.

In `harnessCell`, the image whose facts go into `runtimeFacts` becomes the stub override when one is given (`--image` is already refused without `--stub-provider`):

```ts
      await imageFacts(
        env.docker,
        o.image ??
          imageTag(config.harness, config.harness_version, config.image_revision),
        env.owner,
      ),
```

In `harnessImagesBuild`, after `const tag = imageTag(harness, o.version, o.revision);` add `const lspL = harness === "claude-code" ? await lspLabel(o.root) : null;`, add `...(lspL ? ["--label", `${lspL[0]}=${lspL[1]}`] : []),` after the revision label in the build args, and after the revision check:

```ts
  if (lspL && `${f.lsp?.["al"]?.version} ${f.lsp?.["al"]?.tool_schema_hash}` !== lspL[1]) {
    throw new ConfigurationError(`${tag}: label ${lspL[0]} did not land on the built image (want "${lspL[1]}")`);
  }
```

- [ ] **Step 5: Run the tests**

Run: `deno test --allow-all tests/unit/harness/images.test.ts tests/unit/cli/commands/harness-command.test.ts tests/unit/harness/campaign.test.ts tests/unit/harness/manifest.test.ts`
Expected: PASS, including the existing "runtimeFacts: MCP facts come from the image label; LSP and missing MCP refused" (its `lsp: ["al-lsp"]` case now fails with "has no LSP component al-lsp", which contains "LSP").

- [ ] **Step 6: Check, lint, format, commit**

```bash
deno check src/harness/images.ts src/harness/campaign.ts cli/commands/harness-command.ts
deno lint src/harness cli/commands
deno fmt src/harness/images.ts src/harness/campaign.ts cli/commands/harness-command.ts tests/unit/harness/images.test.ts tests/unit/cli/commands/harness-command.test.ts
graphify update .
git add src/harness/images.ts src/harness/campaign.ts cli/commands/harness-command.ts tests/unit/harness/images.test.ts tests/unit/cli/commands/harness-command.test.ts
git commit -m "feat(harness): LSP component facts from the claude-code image label; stub --image feeds runtimeFacts (M10-05)"
```

**Acceptance:** an LSP arm resolves only on an image whose shipped definition hashes to its label and to the repo file; frozen images refuse LSP arms; a dev image can be proven through a stub cell.

---

### Task M10-06: Plug the LSP into M9's inventory; run.ps1; plugin identity; combined execution test

**Lane:** lane-infra. **Deps:** M10-05; M9-02, M9-03, M9-04 (exact installed set with `lsp:<name>`, allow-list and the ONE positive LSP check, appendix section 3), M9-05, M9-08 merged; S1 captures in `H:\cg-coord\m10\s1-capture\`. **May touch:** `harness/images/claude-code/cg-inventory.ps1` (LSP section only), `harness/images/claude-code/run.ps1` (LSP block only), `src/harness/adapters/claude-code.ts` (`nativeSettings` and the VALUES of `LSP_PLUGINS.al`; not `componentInventory`), `harness/configs/cc-v2-plain-lsp.yml`, `harness/configs/cc-v2-realistic-lsp.yml` and the M9-08 assertions naming `al-lsp` (slug only), `tests/unit/harness/inventory-lsp.test.ts` (new), `tests/fixtures/harness/lsp/fake-probe.mjs` (new), `tests/unit/harness/claude-code.test.ts`, `tests/unit/harness/execution.test.ts`, `tests/fixtures/harness/claude-code/lsp-init.json` (new, from S1).

**Interface owned by M9 (ruling 3, appendix sections 3 and 4):** M9-04's `componentInventory` requires `installed` to equal the declared installable components plus `lsp:<name>` per declared LSP, allows `BUILTIN_INVENTORY` plugins plus `LSP_PLUGINS[<declared>]` (match rule `pluginIs`), refuses the `LSP` tool when `manifest.lsp` is empty, and runs the ONE positive check (preflight in `installed`, plugin in init, `LSP` tool) with the problem `lsp:<name> not loaded (preflight <passed|missing>, plugin <present|absent>, LSP tool <present|absent>)`. M10 adds no adapter loop and no second check; `LSP_PLUGIN_SOURCES` (rev 2) is withdrawn.

**Interfaces:**
- Produces: the values of `LSP_PLUGINS.al` (`{ name, source, path | null }`, from the S1 init capture); `cg_inventory.installed` contains `"lsp:al"` when the declared LSP passed its preflight; inventory problem strings `lsp:al: plugin missing at <path>`, `lsp:al: preflight failed (exit <n>)`, `unknown LSP component: <name>`, `ENABLE_LSP_TOOL is set in an arm without LSP`; `settings.lsp` from `components.lsp` only.

- [ ] **Step 1: Save the real init from S1 and set the identity**

Copy the S1 init record with the plugin to `tests/fixtures/harness/claude-code/lsp-init.json`. From the plugin entry set `LSP_PLUGINS.al` in `src/harness/adapters/claude-code.ts`: `name` and `source` exactly as captured (for example `al-language-server-go-windows@inline`), `path` as captured, or `null` when init entries carry no `path`. Change nothing else in M9's code. If the LSP tool is not named `LSP` in the capture, stop and tell the orchestrator (M9-04's check names `LSP`; the appendix changes first).

- [ ] **Step 2: Write the failing tests**

`tests/fixtures/harness/lsp/fake-probe.mjs`:

```js
// Fake lsp-probe for cg-inventory tests: exit code from CG_FAKE_PROBE_RC, stderr only.
import process from "node:process";
process.stderr.write("[fake] lsp-probe preflight\n");
process.exit(Number(process.env.CG_FAKE_PROBE_RC ?? "0"));
```

`tests/unit/harness/inventory-lsp.test.ts`:

```ts
import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { tempDir } from "./temp-dirs.ts";

const SCRIPT = fromFileUrl(new URL("../../../harness/images/claude-code/cg-inventory.ps1", import.meta.url));
const FAKE_PROBE = fromFileUrl(new URL("../../fixtures/harness/lsp/fake-probe.mjs", import.meta.url));
const IGNORE = Deno.build.os !== "windows";

async function run(
  settings: Record<string, unknown> | null,
  opts: { plugin?: boolean; rc?: number; enableTool?: boolean } = {},
) {
  const root = await Deno.realPath(await tempDir({ prefix: "cg-inv-lsp-" }));
  for (const d of ["config", "home", "ws/Core", "plugin"]) await Deno.mkdir(join(root, d), { recursive: true });
  await Deno.writeTextFile(join(root, "ws", "Core", "app.json"), "{}");
  if (settings) await Deno.writeTextFile(join(root, "config", "settings.json"), JSON.stringify({ settings }));
  if (opts.plugin !== false) await Deno.writeTextFile(join(root, "plugin", ".lsp.json"), "{}");
  const env: Record<string, string> = { CG_FAKE_PROBE_RC: String(opts.rc ?? 0) };
  const out = await new Deno.Command("powershell", {
    args: [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
      `${opts.enableTool ? "$env:ENABLE_LSP_TOOL = '1'" : "Remove-Item Env:\\ENABLE_LSP_TOOL -ErrorAction SilentlyContinue"}; ` +
      `& '${SCRIPT}' -ConfigDir '${join(root, "config")}' -HomeDir '${join(root, "home")}' -Workspace '${join(root, "ws")}' -Ancestors '${root}' -ManagedDir '${join(root, "managed")}' -LspPlugin '${join(root, "plugin")}' -LspProbe '${FAKE_PROBE}'; exit $LASTEXITCODE`,
    ],
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const lines = new TextDecoder().decode(out.stdout).split(/\r?\n/).filter(Boolean);
  assertEquals(lines.length, 1, `one JSON line: ${lines.join(" | ")}`);
  return { code: out.code, rec: JSON.parse(lines[0]!) };
}

Deno.test({ name: "cg-inventory LSP: a declared LSP whose preflight passes is installed as lsp:al", ignore: IGNORE, async fn() {
  const r = await run({ lsp: ["al"] });
  assertEquals([r.code, r.rec.ok, r.rec.installed], [0, true, ["lsp:al"]]);
} });

Deno.test({ name: "cg-inventory LSP: a failed preflight, a missing plugin or an unknown name is refused", ignore: IGNORE, async fn() {
  const failed = await run({ lsp: ["al"] }, { rc: 3 });
  assertEquals([failed.code, failed.rec.ok], [5, false]);
  assert(failed.rec.problems.includes("lsp:al: preflight failed (exit 3)"));
  const missing = await run({ lsp: ["al"] }, { plugin: false });
  assert(missing.rec.problems.some((p: string) => p.startsWith("lsp:al: plugin missing at")));
  const unknown = await run({ lsp: ["pyright"] });
  assert(unknown.rec.problems.includes("unknown LSP component: pyright"));
} });

Deno.test({ name: "cg-inventory LSP: ENABLE_LSP_TOOL in an arm without LSP is refused; no settings file means the check is off (host tests)", ignore: IGNORE, async fn() {
  const leaked = await run({}, { enableTool: true });
  assertEquals([leaked.code, leaked.rec.ok], [5, false]);
  assert(leaked.rec.problems.includes("ENABLE_LSP_TOOL is set in an arm without LSP"));
  assertEquals((await run({})).rec.ok, true);
  assertEquals((await run(null, { enableTool: true })).rec.ok, true);
} });
```

Append to `tests/unit/harness/claude-code.test.ts` (uses M9-04's `v2`, `invLine`, `v2Init`, `v2Result`, `V2`, `B` helpers and imports `LSP_PLUGINS`, `pluginIs` from the adapter):

```ts
const CATALOG = {
  models: [{ slug: "anthropic/claude-sonnet-5", api_model_id: "claude-sonnet-5", family: "claude", display_name: "S5" }],
  pricing: [],
  families: [],
};

Deno.test("claude-code LSP: settings.lsp comes only from components.lsp; settings.lsp in a config is refused", () => {
  const base = {
    id: "cc",
    harness: "claude-code",
    harness_version: "2.1.282",
    models: { main: "anthropic/claude-sonnet-5" },
    limits: { timeout_min: 30, max_budget_usd: 5 },
  };
  assertEquals(claudeCodeAdapter.nativeSettings(HarnessConfigSchema.parse({ ...base, components: { lsp: ["al"] } }), CATALOG)["lsp"], ["al"]);
  assertEquals(claudeCodeAdapter.nativeSettings(HarnessConfigSchema.parse(base), CATALOG)["lsp"], undefined);
  assertThrows(
    () => claudeCodeAdapter.nativeSettings(HarnessConfigSchema.parse({ ...base, settings: { lsp: ["al"] } }), CATALOG),
    ConfigurationError,
    "settings.lsp is reserved",
  );
});

Deno.test("inventory LSP (M10): the real S1 init matches LSP_PLUGINS.al; M9's single check loads lsp:al only with preflight, plugin and tool", async () => {
  const real = JSON.parse(await Deno.readTextFile("tests/fixtures/harness/claude-code/lsp-init.json"));
  const plugin = real.plugins.filter((p: Record<string, unknown>) => pluginIs(p, LSP_PLUGINS.al!));
  assertEquals(plugin.length, 1, "the S1 init shows exactly one plugin matching LSP_PLUGINS.al");
  assert(real.tools.includes("LSP"));
  const builtins = B.plugins.map((s) => ({ name: s.split("@")[0], source: s }));
  const lspArm = {
    lsp: [{ name: "al", version: "al-lsp@1", tool_schema_hash: "a".repeat(64) }],
    settings: { requested: {}, native: { api_models: { main: "claude-sonnet-5" }, lsp: ["al"] } },
  };
  const installed = ["agents", "instructions", "lsp:al", "skills"];
  const ok = await v2([invLine({ installed }), v2Init({ tools: ["Agent", "LSP"], plugins: [...builtins, ...plugin] }), v2Result()], lspArm);
  assertEquals(ok.inventoryProblems, []);
  assert(ok.observed.loaded_components!.includes("lsp:al"));
  assert(!ok.unobservable.includes("lsp:al"));
  const noTool = await v2([invLine({ installed }), v2Init({ plugins: [...builtins, ...plugin] }), v2Result()], lspArm);
  assert(noTool.inventoryProblems!.some((p) => p.startsWith("lsp:al not loaded")));
  assert(!noTool.observed.loaded_components!.includes("lsp:al"));
  const noPreflight = await v2([invLine(), v2Init({ tools: ["Agent", "LSP"], plugins: [...builtins, ...plugin] }), v2Result()], lspArm);
  assert(noPreflight.inventoryProblems!.some((p) => p.includes("preflight missing")));
  const plainWithPlugin = await v2([invLine(), v2Init({ plugins: [...builtins, ...plugin] }), v2Result()]);
  assert(plainWithPlugin.inventoryProblems!.some((p) => p.startsWith("unrequested plugin loaded")));
  const plainWithTool = await v2([invLine(), v2Init({ tools: ["Agent", "LSP"] }), v2Result()]);
  assert(plainWithTool.inventoryProblems!.includes("unrequested LSP tool loaded"));
});

Deno.test("run.ps1 LSP (M10): the declared LSP adds --plugin-dir and the tool; other arms clear ENABLE_LSP_TOOL; all before the inventory", async () => {
  const run = await Deno.readTextFile("harness/images/claude-code/run.ps1");
  const code = run.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));
  const at = (s: string) => {
    const i = code.findIndex((l) => l.includes(s));
    assert(i >= 0, `run.ps1 lacks: ${s}`);
    return i;
  };
  const set = at("$env:ENABLE_LSP_TOOL = '1'");
  const clear = at("Remove-Item Env:\\ENABLE_LSP_TOOL -ErrorAction SilentlyContinue");
  at("$pluginArgs = @('--plugin-dir', 'C:\\cg-lsp\\al-language-server-go-windows')");
  const inv = at("& 'C:\\cg-inventory.ps1'");
  assert(set < inv && clear < inv, "the inventory sees the final LSP env");
  assert(at("$claudeArgs += $pluginArgs") > inv);
});
```

Append to `tests/unit/harness/execution.test.ts` (M9-05's `inventoriedEnv`, `INV`, `INIT`, `probeLines`, `sideOf`, `cellFor`, `write` helpers; import `AL_LSP_DEF`, `AL_LSP_SHIPPED`, `lspLabel` from images.ts and `BUILTIN_INVENTORY`, `LSP_PLUGINS` from the adapter):

```ts
Deno.test("component inventory + LSP (spec v2 gates 1 and 2): a declared, proven LSP completes; a missing tool or an undeclared plugin is setup_failed", async () => {
  const t = await inventoriedEnv();
  await Deno.mkdir(join(t.env.repoRoot, "harness", "images", "claude-code", "lsp"), { recursive: true });
  await Deno.copyFile(AL_LSP_DEF, join(t.env.repoRoot, AL_LSP_DEF));
  await write(
    t.harnessRoot,
    "configs/cc-v2-inv-lsp.yml",
    'id: cc-v2-inv-lsp\nharness: claude-code\nharness_version: "2.1.282"\nimage_revision: "3"\nmodels: { main: anthropic/claude-sonnet-5 }\nsettings: {}\ncomponents: { instructions: bundles/env/instructions, lsp: [al] }\nlimits: { timeout_min: 30, max_budget_usd: 5 }\n',
  );
  const imageId = `sha256:${"d".repeat(64)}`;
  const [lk, lv] = (await lspLabel(t.env.repoRoot))!;
  t.docker.addImage(imageTag("claude-code", "2.1.282", "3"), imageId, {
    "centralgauge.harness": "claude-code",
    "centralgauge.harness.version": "2.1.282",
    "centralgauge.harness.base_digest": `sha256:${"b".repeat(64)}`,
    "centralgauge.harness.revision": "3",
    [lk]: lv,
  });
  t.docker.shipFile(imageId, AL_LSP_SHIPPED, await Deno.readTextFile(AL_LSP_DEF));
  const builtins = BUILTIN_INVENTORY["2.1.282"]!.plugins.map((s) => ({ name: s.split("@")[0], source: s }));
  const pluginId = LSP_PLUGINS["al"]!;
  const lspPlugin = { name: pluginId.name, source: pluginId.source, ...(pluginId.path === null ? {} : { path: pluginId.path }) };
  const init = (tools: string[], plugins: unknown[]) => {
    const i = JSON.parse(INIT);
    return JSON.stringify({ ...i, tools: [...i.tools, ...tools], plugins: [...builtins, ...plugins] });
  };
  const cases: [string, string, string[], string | null][] = [
    ["proven", "cc-v2-inv-lsp", [INV({ installed: ["instructions", "lsp:al"] }), init(["LSP"], [lspPlugin])], null],
    ["no tool", "cc-v2-inv-lsp", [INV({ installed: ["instructions", "lsp:al"] }), init([], [lspPlugin])], "lsp:al not loaded"],
    ["undeclared plugin", "cc-v2-inv", [INV(), init([], [lspPlugin])], "unrequested plugin loaded"],
  ];
  for (const [name, cfg, pre, want] of cases) {
    const lines = [...pre, ...(await probeLines())];
    t.docker.behavior = async (_call, io) => {
      for (const l of lines) await io.stdout(l);
      return 0;
    };
    const e = (await runCell(t.env, await cellFor(t, cfg))).executions[0]!;
    if (want === null) {
      assertEquals(e.termination, "completed", name);
      assert(e.observed.loaded_components!.includes("lsp:al"), name);
      continue;
    }
    assertEquals(e.termination, "setup_failed", name);
    assertStringIncludes((await sideOf(t, e.id)).setup_error, want, name);
  }
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `deno test --allow-all tests/unit/harness/inventory-lsp.test.ts tests/unit/harness/claude-code.test.ts tests/unit/harness/execution.test.ts --filter "LSP"`
Expected: FAIL (no LSP section in cg-inventory, `LSP_PLUGINS.al` still holds M9's provisional values so the S1 init does not match, run.ps1 lines missing, LSP arm not loaded).

- [ ] **Step 4: Implement**

`cg-inventory.ps1`: add two parameters to M9's `param(...)` block:

```powershell
  [string]$LspPlugin = 'C:\cg-lsp\al-language-server-go-windows',
  [string]$LspProbe = 'C:\cg-lsp\lsp-probe.mjs'
```

and, before the line that computes `$installed`, add:

```powershell
# M10 (ruling 3): the LSP component. Declared in settings.lsp: the image's plugin must exist and
# its server must answer the preflight as this user, offline (no proxy is set yet). Not declared:
# ENABLE_LSP_TOOL must be unset. Without a settings file (M9's host tests) nothing is checked.
$lspInstalled = @()
$settingsPath = Join-Path $ConfigDir 'settings.json'
if (Test-Path -LiteralPath $settingsPath) {
  $s = (Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json).settings
  $lspDeclared = @()
  if ($null -ne $s -and $null -ne $s.PSObject.Properties['lsp']) { $lspDeclared = @($s.lsp) }
  foreach ($n in $lspDeclared) {
    if ($n -cne 'al') { $problems.Add("unknown LSP component: $n"); continue }
    if (-not (Test-Path -LiteralPath (Join-Path $LspPlugin '.lsp.json'))) { $problems.Add("lsp:al: plugin missing at $LspPlugin"); continue }
    & node $LspProbe --preflight
    if ($LASTEXITCODE -ne 0) { $problems.Add("lsp:al: preflight failed (exit $LASTEXITCODE)") } else { $lspInstalled += 'lsp:al' }
  }
  if ($lspDeclared.Count -eq 0 -and $env:ENABLE_LSP_TOOL) { $problems.Add('ENABLE_LSP_TOOL is set in an arm without LSP') }
}
```

and change M9's installed line to `$installed = @(@($owner.Values) + $lspInstalled | Sort-Object -Unique | Where-Object { -not $broken.ContainsKey($_) })`.

`run.ps1`: right after the `$mcpArgs = ...` line (so before M9's bundle copies and inventory call):

```powershell
# LSP component (settings.lsp, set only from components.lsp, M10): every arm's image ships the
# plugin; only an LSP arm passes it and turns the LSP tool on; every other arm clears an
# inherited ENABLE_LSP_TOOL. cg-inventory.ps1 proves both before any credential.
$pluginArgs = @()
if ($null -ne $cfg.settings.PSObject.Properties['lsp']) {
  $pluginArgs = @('--plugin-dir', 'C:\cg-lsp\al-language-server-go-windows')
  $env:ENABLE_LSP_TOOL = '1'
} else {
  Remove-Item Env:\ENABLE_LSP_TOOL -ErrorAction SilentlyContinue
}
```

and after `$claudeArgs += $mcpArgs` add `$claudeArgs += $pluginArgs`.

`src/harness/adapters/claude-code.ts`:

1. In `nativeSettings`, after the `mcp_tools` reservation:

```ts
    // run.ps1 and the inventory load the LSP from settings.lsp: only components.lsp (checked against the image) may set it.
    if (Object.hasOwn(config.settings, "lsp")) {
      throw new ConfigurationError(`${config.id}: settings.lsp is reserved; name LSP components under components.lsp`);
    }
```

and in its return after the `mcp` spread: `...(config.components.lsp.length > 0 ? { lsp: [...config.components.lsp].sort() } : {}),`.

2. `LSP_PLUGINS.al` values from Step 1 (the type, `pluginIs`, the allow-list loop, the exact installed set and the positive check are M9-04's and stay untouched):

```ts
export const LSP_PLUGINS: Readonly<
  Record<string, { name: string; source: string; path: string | null }>
> = {
  al: {
    name: "<S1 capture: plugins[].name>",
    source: "<S1 capture: plugins[].source>",
    path: <"S1 capture: plugins[].path" or null when init entries carry no path>,
  },
};
```

(M9-04's `unobservable` filter already keeps only `toolchain:` unconfirmable on inventoried images, so LSP needs no change there.)

Slug: if M9-08 merged `lsp: [al-lsp]`, change it to `lsp: [al]` in `harness/configs/cc-v2-plain-lsp.yml`, `harness/configs/cc-v2-realistic-lsp.yml`, and in M9-08's test lines `lsp: ["al-lsp"]` to `lsp: ["al"]`; nothing else in those files.

- [ ] **Step 5: Run the tests**

Run: `deno test --allow-all tests/unit/harness/inventory.test.ts tests/unit/harness/inventory-lsp.test.ts tests/unit/harness/claude-code.test.ts tests/unit/harness/execution.test.ts tests/unit/harness/adapter.test.ts tests/unit/harness/images.test.ts`
Expected: PASS, M9's inventory and adapter tests unchanged.

- [ ] **Step 6: Check, lint, format, commit**

```bash
deno check src/harness/adapters/claude-code.ts
deno lint src/harness tests/unit/harness tests/fixtures/harness/lsp
deno fmt src/harness/adapters/claude-code.ts tests/unit/harness/inventory-lsp.test.ts tests/unit/harness/claude-code.test.ts tests/unit/harness/execution.test.ts tests/fixtures/harness/lsp/fake-probe.mjs tests/fixtures/harness/claude-code/lsp-init.json
graphify update .
git add harness/images/claude-code/cg-inventory.ps1 harness/images/claude-code/run.ps1 src/harness/adapters/claude-code.ts harness/configs/cc-v2-plain-lsp.yml harness/configs/cc-v2-realistic-lsp.yml tests/unit/harness/inventory-lsp.test.ts tests/fixtures/harness/lsp/fake-probe.mjs tests/unit/harness/claude-code.test.ts tests/unit/harness/execution.test.ts tests/fixtures/harness/claude-code/lsp-init.json
git commit -m "feat(harness): LSP plugs into the component inventory: preflight, run.ps1 toggle, plugin identity from S1 (M10-06)"
```

**Acceptance:** a declared, proven LSP completes with `lsp:al` loaded through the real execution path; a missing tool, a failed preflight, an undeclared plugin, an undeclared LSP tool or a leaked `ENABLE_LSP_TOOL` is `setup_failed`.

---

### Task M10-07: LSP calls, shell audit and passive diagnostics in the trace (for M11)

**Lane:** lane-infra. **Deps:** S1 captures (LSP `tool_use` input field `operation`; the record that carries post-edit diagnostics). **May touch:** `src/harness/adapters/claude-trace.ts`, `src/harness/adapters/claude-code.ts` (parser string per ruling 2; passive-diagnostics count in `raw_usage`), `src/harness/trace.ts` (doc comment), `src/harness/trace-metrics.ts`, `tests/unit/harness/trace-metrics.test.ts`, `tests/unit/harness/claude-code.test.ts`, `tests/fixtures/harness/claude-code/lsp-diagnostics.jsonl` (new, from S1).

**Interfaces:**
- Produces (ruling 9, appendix section 5): tool `LSP` events carry `transport: "lsp:<operation>"` (`[A-Za-z]{1,40}`, else `lsp:invalid`); `CLAUDE_CAPABILITIES.trace_types` gains `"lsp_call"`; `TraceMetrics.lsp_calls: { total: number; by_op: Record<string, number> } | null` (null when the trace's `trace_types` lack `"lsp_call"`, i.e. a parser before @5: unobservable, never 0; `{ total: 0, by_op: {} }` when observable and none); `TraceMetrics.lsp_shell_calls: number | null` (null under the same condition; shell calls whose recorded command names the LSP install or its binaries, a best-effort regex audit; dropped commands are already counted in `unreplayable`); `raw_usage.lsp_passive_diagnostics: number | null` (count of stream records that deliver LSP diagnostics outside a tool call; null with a reason in `incomplete_reasons` when the arm has no LSP or S1 found them not in the stream).
- Parser (ruling 2): if `CLAUDE_CAPABILITIES.parser` is still `claude-code-trace@4` when this merges, set it to `@5` and own the pin test; if M9-04 already set `@5`, do not touch it or its test (M11-03 is withdrawn). Adding `"lsp_call"` to `trace_types` is part of @5 either way.
- Not here: classification rules for the `LSP` tool (rules@1 leaves it `unclassified`); M11 decides and bumps `RULES_VERSION`.

- [ ] **Step 1: Write the failing tests** (append to `tests/unit/harness/trace-metrics.test.ts`)

```ts
Deno.test("claudeTrace: an LSP call's transport is lsp:<operation>; a malformed operation is lsp:invalid", async () => {
  const recs = (await Deno.readTextFile(FIXTURE)).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const rec = recs.find((r) => r.type === "assistant" && r.message.content.some((c: { name?: string }) => c.name === "Read"));
  const use = rec.message.content.find((c: { name?: string }) => c.name === "Read");
  use.name = "LSP";
  use.input = { operation: "findReferences", filePath: "C:\\workspace\\Core\\src\\LeaseMath.Codeunit.al", line: 3, character: 24 };
  const lsp = () =>
    claudeTrace(lines(recs.map((r) => JSON.stringify(r)).join("\n")), FIXTURE, new Set()).events.find((e) => e.tool === "LSP");
  assertEquals(lsp()?.transport, "lsp:findReferences");
  use.input = { operation: "hover; rm -rf /", filePath: "x" };
  assertEquals(lsp()?.transport, "lsp:invalid");
  delete use.input.operation;
  assertEquals(lsp()?.transport, "lsp:invalid");
});

Deno.test("traceMetrics: LSP calls by operation (errors still counted); shell calls into the LSP install are audited", () => {
  const m = traceMetrics([
    call({ seq: 1, call_id: "a", tool: "LSP", transport: "lsp:hover", command: null }),
    call({ seq: 2, call_id: "b", tool: "LSP", transport: "lsp:hover", command: null }),
    call({ seq: 3, call_id: "c", tool: "LSP", transport: "lsp:findReferences", command: null, outcome: "error", error_class: "tool_error" }),
    call({ seq: 4, call_id: "d", command: "C:/cg-lsp/al-language-server-go-windows/bin/al-lsp-wrapper.exe --help" }),
    call({ seq: 5, call_id: "e", command: "C:\\cg-lsp\\dotnet\\dotnet.exe C:\\cg-lsp\\al\\bin\\Microsoft.Dynamics.Nav.CodeAnalysis.dll" }),
    call({ seq: 6, call_id: "f" }),
  ], { complete: true, trace_types: ["tool_call", "lsp_call"] });
  assertEquals(m.lsp_calls, { total: 3, by_op: { hover: 2, findReferences: 1 } });
  assertEquals([m.tool_calls, m.tool_errors, m.lsp_shell_calls], [6, 1, 2]);
  assertEquals(m.mcp_calls, {});
});

Deno.test("traceMetrics: LSP counts are null (unobservable), never 0, for a trace without the lsp_call capability", () => {
  const m = traceMetrics([call({ seq: 1, call_id: "a" })], { complete: true, trace_types: ["tool_call"] });
  assertEquals([m.lsp_calls, m.lsp_shell_calls], [null, null]);
  const none = traceMetrics([call({ seq: 1, call_id: "a" })], { complete: true, trace_types: ["tool_call", "lsp_call"] });
  assertEquals([none.lsp_calls, none.lsp_shell_calls], [{ total: 0, by_op: {} }, 0]);
});
```

Add `assertEquals([m.lsp_calls, m.lsp_shell_calls], [null, null]);` to the existing "traceMetrics: probe counts" test (its trace types are the @4 set), and assert in the existing capabilities test that `CLAUDE_CAPABILITIES.trace_types` includes `"lsp_call"`.

Append to `tests/unit/harness/claude-code.test.ts` (fixture = the S1 stub cell's raw stream lines from the first `Edit` result through the next assistant record, saved as `tests/fixtures/harness/claude-code/lsp-diagnostics.jsonl`; skip this test and set the field to null with reason `LSP diagnostics are not in the stream-json output (S1)` if S1 found none):

```ts
Deno.test("claude-code LSP: passive diagnostics after edits are counted separately; a plain arm reports null, never 0", async () => {
  const text = await Deno.readTextFile("tests/fixtures/harness/claude-code/lsp-diagnostics.jsonl");
  const lspArm = {
    lsp: [{ name: "al", version: "al-lsp@1", tool_schema_hash: "a".repeat(64) }],
    settings: { requested: {}, native: { lsp: ["al"] } },
  };
  const on = (await parse(text, 0, lspArm)).r;
  assert(((on.telemetry.raw_usage as { lsp_passive_diagnostics: number }).lsp_passive_diagnostics) >= 1);
  const off = (await parse(text, 0, { settings: { requested: {}, native: {} } })).r;
  assertEquals((off.telemetry.raw_usage as { lsp_passive_diagnostics: unknown }).lsp_passive_diagnostics, null);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `deno test --allow-all tests/unit/harness/trace-metrics.test.ts tests/unit/harness/claude-code.test.ts --filter "LSP|lsp"`
Expected: FAIL (transport `builtin`, fields undefined).

- [ ] **Step 3: Implement**

`src/harness/adapters/claude-trace.ts`, next to `transportOf`:

```ts
/** Claude Code's LSP tool (M10): transport lsp:<operation>; the operation is model input, so only a plain name passes. */
function lspTransport(op: unknown): string {
  return typeof op === "string" && /^[A-Za-z]{1,40}$/.test(op) ? `lsp:${op}` : "lsp:invalid";
}
```

and in `claudeTrace`'s `common` object replace `transport: transportOf(name),` with `transport: name === "LSP" ? lspTransport(input.operation) : transportOf(name),`.

`src/harness/trace.ts`: doc comment `/** builtin, mcp:<server>, lsp:<operation>, shell */`.

`src/harness/trace-metrics.ts`: add to `TraceMetrics` after `mcp_calls`:

```ts
  /**
   * LSP tool calls (transport lsp:<operation>, M10; ruling 9): total and per
   * operation, errors included. null when the trace's parser does not emit
   * the lsp_call capability (before claude-code-trace@5): never 0.
   */
  lsp_calls: { total: number; by_op: Record<string, number> } | null;
  /** Shell calls whose recorded command names the LSP install or binaries (best-effort M10 audit); null as lsp_calls. */
  lsp_shell_calls: number | null;
```

initialise `lsp_calls: has("lsp_call") ? { total: 0, by_op: {} } : null,` and `lsp_shell_calls: has("lsp_call") ? 0 : null,`; after the `mcp:` bump:

```ts
    if (m.lsp_calls !== null && e.transport?.startsWith("lsp:")) {
      m.lsp_calls.total++;
      bump(m.lsp_calls.by_op, e.transport.slice(4));
    }
    if (
      m.lsp_shell_calls !== null && e.transport === "shell" && e.command !== null &&
      /cg-lsp|al-lsp-wrapper|al-call-hierarchy|EditorServices|CodeAnalysis\.dll/i.test(e.command)
    ) m.lsp_shell_calls++;
```

In `src/harness/adapters/claude-code.ts`, add `"lsp_call"` to `CLAUDE_CAPABILITIES.trace_types` (documented there as "LSP tool calls carry transport lsp:<operation>").

`src/harness/adapters/claude-code.ts`: add a counter over the parsed records using the S1-captured shape, and put it in `raw_usage` after `component_inventory` (or `mcp_inventory` if M9 has not merged):

```ts
/**
 * LSP diagnostics Claude Code delivers outside a tool call after an edit (M10).
 * The record shape is the S1 capture (tests/fixtures/harness/claude-code/lsp-diagnostics.jsonl).
 */
function isLspDiagnostics(rec: J): boolean {
  // Implement as the exact match of the captured record: its `type`, and the
  // field/marker that carries the diagnostics, as named in the S1 report.
  return <S1 capture predicate>;
}
```

with `lsp_passive_diagnostics: input.manifest.lsp.length > 0 ? lines.filter((x) => isLspDiagnostics(x.rec)).length : null,` and, when null for an LSP arm because S1 found none, `incomplete_reasons["lsp_passive_diagnostics"] = "LSP diagnostics are not in the stream-json output (S1)"`. The predicate body is S1 data (the captured record), written as an exact match, never a loose text search.

Parser: apply ruling 2 as stated in Interfaces.

- [ ] **Step 4: Run the tests**

Run: `deno test --allow-all tests/unit/harness/trace-metrics.test.ts tests/unit/harness/claude-code.test.ts tests/unit/harness/claude-trace.test.ts tests/unit/harness/report.test.ts tests/unit/harness/campaign.test.ts`
Expected: PASS.

- [ ] **Step 5: Check, lint, format, commit**

```bash
deno check src/harness/adapters/claude-trace.ts src/harness/trace-metrics.ts src/harness/adapters/claude-code.ts
deno lint src/harness
deno fmt src/harness/adapters/claude-trace.ts src/harness/trace.ts src/harness/trace-metrics.ts src/harness/adapters/claude-code.ts tests/unit/harness/trace-metrics.test.ts tests/unit/harness/claude-code.test.ts
graphify update .
git add src/harness/adapters/claude-trace.ts src/harness/trace.ts src/harness/trace-metrics.ts src/harness/adapters/claude-code.ts tests/unit/harness/trace-metrics.test.ts tests/unit/harness/claude-code.test.ts tests/fixtures/harness/claude-code/lsp-diagnostics.jsonl
git commit -m "feat(harness): LSP calls per operation, shell audit of the LSP install, passive diagnostics count (M10-07)"
```

**Acceptance:** `lsp_calls` is `{ total, by_op } | null` (ruling 9) with errors counted; null, never 0, for a pre-@5 trace; hostile operations stored as `lsp:invalid`; off-arm shell use of the LSP files that the regex can see is counted; passive diagnostics a separate count or an explicit null with a reason.

---

### Task M10-08: Dev integration image and stub proofs

**Lane:** lane-ops. **Deps:** M10-04 to M10-07 and M9-02 to M9-05, M9-08, M9-16 merged to master. **Target:** 10-14. **May touch:** image store (dev tag only), stub-cell records, `H:\cg-coord\m10\**`. No credential.

- [ ] **Step 1: Build the dev image through the harness (tag unused; the revision label is the dev revision, appendix section 1)**

```bash
TAG=centralgauge/harness-claude-code:2.1.282-r3-dev-M10-08
if DOCKER_CONTEXT=desktop-windows docker image inspect $TAG >/dev/null 2>&1; then echo "[FAIL] $TAG exists"; exit 1; fi
deno task start harness images build claude-code --version 2.1.282 --revision 3-dev-M10-08
DOCKER_CONTEXT=desktop-windows docker image inspect -f '{{json .Config.Labels}}' $TAG
```

Expected: `[OK] install-lsp ...` and `[OK] cg-lockdown` in the build output; labels show `centralgauge.harness.revision` `3-dev-M10-08` and `centralgauge.lsp.al` equal to `lspLabel` (M10-05).

- [ ] **Step 2: Stub proofs** (record id, `loaded_components`, `component_inventory`, `lsp_calls`, termination for each)

1. `deno task start harness cell cc-v2-plain-lsp HX-001 --stub-provider scripts/harness/stub-scenarios/arm-lsp.json --image <dev id>`: expected not `setup_failed`; `lsp:al` loaded; one each of `lsp:documentSymbol`, `lsp:hover`, `lsp:findReferences`; the findReferences result names `LeaseMgt.Codeunit.al`; `lsp_passive_diagnostics` as S1 predicted.
2. `deno task start harness cell cc-v2-plain HX-001 --stub-provider scripts/harness/stub-scenarios/arm-lsp.json --image <dev id>`: expected not `setup_failed`, no `lsp:al`, the scripted LSP calls end as errors, `lsp_calls` counts them as errors.
3. Refusal on a frozen image: `deno task start harness cell cc-v2-plain-lsp HX-001 --stub-provider scripts/harness/stub-scenarios/arm-lsp.json --image <r2 image id>`: refused before any sandbox (revision or `has no LSP component al`).
4. Leak check: a stub cell of `cc-v2-plain` with `-e ENABLE_LSP_TOOL=1` is not possible through the CLI (non-secret env is harness-controlled); instead confirm in cell 2's `component_inventory` that the inventory ran with the env cleared (no `ENABLE_LSP_TOOL` problem) and rely on the M10-06 host test for the refusal.

- [ ] **Step 3: Report** in `H:\cg-coord\m10\dev-proofs.md` (dev image id, the four results). Dev records are developmental and never enter a confirmatory result.

**Acceptance:** positive, negative and refusal proven through real Claude Code on the dev image.

---

### Task M10-09: Final r3 verification, real cells, startup and memory

**Lane:** lane-ops. **Deps:** M10-08; M9-17 Step 2, the one campaign build of `centralgauge/harness-claude-code:2.1.282-r3` (ruling 1; built 10-18 after M9 and M10 merged and M10-08 green; this task never builds it). **Target:** 10-19 to 10-21. **May touch:** results records, `H:\cg-coord\m10\**`. Kill only PIDs you started.

- [ ] **Step 1: Verify the LSP parts of r3**

```bash
DOCKER_CONTEXT=desktop-windows docker image inspect -f '{{json .Config.Labels}}' centralgauge/harness-claude-code:2.1.282-r3
DOCKER_CONTEXT=desktop-windows docker run --rm --isolation hyperv --user ContainerUser centralgauge/harness-claude-code:2.1.282-r3 powershell -NoProfile -Command '& C:\cg-lockdown.ps1 -VerifyOnly C:\cg-lsp; exit $LASTEXITCODE'
DOCKER_CONTEXT=desktop-windows docker run --rm --isolation hyperv --network none --user ContainerUser --mount type=bind,source=<S1 staged workspace>,target=C:\workspace centralgauge/harness-claude-code:2.1.282-r3 powershell -NoProfile -Command 'node C:\cg-lsp\lsp-probe.mjs --preflight; exit $LASTEXITCODE'
```

Expected: `centralgauge.lsp.al` equals the repo's `lspLabel` value and `centralgauge.harness.revision` is `3`; lockdown exit 0; preflight exit 0 with its ms.

- [ ] **Step 2: Two real cells with memory sampling**

One real cell per arm on HX-001 (`cc-v2-plain-lsp`, then `cc-v2-plain`), concurrency 1. Verify the model first: `deno task start models anthropic/claude-sonnet-5 --check` (M12 sets the campaign model). Without `--supervised` only if the egress-qualified marker lets `cellGate` pass; otherwise the owner runs the command in their terminal (no TTY in agent shells) and lane-ops verifies. During each cell a host loop you started samples `docker stats --no-stream` for the sandbox container every 2 s (record its PID; stop it by PID). Record per cell: preflight ms (cell stderr), Claude Code `duration_ms`, `lsp_calls`, `lsp_shell_calls`, `lsp_passive_diagnostics`, peak memory, termination, `confirmedGone`.

- [ ] **Step 3: Report** to `H:\cg-coord\m10\live-proofs.md`, with the per-cell memory for M7 (gate 5) and the preflight ms for M11 (host wall time includes it; Claude Code's `duration_ms` does not).

**Acceptance (component done, 2026-10-21; M8-15b needs it on 10-25):** r3's LSP label, lockdown and offline preflight verified; one real LSP cell with `lsp:al` loaded and LSP calls counted; one real plain cell without; memory and startup recorded.

---

## Review responses (round 1, `H:\cg-coord\reviews\PLANS-v2-001\review-m10.md`)

1. M9 integration (blocking): accepted. M10-06 now plugs into M9's inventory (ruling 3). The preflight runs inside `cg-inventory.ps1` and reports `lsp:al` as installed. The declared plugin passes M9's allow-list through `LSP_PLUGIN_SOURCES`. A positive check sits in `componentInventory`, plus a combined execution test (proven / missing tool / undeclared plugin). The Dockerfile keeps M9's `cg-inventory.ps1` copy and lockdown. The `al-lsp` slug patch is in M10-06's touch list.
2. Image revisions: accepted per ruling 1. There is one campaign r3 built after M9 and M10 merge. S1 and the proofs use `-r3-dev-M10-02` / `-r3-dev-M10-08`, and r3 is never overwritten. The stub `--image` now feeds `runtimeFacts`, so dev proofs need no campaign tag.
3. Probe cleanup: accepted. The probe kills the process tree on every exit path (CIM table, `taskkill /T /F`) and awaits exit within a bound after `exit`. It fails if any pre-shutdown descendant survives. Tests cover an ignored `exit` and an orphaned grandchild. S1 Step 7 kills only after the AL host is shown alive (the probe reaches the `hold` step and the host process is listed).
4. Falsifiable S1: accepted. Steps carry `expect` (symbol names, hover identity, normalized reference set, workspace symbols), and a wrong answer exits 6. Diagnostics are version-correlated and settled. Tests cover a stale older version (ignored) and a late unversioned stale publish (timeout, never a pass). Container commands end with the probe's exit code.
5. Measurement and isolation: accepted. S1 now has explicit bounds. Memory is measured inside the VM as guest-wide use against guest total, by concurrent samplers, including Claude Code plus LSP in the stub cell. Network use is attributed per process with `--network none` as the functional proof. Isolation adds a mounts audit, a hash audit against the task's hidden files and solutions, and an out-of-workspace canary that separates "absent" from "not indexed".
6. Toggle: partly accepted. The treatment is now defined as "Claude Code LSP integration enabled". Off arms clear `ENABLE_LSP_TOOL` and the inventory refuses a leak. Stripping is extended to the compiler DLLs and verified by a file search plus a failed `dotnet alc.dll`, not by PATH. Not adopted: preventing off-arm shell access to the files. That would need a second image or per-arm ACLs, and the reviewer agrees one image is right. Instead every such shell call is counted (`lsp_shell_calls`) and reported per arm, so a contaminated off-arm cell is visible.
7. Pins and policy: accepted, with one limit. `al-lsp.json` pins the wrapper zip plus per-exe hashes, the AL extension (hash of the downloaded bytes, gunzipped by the installer when needed), the .NET patch, empty `initializationOptions` and `settings`, the stripped-file list and the sidecar diagnostics policy (frozen at M10-03). The lineage block records both CodeAnalysis versions and hashes; the extension side is checked at build and the backend side changes the label. Matching compiler lineage is the preferred option (candidate B), and backend builds stay authoritative. Symbol packages remain pinned by the existing `symbols.lock.json`. Not done: M10 does not install or pin the backend compiler itself, because the cg-al backend owns it. Its version and hash are recorded here so a change forces a new definition.
- Trace and fallback notes: passive diagnostics now get their own field (`lsp_passive_diagnostics`, null with a reason when not observable). M10-03 requires S1 reruns after fixes and forbids waiving ContainerUser, offline operation, oracle isolation or cleanup. Option (d) requires revised claims and power analysis before screening.

## Open questions

1. AL extension version: candidate B (CodeAnalysis matches the backend) if S1 finds one on the marketplace, else 18.0.2732683 with disagreements listed. Decided at M10-03 from S1 data. The orchestrator confirms or asks the owner.
2. Sidecar code-quality diagnostics on (owner's local behaviour, default) or off: frozen at M10-03 from the S1 code list.
3. (Answered in round 3, appendix section 3: M9-04 implements the allow-list, the exact installed set and the single positive check; M10-06 sets only `LSP_PLUGINS.al` values and the inventory preflight.)
4. Passive diagnostics: whether Claude Code 2.1.282 puts them in stream-json at all (S1 Step 6). If not, M11 reports LSP influence as tool calls plus the explicit null.

## Risks

- Guest memory: seven source apps plus the Microsoft symbols, with Claude Code in the same Hyper-V VM. A `--memory` decision affects M7 concurrency.
- Startup: the wrapper waits up to 2 minutes for the project closure. The bounds may fail and push a decision to M10-03.
- M9 coupling: M10-06 cannot merge before M9-04 and M9-05, and both plans edit run.ps1, the inventory and the adapter. The 2026-10-21 date holds only if M9-04/05 land by 2026-10-12 and M9-17 builds r3 on 10-18.
- Diagnostic disagreement between the LSP's AL version and the backend if no matching extension exists.
- Read-only `C:\cg-lsp` vs files the AL host writes into its own `bin`.
- LSP calls are `unclassified` under rules@1 until M11 adds a rule.

## Self-review notes

- Spec coverage: section 5 S1 items map to M10-02 Steps 4 to 8 with bounds. Licensing is ruling 7 plus spec 13. 8.2 is M10-03. Section 10 (image, runtimeFacts, run.ps1) is M10-04 to M10-06. Section 4 fail-closed presence and absence is M10-06 plus M10-08. Section 6 LSP counts and missing-never-zero is M10-07. Section 12 item 3 (S1 before screening) is the 2026-10-08 gate.
- Type and name consistency: `lspLabel` returns `[string, string] | null` everywhere. `serverDefinitions(root, { mcp, lsp })` matches both callers. `LSP_PLUGINS.al` (`name`, `source`, `path | null`), the plugin dir `C:\cg-lsp\al-language-server-go-windows` and `plugin_json.name` agree. `lsp:al` is the installed name in `cg_inventory`, the loaded component and the manifest component. The probe exit codes (0/2/3/4/6) match the tests. Round 3: every cross-plan name here is checked against the appendix.

## Review responses (round 2, `H:\cg-coord\reviews\PLANS-v2-002\review-m10.md`)

| Finding | Response | Where |
| --- | --- | --- |
| 1 PARTLY: `lsp:al` in `installed` breaks M9's exact set; adapter snippets use `init.plugins/tools` on a `Line`; replace M9's check rather than append | Accepted. Appendix section 3: M9-04's exact set includes `lsp:<name>`, and M9-04 holds the ONE positive check (preflight, plugin, tool) with the shared problem string. M10-06 no longer touches `componentInventory`; it sets `LSP_PLUGINS.al` values from S1 and adds the inventory preflight and run.ps1 toggle. `LSP_PLUGIN_SOURCES` is withdrawn. | M10-06, Architecture |
| 3 PARTLY: CIM/taskkill without deadlines; PID reuse tolerated | Accepted. Every CIM and kill call has the `CIM_MS` deadline; processes are identified by PID plus creation time and killed only after re-checking that identity (`killProc`, `Stop-Process`); the fallback kills the root through its handle. | M10-01 |
| 4 PARTLY: unversioned settling is not correlation | Accepted, guarantee narrowed: after an edit an unversioned publish fails the step (6) instead of settling; S1 records whether the AL server versions diagnostics, and M10-03 decides if it does not. | M10-01, Review Focus 3 |
| 6 PARTLY: regex audit cannot support "every such call"; pre-register contamination reporting without outcome-dependent exclusions | Accepted. Treatment definition and acceptance state a best-effort audit; the appendix (section 5) and M11-16 pre-register `lsp_shell_calls` as an exploratory per-arm count with no exclusion or rerun. | Treatment definition, M10-07, appendix |
| 7 PARTLY: backend lineage drift needs an external gate | Accepted. The gate is M11-17b (stage B): lane-ops records each Cronus281-283 backend `Microsoft.Dynamics.Nav.CodeAnalysis.dll` sha256 and compares it with `al-lsp.json` `lineage.backend.sha256`; a mismatch stops stage B and goes to the owner (a definition change means a new image, which ruling 1 forbids without an owner decision). | M11-17b, appendix section 10 |
| New High: trace contract is a bare dictionary, not ruling 9's `{ total, by_op } \| null` | Accepted. `lsp_calls: { total, by_op } \| null` and `lsp_shell_calls: number \| null`, null via the new `lsp_call` capability; tests for both shapes and for null. | M10-07 |
| New High: orphan test counts its own inspector | Accepted. `withMarker` excludes `$PID`. | M10-01 |
| New High: recipes do not stop on an existing tag; bash expands `$LASTEXITCODE`; nested quotes in the sampler | Accepted. Guards `exit 1`; container commands use single quotes or `-File`; the sampler is a script file run with `-File`; M10-08 builds through `harness images build --revision 3-dev-M10-08` so labels are right. | M10-02, M10-08, M10-09, Global Constraints |
| Dev revisions in configs (M9 review finding 4) | Accepted. Probe configs may name `3-dev-*`, experiments may not (M9-16); Global Constraints corrected. | Global Constraints |
| (none rejected) | | |

## Round 3 changes

1. Header links the shared interfaces appendix; rulings path PLANS-v2-002.
2. M10-06 reduced to the inventory preflight, run.ps1 toggle, `settings.lsp` and `LSP_PLUGINS.al` values; M9-04 owns the exact set and the single positive check.
3. M10-07 trace shape per ruling 9 with a `lsp_call` capability; null never 0.
4. M10-01: bounded CIM/kill calls, PID plus creation-time identity, unversioned diagnostics refused after edits, inspector excluded from the orphan count.
5. Recipes: build guards exit, single-quoted or `-File` PowerShell, sampler script file, dev build through the harness CLI.
6. Dates: M10-05 10-10..11; M10-09 10-19..21 after M9-17 Step 2 (was dated before the r3 it needs); component done 10-21.
7. Treatment definition narrowed to an integration-enabled treatment with a best-effort, pre-registered, non-excluding shell audit; backend lineage gate assigned to M11-17b.
- S1-supplied values (hashes, versions, lineage, plugin source string, passive-diagnostics record shape, tool line base) are marked as S1 data, and the tests that consume them fail until real values are filled in.
