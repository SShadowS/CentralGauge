# Phase H — Status CLI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `centralgauge status` — the operator's daily-driver CLI surface that prints a per-model lifecycle matrix (BENCHED / DEBUGGED / ANALYZED / PUBLISHED), highlights tool-version drift, and emits next-action hints with copy-pasteable commands. Provides a `--json` output validated by zod for Phase G's CI workflow consumption.

**Architecture:** Cliffy command in `cli/commands/status-command.ts` calls a signed GET on `/api/v1/admin/lifecycle/state` (added in Phase A) using the canonical signed-headers triple (`X-CG-Signature`, `X-CG-Key-Id`, `X-CG-Signed-At`) — Plan A defines this endpoint as **GET-only** with header signature, never POST-with-body. State rows feed a pure renderer in `src/lifecycle/status-renderer.ts` that emits an 80-col ANSI table with `OK` / `--` / `...` symbols, plus a hint generator that switch-tables current-state × missing-step into exact-command suggestions. `--legacy` controls **display only** of pre-P6 sentinel rows in a separate section; the `--json` output **always** includes a `legacy_rows` partition (so CI consumers like Plan G's `weekly-cycle.yml` can see pre-P6 entries without passing `--legacy`).

**Tech Stack:** Deno + Cliffy (`@cliffy/command`), `@std/fmt/colors` (CLAUDE.md mandates over emoji), zod (JSON schema validation for `--json`), the existing `src/ingest/sign.ts` (`signPayload` returns `{ alg, key_id, signed_at, value }` — header names are `X-CG-Signature`/`X-CG-Key-Id`/`X-CG-Signed-At`), and `src/lifecycle/event-log.ts` from Phase A as the underlying transport (the H command can call `currentState()` from A3 directly rather than re-implementing the GET).

**Depends on:** Phase A (event log + `/api/v1/admin/lifecycle/state` endpoint + `v_lifecycle_state` view), Phase B (slug migration so the matrix uses production slugs everywhere; the `PRE_P6_TASK_SET_SENTINEL` constant — exported from `src/lifecycle/types.ts` per Plan B's H-driven update — names the `pre-p6-unknown` sentinel; H imports it rather than hardcoding the literal).

**Strategic context:** See `docs/superpowers/plans/2026-04-29-model-lifecycle-event-sourcing.md` Phase H. Read the design rationale "CLI status + web admin dashboard, not just CLI" — both surfaces exist; this plan implements the CLI half. The `--json` schema is the contract Phase G's `weekly-cycle.yml` consumes via shell loop.

---

## H0 — Prerequisites + scaffolding

- [ ] **H0.1** — Confirm Phase A's `/api/v1/admin/lifecycle/state` endpoint returns rows in the shape this plan consumes. The endpoint is **GET-only** with signed headers (`X-CG-Signature`, `X-CG-Key-Id`, `X-CG-Signed-At`); no POST body. Field names below mirror the `v_lifecycle_state` view that Plan A defines:

  ```json
  {
    "rows": [
      {
        "model_slug": "anthropic/claude-opus-4-7",
        "task_set_hash": "abc123...",
        "step": "bench" | "debug" | "analyze" | "publish" | "cycle",
        "last_ts": 1714000000000,
        "last_event_id": 42,
        "last_event_type": "bench.completed",
        "last_payload_hash": "deadbeef...",
        "last_envelope_json": "{\"git_sha\":\"...\",\"deno\":\"1.46.3\",\"task_set_hash\":\"abc123...\"}"
      }
    ],
    "as_of_ts": 1714999999999
  }
  ```

  If Phase A's contract diverges (POST instead of GET, or different field names from `v_lifecycle_state`), file the gap before starting H1.

- [ ] **H0.1b** — Confirm `--task-set <hash|current>` semantics with Plan C. Plan C's `cycle --task-set` flag accepts the same values; both `current` defaults must resolve to the SAME hash — the row in `task_sets` where `is_current=1`. Verify by running both commands against staging:

  ```bash
  centralgauge status --task-set current --json | jq '.rows[0].task_set_hash'
  centralgauge cycle --llms anthropic/claude-opus-4-7 --task-set current --dry-run | grep task_set_hash
  ```

  Both should print the same hash. If they differ, one command resolves `current` server-side (correct) and the other resolves it client-side from a stale config (bug — fix before merge).

- [ ] **H0.2** — Create the empty source files so the rest of the plan can wire them together:

  - `U:\Git\CentralGauge\cli\commands\status-command.ts`
  - `U:\Git\CentralGauge\src\lifecycle\status-renderer.ts`
  - `U:\Git\CentralGauge\src\lifecycle\status-types.ts`
  - `U:\Git\CentralGauge\src\lifecycle\status-hints.ts`
  - `U:\Git\CentralGauge\tests\unit\lifecycle\status-renderer.test.ts`
  - `U:\Git\CentralGauge\tests\unit\lifecycle\status-hints.test.ts`
  - `U:\Git\CentralGauge\tests\unit\cli\status-command.test.ts`

- [ ] **H0.3** — Confirm `PRE_P6_TASK_SET_SENTINEL` is exported from `src/lifecycle/types.ts`. Plan B's `scripts/backfill-lifecycle.ts` originally owned the literal `"pre-p6-unknown"`; per the cross-plan audit it has been promoted to a shared constant in `src/lifecycle/types.ts` so H, G, and the backfill script all import the single source of truth. If the constant is not yet exported when this plan executes, Plan B's update is the prerequisite — file the gap before H1. H code never hardcodes the literal.

---

## H1 — `centralgauge status` command (`cli/commands/status-command.ts`)

- [ ] **H1.1** — Define the typed options surface and the registration function:

  ```typescript
  /**
   * Status command: per-model lifecycle matrix + next-action hints.
   * @module cli/commands/status
   */
  import { Command } from "@cliffy/command";
  import * as colors from "@std/fmt/colors";
  import type { IngestCliFlags } from "../../src/ingest/config.ts";
  import { loadIngestConfig, readPrivateKey } from "../../src/ingest/config.ts";
  import { signPayload } from "../../src/ingest/sign.ts";
  import { renderMatrix } from "../../src/lifecycle/status-renderer.ts";
  import { generateHints } from "../../src/lifecycle/status-hints.ts";
  import { PRE_P6_TASK_SET_SENTINEL } from "../../src/lifecycle/types.ts";
  import {
    StateResponseSchema,
    StatusJsonOutputSchema,
    type StateRow,
    type StatusJsonOutput,
  } from "../../src/lifecycle/status-types.ts";

  interface StatusOptions {
    model?: string;
    taskSet?: string;
    json?: boolean;
    legacy?: boolean;
    url?: string;
    keyPath?: string;
    keyId?: number;
    machineId?: string;
    adminKeyPath?: string;
    adminKeyId?: number;
  }

  /**
   * Fetches `/api/v1/admin/lifecycle/state` via a signed GET.
   *
   * Plan A defines this endpoint as GET-only with the canonical signed-headers
   * triple (`X-CG-Signature` / `X-CG-Key-Id` / `X-CG-Signed-At`); query
   * filtering is via URL query params, NOT a request body. We sign an empty
   * canonical payload (matches `queryEvents` from `src/lifecycle/event-log.ts`
   * — A3) and put `model` / `task_set` on the URL.
   */
  async function fetchState(
    options: StatusOptions,
  ): Promise<StateRow[]> {
    const flags: IngestCliFlags = {};
    if (options.url !== undefined) flags.url = options.url;
    if (options.keyPath !== undefined) flags.keyPath = options.keyPath;
    if (options.keyId !== undefined) flags.keyId = options.keyId;
    if (options.machineId !== undefined) flags.machineId = options.machineId;
    if (options.adminKeyPath !== undefined) flags.adminKeyPath = options.adminKeyPath;
    if (options.adminKeyId !== undefined) flags.adminKeyId = options.adminKeyId;

    const cwd = Deno.cwd();
    const config = await loadIngestConfig(cwd, flags);
    if (config.adminKeyId == null || !config.adminKeyPath) {
      throw new Error(
        "admin_key_id + admin_key_path required (via .centralgauge.yml or " +
          "--admin-key-path/--admin-key-id flags) for status",
      );
    }
    const adminPriv = await readPrivateKey(config.adminKeyPath);
    // Sign an empty payload — the filters travel as query parameters, not as
    // a signed body. Matches Plan A's `queryEvents` reference implementation.
    const sig = await signPayload({}, adminPriv, config.adminKeyId);

    const params = new URLSearchParams();
    if (options.model) params.set("model", options.model);
    if (options.taskSet) params.set("task_set", options.taskSet);
    const qs = params.toString();
    const url = `${config.url}/api/v1/admin/lifecycle/state${qs ? "?" + qs : ""}`;

    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "X-CG-Signature": sig.value,
        "X-CG-Key-Id": String(sig.key_id),
        "X-CG-Signed-At": sig.signed_at,
      },
    });
    if (!resp.ok) {
      throw new Error(`status fetch failed: HTTP ${resp.status}`);
    }
    const body = await resp.json();
    const parsed = StateResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(
        `status response did not match schema: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
      );
    }
    return parsed.data.rows;
  }

  /**
   * Always returns BOTH partitions (current + legacy). The `--legacy` flag
   * controls human-readable display only; the `--json` output ALWAYS
   * includes the `legacy_rows` partition so CI consumers (Plan G's
   * `weekly-cycle.yml`) can see pre-P6 entries without passing `--legacy`.
   * The sentinel literal is imported from `src/lifecycle/types.ts` as
   * `PRE_P6_TASK_SET_SENTINEL`, never hardcoded.
   */
  function partitionRows(
    rows: StateRow[],
  ): { current: StateRow[]; legacy: StateRow[] } {
    const c: StateRow[] = [];
    const l: StateRow[] = [];
    for (const r of rows) {
      if (r.task_set_hash === PRE_P6_TASK_SET_SENTINEL) {
        l.push(r);
      } else {
        c.push(r);
      }
    }
    return { current: c, legacy: l };
  }

  async function handleStatus(options: StatusOptions): Promise<void> {
    const rows = await fetchState(options);
    const { current, legacy } = partitionRows(rows);

    if (options.json) {
      // --json ALWAYS includes legacy_rows regardless of --legacy. CI
      // consumers can see pre-P6 entries without passing the flag.
      const output: StatusJsonOutput = {
        as_of_ts: Date.now(),
        rows: current,
        legacy_rows: legacy,
        hints: generateHints(current),
      };
      // Self-validate before printing — catches drift between renderer and schema.
      const verified = StatusJsonOutputSchema.parse(output);
      console.log(JSON.stringify(verified, null, 2));
      return;
    }

    const matrix = renderMatrix(current, { color: true });
    console.log(matrix);

    const hints = generateHints(current);
    if (hints.length > 0) {
      console.log("");
      console.log(colors.bold("Next actions:"));
      for (const h of hints) {
        console.log(`  ${colors.gray("•")} ${h.text}`);
        console.log(`    ${colors.cyan(h.command)}`);
      }
    }

    if (options.legacy && legacy.length > 0) {
      console.log("");
      console.log(colors.dim("Legacy rows (pre-P6 task_set_hash unknown):"));
      console.log(renderMatrix(legacy, { color: true, dim: true }));
    }
  }

  export function registerStatusCommand(cli: Command): void {
    cli.command("status", "Show per-model lifecycle matrix and next-action hints")
      .option("--model <slug:string>", "Filter to a single model slug")
      .option(
        "--task-set <hashOrCurrent:string>",
        "Task set hash or 'current' (default)",
        { default: "current" },
      )
      .option("--json", "Emit machine-readable JSON (validated against zod schema)", { default: false })
      .option("--legacy", "Include pre-P6 sentinel rows in a separate section", { default: false })
      .option("--url <url:string>", "Override ingest URL")
      .option("--key-path <path:string>", "Path to ingest signing key")
      .option("--key-id <id:number>", "Ingest key id")
      .option("--machine-id <id:string>", "Machine id override")
      .option("--admin-key-path <path:string>", "Path to admin signing key")
      .option("--admin-key-id <id:number>", "Admin key id")
      .example("Full matrix", "centralgauge status")
      .example("Filter to one model", "centralgauge status --model anthropic/claude-opus-4-7")
      .example("CI-friendly output", "centralgauge status --json")
      .example("Include legacy rows", "centralgauge status --legacy")
      .action(async (options: StatusOptions) => {
        try {
          await handleStatus(options);
        } catch (err) {
          console.error(colors.red("[FAIL]"), err instanceof Error ? err.message : String(err));
          Deno.exit(1);
        }
      });
  }
  ```

- [ ] **H1.2** — Register the command. Edit `U:\Git\CentralGauge\cli\commands\mod.ts`:

  ```typescript
  export { registerStatusCommand } from "./status-command.ts";
  ```

  Edit `U:\Git\CentralGauge\cli\centralgauge.ts` to import and register:

  ```typescript
  import {
    // ... existing imports
    registerStatusCommand,
  } from "./commands/mod.ts";

  // ... after registerSyncCatalogCommand(cliAny);
  registerStatusCommand(cliAny);
  ```

- [ ] **H1.3** — Update `.serena/project.yml` if it lists registered commands (it tracks documented surfaces). Add `status` to the command index.

---

## H2 — Matrix renderer (`src/lifecycle/status-renderer.ts`)

- [ ] **H2.1** — Define the renderer types in `src/lifecycle/status-types.ts`:

  ```typescript
  /**
   * Type contracts shared across the status command, the renderer, the hint
   * generator, and the JSON output schema. zod-validated end-to-end so the
   * --json contract Phase G's CI consumes is enforced at runtime.
   *
   * @module src/lifecycle/status-types
   */
  import { z } from "zod";

  export const StepSchema = z.enum(["bench", "debug", "analyze", "publish", "cycle"]);
  export type Step = z.infer<typeof StepSchema>;

  export const StateRowSchema = z.object({
    model_slug: z.string(),
    task_set_hash: z.string(),
    step: StepSchema,
    last_ts: z.number().int(),
    last_event_id: z.number().int(),
    last_event_type: z.string(),
    last_payload_hash: z.string().nullable(),
    last_envelope_json: z.string().nullable(),
  });
  export type StateRow = z.infer<typeof StateRowSchema>;

  export const StateResponseSchema = z.object({
    rows: z.array(StateRowSchema),
    as_of_ts: z.number().int(),
  });

  export const HintSchema = z.object({
    model_slug: z.string(),
    severity: z.enum(["info", "warn", "error"]),
    text: z.string(),
    command: z.string(),
  });
  export type Hint = z.infer<typeof HintSchema>;

  export const StatusJsonOutputSchema = z.object({
    as_of_ts: z.number().int(),
    rows: z.array(StateRowSchema),
    legacy_rows: z.array(StateRowSchema),
    hints: z.array(HintSchema),
  });
  export type StatusJsonOutput = z.infer<typeof StatusJsonOutputSchema>;
  ```

- [ ] **H2.2** — Implement the renderer in `src/lifecycle/status-renderer.ts`. It consumes `StateRow[]` and emits an 80-col-fit ANSI string. Per CLAUDE.md, use `@std/fmt/colors` not emoji.

  ```typescript
  /**
   * Status matrix renderer. Pure function — produces a string from rows.
   *
   * Symbols (no emoji per CLAUDE.md):
   *   OK   green   — recent completion, envelope unchanged
   *   ...  yellow  — in-progress (started, no terminal pair) OR stale
   *   --   gray    — no event for this step
   *
   * 80-column constraint: model column is 32 chars max (truncated with
   * ellipsis), each step column is 6 chars including padding. Five columns
   * (model + 4 steps) → 32 + 4*8 + separators ≈ 70 chars, leaving slack
   * for terminals < 80.
   *
   * @module src/lifecycle/status-renderer
   */
  import * as colors from "@std/fmt/colors";
  import type { StateRow, Step } from "./status-types.ts";

  export interface RenderOptions {
    color?: boolean;
    dim?: boolean;
  }

  const DISPLAY_STEPS: Step[] = ["bench", "debug", "analyze", "publish"];
  const STALE_DAYS = 14;
  const MODEL_COL_WIDTH = 32;
  const STEP_COL_WIDTH = 8;

  interface CellSummary {
    sym: string;
    state: "ok" | "stale" | "in_progress" | "missing";
    age_days: number | null;
  }

  function summarizeCell(row: StateRow | undefined): CellSummary {
    if (!row) return { sym: "--", state: "missing", age_days: null };
    const ageDays = (Date.now() - row.last_ts) / (1000 * 60 * 60 * 24);
    if (row.last_event_type.endsWith(".started")) {
      return { sym: "...", state: "in_progress", age_days: ageDays };
    }
    if (ageDays > STALE_DAYS) {
      return { sym: "...", state: "stale", age_days: ageDays };
    }
    return { sym: "OK", state: "ok", age_days: ageDays };
  }

  function colorize(
    text: string,
    state: CellSummary["state"],
    color: boolean,
  ): string {
    if (!color) return text;
    switch (state) {
      case "ok":          return colors.green(text);
      case "stale":       return colors.yellow(text);
      case "in_progress": return colors.yellow(text);
      case "missing":     return colors.gray(text);
    }
  }

  function truncate(s: string, width: number): string {
    if (s.length <= width) return s.padEnd(width);
    return s.slice(0, width - 1) + "…";
  }

  function center(s: string, width: number): string {
    const pad = width - s.length;
    if (pad <= 0) return s;
    const left = Math.floor(pad / 2);
    const right = pad - left;
    return " ".repeat(left) + s + " ".repeat(right);
  }

  /**
   * Group rows by model_slug, then by step. Each (model, step) keeps the
   * single row with the highest last_event_id (the v_lifecycle_state view
   * already returns one per group, but we re-collapse defensively).
   */
  function groupRows(
    rows: StateRow[],
  ): Map<string, Map<Step, StateRow>> {
    const out = new Map<string, Map<Step, StateRow>>();
    for (const r of rows) {
      const inner = out.get(r.model_slug) ?? new Map<Step, StateRow>();
      const prev = inner.get(r.step);
      if (!prev || r.last_event_id > prev.last_event_id) {
        inner.set(r.step, r);
      }
      out.set(r.model_slug, inner);
    }
    return out;
  }

  export function renderMatrix(
    rows: StateRow[],
    opts: RenderOptions = {},
  ): string {
    const color = opts.color ?? true;
    const grouped = groupRows(rows);
    const models = Array.from(grouped.keys()).sort();

    const lines: string[] = [];

    // Header
    const header = [
      "MODEL".padEnd(MODEL_COL_WIDTH),
      ...DISPLAY_STEPS.map((s) =>
        center(s.toUpperCase().slice(0, STEP_COL_WIDTH - 1), STEP_COL_WIDTH)
      ),
    ].join("");
    lines.push(opts.dim && color ? colors.dim(header) : header);
    lines.push(
      "-".repeat(MODEL_COL_WIDTH + STEP_COL_WIDTH * DISPLAY_STEPS.length),
    );

    if (models.length === 0) {
      lines.push("(no rows)");
    }

    for (const model of models) {
      const cells = grouped.get(model)!;
      const cols = [truncate(model, MODEL_COL_WIDTH)];
      for (const step of DISPLAY_STEPS) {
        const sum = summarizeCell(cells.get(step));
        cols.push(center(colorize(sum.sym, sum.state, color), STEP_COL_WIDTH));
      }
      lines.push(cols.join(""));
    }

    // Legend
    if (color) {
      lines.push("");
      lines.push(
        `${colors.gray("Legend:")} ${colors.green("OK")} ok   ${colors.yellow("...")} in-progress / stale (>${STALE_DAYS}d)   ${colors.gray("--")} missing`,
      );
    }

    return lines.join("\n");
  }
  ```

- [ ] **H2.3** — Tests in `tests/unit/lifecycle/status-renderer.test.ts`:

  ```typescript
  import { assertEquals, assertStringIncludes } from "@std/assert";
  import { renderMatrix } from "../../../src/lifecycle/status-renderer.ts";
  import type { StateRow } from "../../../src/lifecycle/status-types.ts";

  function row(over: Partial<StateRow>): StateRow {
    return {
      model_slug: "a/x",
      task_set_hash: "h",
      step: "bench",
      last_ts: Date.now(),
      last_event_id: 1,
      last_event_type: "bench.completed",
      last_payload_hash: null,
      last_envelope_json: null,
      ...over,
    };
  }

  Deno.test("renderMatrix", async (t) => {
    await t.step("empty input prints header + (no rows)", () => {
      const s = renderMatrix([], { color: false });
      assertStringIncludes(s, "MODEL");
      assertStringIncludes(s, "(no rows)");
    });

    await t.step("missing steps render as --", () => {
      const s = renderMatrix([row({ step: "bench" })], { color: false });
      // Three other steps (debug/analyze/publish) should each show --
      const dashCount = (s.match(/--/g) ?? []).length;
      // 3 missing cells in body + the dashed separator under the header is
      // multiple dashes — count an exact pattern instead.
      const missingMatches = s.match(/\s--\s/g) ?? [];
      assertEquals(missingMatches.length >= 3, true);
    });

    await t.step("stale row (> STALE_DAYS) renders as ... not OK", () => {
      const stale = Date.now() - 30 * 24 * 60 * 60 * 1000;  // 30 days ago
      const s = renderMatrix(
        [row({ step: "bench", last_ts: stale })],
        { color: false },
      );
      assertStringIncludes(s, "...");
    });

    await t.step("started-only event renders as ... (in_progress)", () => {
      const s = renderMatrix(
        [row({ step: "analyze", last_event_type: "analysis.started" })],
        { color: false },
      );
      assertStringIncludes(s, "...");
    });

    await t.step("output fits 80 columns", () => {
      const s = renderMatrix(
        [
          row({ model_slug: "anthropic/claude-opus-4-7-very-long-name", step: "bench" }),
        ],
        { color: false },
      );
      for (const line of s.split("\n")) {
        // strip ANSI just in case (we passed color:false but be defensive)
        // deno-lint-ignore no-control-regex
        const stripped = line.replace(/\x1b\[[0-9;]*m/g, "");
        assertEquals(stripped.length <= 80, true, `line too long: ${stripped}`);
      }
    });
  });
  ```

---

## H3 — Next-action hints (`src/lifecycle/status-hints.ts`)

- [ ] **H3.1** — Implement the hint generator. The strategic plan calls for "exact command" suggestions per stale state — not generic prose.

  ```typescript
  /**
   * Next-action hint generator. Reads grouped state (model → steps) and
   * emits Hint records driven by a switch over current-state × missing-step.
   *
   * Hint copy policy: each hint includes a concrete shell command the
   * operator can paste. No "consider running" or "you may want to" — direct
   * imperative.
   *
   * @module src/lifecycle/status-hints
   */
  import type { Hint, StateRow, Step } from "./status-types.ts";

  const STALE_DAYS = 14;

  interface ModelState {
    bench?: StateRow;
    debug?: StateRow;
    analyze?: StateRow;
    publish?: StateRow;
  }

  function groupByModel(rows: StateRow[]): Map<string, ModelState> {
    const out = new Map<string, ModelState>();
    for (const r of rows) {
      const slot = out.get(r.model_slug) ?? {};
      // Prefer the row with the higher last_event_id; the view collapses
      // already, but we double up defensively in case a caller passes raw
      // events.
      const existing = (slot as Record<Step, StateRow | undefined>)[r.step];
      if (!existing || r.last_event_id > existing.last_event_id) {
        (slot as Record<Step, StateRow | undefined>)[r.step] = r;
      }
      out.set(r.model_slug, slot);
    }
    return out;
  }

  function isStale(r: StateRow | undefined): boolean {
    if (!r) return false;
    const ageDays = (Date.now() - r.last_ts) / (1000 * 60 * 60 * 24);
    return ageDays > STALE_DAYS;
  }

  function isInProgress(r: StateRow | undefined): boolean {
    return !!r && r.last_event_type.endsWith(".started");
  }

  function isMissing(r: StateRow | undefined): boolean {
    return r === undefined;
  }

  /**
   * Decide one hint per model, prioritising the earliest blocking gap. The
   * order mirrors the cycle pipeline: bench → debug → analyze → publish.
   * Once a step is missing or stuck, downstream steps are not yet actionable
   * and we suppress their hints to keep the list short.
   */
  function hintFor(model: string, st: ModelState): Hint | null {
    if (isMissing(st.bench)) {
      return {
        model_slug: model,
        severity: "warn",
        text: `${model}: never benched against current task set`,
        command: `centralgauge cycle --llms ${model}`,
      };
    }
    if (isInProgress(st.bench)) {
      return {
        model_slug: model,
        severity: "info",
        text: `${model}: bench in progress`,
        command: `centralgauge status --model ${model} --json`,
      };
    }
    if (isStale(st.bench) && !st.analyze) {
      return {
        model_slug: model,
        severity: "warn",
        text: `${model}: bench stale (>${STALE_DAYS}d) and never analyzed`,
        command: `centralgauge cycle --llms ${model} --force-rerun bench`,
      };
    }
    if (isMissing(st.debug)) {
      return {
        model_slug: model,
        severity: "warn",
        text: `${model}: missing debug capture run; run cycle --from debug-capture`,
        command: `centralgauge cycle --llms ${model} --from debug-capture`,
      };
    }
    if (isMissing(st.analyze)) {
      return {
        model_slug: model,
        severity: "warn",
        text: `${model}: missing analysis run; run cycle --from analyze`,
        command: `centralgauge cycle --llms ${model} --from analyze`,
      };
    }
    if (isInProgress(st.analyze)) {
      return {
        model_slug: model,
        severity: "info",
        text: `${model}: analyze in progress`,
        command: `centralgauge status --model ${model} --json`,
      };
    }
    if (isStale(st.analyze)) {
      return {
        model_slug: model,
        severity: "warn",
        text: `${model}: analysis stale (>${STALE_DAYS}d); re-analyze`,
        command: `centralgauge cycle --llms ${model} --force-rerun analyze`,
      };
    }
    if (isMissing(st.publish)) {
      return {
        model_slug: model,
        severity: "warn",
        text: `${model}: analysis present but not published`,
        command: `centralgauge cycle --llms ${model} --from publish`,
      };
    }
    return null;  // model is fully current
  }

  export function generateHints(rows: StateRow[]): Hint[] {
    const grouped = groupByModel(rows);
    const out: Hint[] = [];
    for (const [model, st] of Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      const h = hintFor(model, st);
      if (h) out.push(h);
    }
    return out;
  }
  ```

- [ ] **H3.2** — Tests in `tests/unit/lifecycle/status-hints.test.ts`:

  ```typescript
  import { assertEquals } from "@std/assert";
  import { generateHints } from "../../../src/lifecycle/status-hints.ts";
  import type { StateRow } from "../../../src/lifecycle/status-types.ts";

  function row(over: Partial<StateRow>): StateRow {
    return {
      model_slug: "a/x",
      task_set_hash: "h",
      step: "bench",
      last_ts: Date.now(),
      last_event_id: 1,
      last_event_type: "bench.completed",
      last_payload_hash: null,
      last_envelope_json: null,
      ...over,
    };
  }

  Deno.test("generateHints", async (t) => {
    await t.step("model with no events suggests cycle --llms", () => {
      const hints = generateHints([]);
      assertEquals(hints.length, 0);  // no rows = no models known to status
    });

    await t.step("benched-only model suggests --from debug-capture", () => {
      const hints = generateHints([row({ step: "bench" })]);
      assertEquals(hints.length, 1);
      assertEquals(hints[0]!.model_slug, "a/x");
      assertEquals(hints[0]!.command, "centralgauge cycle --llms a/x --from debug-capture");
    });

    await t.step("benched + debugged suggests --from analyze", () => {
      const hints = generateHints([
        row({ step: "bench", last_event_id: 1 }),
        row({ step: "debug", last_event_id: 2, last_event_type: "debug.captured" }),
      ]);
      assertEquals(hints.length, 1);
      assertEquals(hints[0]!.command, "centralgauge cycle --llms a/x --from analyze");
    });

    await t.step("analyze in progress emits info severity (no rerun command)", () => {
      const hints = generateHints([
        row({ step: "bench", last_event_id: 1 }),
        row({ step: "debug", last_event_id: 2, last_event_type: "debug.captured" }),
        row({ step: "analyze", last_event_id: 3, last_event_type: "analysis.started" }),
      ]);
      assertEquals(hints[0]!.severity, "info");
    });

    await t.step("missing publish step emits warn + --from publish", () => {
      const hints = generateHints([
        row({ step: "bench", last_event_id: 1 }),
        row({ step: "debug", last_event_id: 2, last_event_type: "debug.captured" }),
        row({ step: "analyze", last_event_id: 3, last_event_type: "analysis.completed" }),
      ]);
      assertEquals(hints[0]!.severity, "warn");
      assertEquals(hints[0]!.command, "centralgauge cycle --llms a/x --from publish");
    });

    await t.step("fully current model produces no hint", () => {
      const hints = generateHints([
        row({ step: "bench", last_event_id: 1 }),
        row({ step: "debug", last_event_id: 2, last_event_type: "debug.captured" }),
        row({ step: "analyze", last_event_id: 3, last_event_type: "analysis.completed" }),
        row({ step: "publish", last_event_id: 4, last_event_type: "publish.completed" }),
      ]);
      assertEquals(hints.length, 0);
    });

    await t.step("stale analyze (>14d) suggests --force-rerun analyze", () => {
      const oldTs = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const hints = generateHints([
        row({ step: "bench", last_event_id: 1 }),
        row({ step: "debug", last_event_id: 2, last_event_type: "debug.captured" }),
        row({
          step: "analyze",
          last_event_id: 3,
          last_event_type: "analysis.completed",
          last_ts: oldTs,
        }),
        row({ step: "publish", last_event_id: 4, last_event_type: "publish.completed" }),
      ]);
      assertEquals(hints[0]!.command, "centralgauge cycle --llms a/x --force-rerun analyze");
    });
  });
  ```

---

## H4 — `--json` output

- [ ] **H4.1** — The schema (`StatusJsonOutputSchema`) is already defined in H2.1. The command (H1.1) already self-validates before printing. Add a CI consumption acceptance test in `tests/unit/cli/status-command.test.ts`:

  ```typescript
  import { assertEquals } from "@std/assert";
  import {
    StatusJsonOutputSchema,
    type StatusJsonOutput,
  } from "../../../src/lifecycle/status-types.ts";

  Deno.test("StatusJsonOutputSchema rejects malformed payload", () => {
    const bad = { as_of_ts: "not-a-number", rows: [], legacy_rows: [], hints: [] };
    const r = StatusJsonOutputSchema.safeParse(bad);
    assertEquals(r.success, false);
  });

  Deno.test("StatusJsonOutputSchema accepts a fully populated payload", () => {
    const ok: StatusJsonOutput = {
      as_of_ts: 1714000000000,
      rows: [{
        model_slug: "anthropic/claude-opus-4-7",
        task_set_hash: "abc",
        step: "bench",
        last_ts: 1713000000000,
        last_event_id: 1,
        last_event_type: "bench.completed",
        last_payload_hash: "deadbeef",
        last_envelope_json: '{"deno":"1.46.3"}',
      }],
      legacy_rows: [],
      hints: [{
        model_slug: "anthropic/claude-opus-4-7",
        severity: "warn",
        text: "missing analyze",
        command: "centralgauge cycle --llms anthropic/claude-opus-4-7 --from analyze",
      }],
    };
    const r = StatusJsonOutputSchema.parse(ok);
    assertEquals(r.rows.length, 1);
    assertEquals(r.hints[0]!.severity, "warn");
  });
  ```

- [ ] **H4.2** — Document the `--json` shape in `docs/site/operations.md` (or whichever runbook Phase G's CI workflow references). Snippet:

  ```markdown
  ### `centralgauge status --json` schema (Phase G consumers)

  ```json
  {
    "as_of_ts": 1714000000000,
    "rows": [{
      "model_slug": "anthropic/claude-opus-4-7",
      "task_set_hash": "<hash>",
      "step": "bench" | "debug" | "analyze" | "publish" | "cycle",
      "last_ts": 0,
      "last_event_id": 0,
      "last_event_type": "bench.completed",
      "last_payload_hash": null | "<hex>",
      "last_envelope_json": null | "<json string>"
    }],
    "legacy_rows": [/* same shape as rows; ALWAYS populated when pre-P6 sentinel rows exist (the --legacy flag controls only human-readable display, not --json output) */],
    "hints": [{
      "model_slug": "anthropic/claude-opus-4-7",
      "severity": "info" | "warn" | "error",
      "text": "<human-readable summary>",
      "command": "<exact command to execute>"
    }]
  }
  ```

  Schema is exported from `src/lifecycle/status-types.ts` as
  `StatusJsonOutputSchema`. Re-validation against this schema is a hard
  invariant inside `status --json` itself; output that fails to parse
  surfaces as a `[FAIL]` exit and never reaches stdout.
  ```

---

## H5 — Tests + acceptance

- [ ] **H5.1** — End-to-end snapshot test in `tests/unit/cli/status-command.test.ts`. Mock `fetchState` by injecting a stub at the seam; capture stdout and snapshot:

  ```typescript
  import { assertEquals, assertStringIncludes } from "@std/assert";
  import { renderMatrix } from "../../../src/lifecycle/status-renderer.ts";
  import { generateHints } from "../../../src/lifecycle/status-hints.ts";
  import type { StateRow } from "../../../src/lifecycle/status-types.ts";

  // Fixture: one fully-current model + one missing-analyze model.
  const fixtureRows: StateRow[] = [
    { model_slug: "anthropic/claude-opus-4-6", task_set_hash: "abc",
      step: "bench", last_ts: Date.now() - 60_000, last_event_id: 1,
      last_event_type: "bench.completed",
      last_payload_hash: "h1", last_envelope_json: null },
    { model_slug: "anthropic/claude-opus-4-6", task_set_hash: "abc",
      step: "debug", last_ts: Date.now() - 50_000, last_event_id: 2,
      last_event_type: "debug.captured",
      last_payload_hash: "h2", last_envelope_json: null },
    { model_slug: "anthropic/claude-opus-4-6", task_set_hash: "abc",
      step: "analyze", last_ts: Date.now() - 40_000, last_event_id: 3,
      last_event_type: "analysis.completed",
      last_payload_hash: "h3", last_envelope_json: null },
    { model_slug: "anthropic/claude-opus-4-6", task_set_hash: "abc",
      step: "publish", last_ts: Date.now() - 30_000, last_event_id: 4,
      last_event_type: "publish.completed",
      last_payload_hash: "h4", last_envelope_json: null },
    { model_slug: "anthropic/claude-opus-4-7", task_set_hash: "abc",
      step: "bench", last_ts: Date.now() - 60_000, last_event_id: 5,
      last_event_type: "bench.completed",
      last_payload_hash: "h5", last_envelope_json: null },
    { model_slug: "anthropic/claude-opus-4-7", task_set_hash: "abc",
      step: "debug", last_ts: Date.now() - 50_000, last_event_id: 6,
      last_event_type: "debug.captured",
      last_payload_hash: "h6", last_envelope_json: null },
  ];

  Deno.test("status snapshot — matrix + hints for partial-state fixture", () => {
    const matrix = renderMatrix(fixtureRows, { color: false });
    assertStringIncludes(matrix, "anthropic/claude-opus-4-6");
    assertStringIncludes(matrix, "anthropic/claude-opus-4-7");
    // 4-6 is fully current → all OK
    // 4-7 has bench+debug only → analyze and publish should be --
    const lines = matrix.split("\n");
    const opus47Line = lines.find((l) => l.includes("4-7"))!;
    // The OK count for opus-4-7 line should be 2 (bench, debug)
    const okCount = (opus47Line.match(/OK/g) ?? []).length;
    assertEquals(okCount, 2);

    const hints = generateHints(fixtureRows);
    assertEquals(hints.length, 1);
    assertEquals(hints[0]!.model_slug, "anthropic/claude-opus-4-7");
    assertStringIncludes(hints[0]!.command, "--from analyze");
  });

  Deno.test("status --legacy surfaces pre-P6 sentinel rows separately", async () => {
    // Imported, never hardcoded. The constant lives at
    // src/lifecycle/types.ts (added by Plan B per H's request).
    const { PRE_P6_TASK_SET_SENTINEL } = await import(
      "../../../src/lifecycle/types.ts"
    );
    const legacyRows: StateRow[] = [
      { model_slug: "anthropic/claude-opus-4-5", task_set_hash: PRE_P6_TASK_SET_SENTINEL,
        step: "bench", last_ts: Date.now() - 365 * 24 * 60 * 60 * 1000,
        last_event_id: 100, last_event_type: "bench.completed",
        last_payload_hash: null, last_envelope_json: null },
    ];
    const all = [...fixtureRows, ...legacyRows];
    const current = all.filter((r) => r.task_set_hash !== PRE_P6_TASK_SET_SENTINEL);
    const legacy = all.filter((r) => r.task_set_hash === PRE_P6_TASK_SET_SENTINEL);
    assertEquals(current.length, 6);
    assertEquals(legacy.length, 1);

    const matrixLegacy = renderMatrix(legacy, { color: false, dim: true });
    assertStringIncludes(matrixLegacy, "anthropic/claude-opus-4-5");
  });
  ```

- [ ] **H5.2** — Run `deno task test:unit -- status`. All steps green.

- [ ] **H5.3** — Run `deno check`, `deno lint`, `deno fmt` against the new sources.

- [ ] **H5.4** — Manual acceptance against staging:

  ```bash
  # Full matrix
  deno task start status

  # Filter
  deno task start status --model anthropic/claude-opus-4-7

  # JSON
  deno task start status --json | jq '.hints[].command'

  # Legacy section
  deno task start status --legacy
  ```

  Confirm the matrix prints under 80 columns, the JSON parses against the
  zod schema, and the legacy section appears only with `--legacy`.

---

## H-COMMIT

- [ ] Stage:
  - `cli/commands/status-command.ts`
  - `cli/commands/mod.ts` (export added)
  - `cli/centralgauge.ts` (registration added)
  - `src/lifecycle/status-types.ts`
  - `src/lifecycle/status-renderer.ts`
  - `src/lifecycle/status-hints.ts`
  - `tests/unit/lifecycle/status-renderer.test.ts`
  - `tests/unit/lifecycle/status-hints.test.ts`
  - `tests/unit/cli/status-command.test.ts`
  - `docs/site/operations.md` (JSON schema documentation snippet)
  - `.serena/project.yml` (if it tracks command index)

- [ ] Commit message:

  ```
  feat(cli): centralgauge status — lifecycle matrix + next-action hints

  Phase H of the lifecycle event-sourcing initiative. Adds the operator's
  daily-driver CLI surface: 80-col-fit ANSI matrix of model × step state
  (OK / -- / ...), per-model next-action hints with copy-pasteable
  centralgauge cycle commands, and a zod-validated --json output that
  Phase G's weekly CI workflow consumes. --legacy surfaces pre-P6
  sentinel rows in a separate section so the current matrix stays clean.
  ```

> **Acceptance.** `centralgauge status` prints the full matrix; `centralgauge status --model anthropic/claude-opus-4-7` filters; `centralgauge status --json` validates against `StatusJsonOutputSchema` (zod); `centralgauge status --legacy` shows the pre-P6 sentinel block separately. Snapshot test for fixture lifecycle events passes.
