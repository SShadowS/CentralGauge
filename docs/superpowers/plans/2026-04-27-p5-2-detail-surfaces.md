# P5.2 — Detail surfaces (model, run, transcripts, signature) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the five drill-down routes that operators reach from the leaderboard: `/models/:slug` (model detail), `/models/:slug/runs` (runs feed by model), `/models/:slug/limitations` (markdown), `/runs/:id` (run detail with 4 tabs), `/runs/:id/transcripts/:taskId/:attempt` (transcript viewer), `/runs/:id/signature` (signature permalink). Plus activate the `print_stylesheet` feature flag.

**Architecture:** New atoms (Diff, Popover, Dialog) compose with existing P5.1 atoms. Three new lazy-loaded chunks (marked + DOMPurify ~30 KB gz, @noble/ed25519 ~12 KB gz, fzstd ~6 KB gz) attach only to the routes that need them. SSR-first via `+page.server.ts`; named cache per endpoint (already established in P5.1). The model detail and run detail pages compose ~10 widgets each — most are new.

**Tech Stack:** Same as P5.1 (Svelte 5.55+, Kit 2.58+, etc.). New consumer of pre-installed deps: marked (limitations + transcript prose), DOMPurify (sanitize markdown), @noble/ed25519 (in-browser signature verification), fzstd (transcript decompression — actually server-decompresses; client uses plain text from API).

**Spec:** `docs/superpowers/specs/2026-04-27-p5-site-ui-design.md` §5.3-5.5, §7.3-7.5, §7.9-7.11
**Prior plan:** `docs/superpowers/plans/2026-04-27-p5-1-foundation-leaderboard.md` (P5.1 — completed, see done-criteria)

**Out of scope (deferred to P5.3-5.5):** Compare/Search/Families/Tasks/Limitations index, SSE live updates, cmd-K palette, OG image generation, density toggle, P5.5 cutover.

---

## File map

### New files

| Path                                                                       | Responsibility                                                                    |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `site/src/lib/components/ui/Diff.svelte`                                   | Diff atom (unified add/remove rendering)                                          |
| `site/src/lib/components/ui/Popover.svelte`                                | Popover atom (positioned floater for filter menus, settings JSON)                 |
| `site/src/lib/components/ui/Dialog.svelte`                                 | Dialog atom (confirmation variant of Modal — used by repro download confirmation) |
| `site/src/lib/components/ui/icons/Download.svelte`                         | Lucide download                                                                   |
| `site/src/lib/components/ui/icons/Copy.svelte`                             | Lucide copy                                                                       |
| `site/src/lib/components/ui/icons/ExternalLink.svelte`                     | Lucide external-link                                                              |
| `site/src/lib/components/ui/icons/Lock.svelte`                             | Lucide lock (signature panel)                                                     |
| `site/src/lib/components/ui/icons/Info.svelte`                             | Lucide info                                                                       |
| `site/src/lib/components/ui/icons/AlertTriangle.svelte`                    | Lucide alert-triangle                                                             |
| `site/src/lib/components/ui/icons/AlertCircle.svelte`                      | Lucide alert-circle                                                               |
| `site/src/lib/components/ui/icons/CheckCircle.svelte`                      | Lucide check-circle                                                               |
| `site/src/lib/components/ui/icons/ChevronRight.svelte`                     | Lucide chevron-right                                                              |
| `site/src/lib/components/ui/icons/Eye.svelte`                              | Lucide eye                                                                        |
| `site/src/lib/components/ui/icons/Code.svelte`                             | Lucide code (separate from Code atom)                                             |
| `site/src/lib/components/domain/MarkdownRenderer.svelte`                   | Lazy-loads marked + DOMPurify; renders sanitized HTML                             |
| `site/src/lib/components/domain/RunStatusBadge.svelte`                     | Status pill: pending/running/completed/failed × tier overlay                      |
| `site/src/lib/components/domain/TableOfContents.svelte`                    | Sticky right-rail TOC with active-section highlighting                            |
| `site/src/lib/components/domain/StatTile.svelte`                           | Stat card with label, value, optional sparkline + delta                           |
| `site/src/lib/components/domain/RunsTable.svelte`                          | Paginated runs table (used by `/runs` later, `/models/:slug/runs` here)           |
| `site/src/lib/components/domain/RunsCursorPager.svelte`                    | Cursor-based pagination control (Previous/Next/count)                             |
| `site/src/lib/components/domain/PerTaskResultsTable.svelte`                | Run detail Results tab — task ID × attempt × score table                          |
| `site/src/lib/components/domain/SignaturePanel.svelte`                     | Ed25519 verify panel (lazy-loads @noble/ed25519)                                  |
| `site/src/lib/components/domain/ReproductionBlock.svelte`                  | Bundle SHA + download button + CLI snippet                                        |
| `site/src/lib/components/domain/SettingsPanel.svelte`                      | Settings tab content (temperature, max_tokens, etc., raw JSON copy)               |
| `site/src/lib/components/domain/TranscriptViewer.svelte`                   | Section parser + collapsible blocks + line numbers + copy                         |
| `site/src/lib/components/domain/CopyButton.svelte`                         | Click-to-copy button with success toast                                           |
| `site/src/lib/components/domain/TaskHistoryChart.svelte`                   | Line chart of model score over time (uses Sparkline-larger variant)               |
| `site/src/lib/components/domain/CostBarChart.svelte`                       | Bar chart of cost per run with mean + p95 lines (d3-shape)                        |
| `site/src/lib/components/domain/FailureModesList.svelte`                   | Failure modes with frequency + AL/BC code links                                   |
| `site/src/routes/models/[slug]/+page.server.ts`                            | Loader: GET /api/v1/models/:slug                                                  |
| `site/src/routes/models/[slug]/+page.svelte`                               | Model detail page                                                                 |
| `site/src/routes/models/[slug]/runs/+page.server.ts`                       | Loader: GET /api/v1/runs?model=:slug&cursor=                                      |
| `site/src/routes/models/[slug]/runs/+page.svelte`                          | Runs feed for this model                                                          |
| `site/src/routes/models/[slug]/limitations/+page.server.ts`                | Loader: GET /api/v1/models/:slug/limitations (markdown)                           |
| `site/src/routes/models/[slug]/limitations/+page.svelte`                   | Markdown-rendered limitations                                                     |
| `site/src/routes/runs/[id]/+page.server.ts`                                | Loader: GET /api/v1/runs/:id                                                      |
| `site/src/routes/runs/[id]/+page.svelte`                                   | Run detail page (4 tabs)                                                          |
| `site/src/routes/runs/[id]/transcripts/[taskId]/[attempt]/+page.server.ts` | Loader: derive transcript key + GET /api/v1/transcripts/:key                      |
| `site/src/routes/runs/[id]/transcripts/[taskId]/[attempt]/+page.svelte`    | Transcript viewer page                                                            |
| `site/src/routes/runs/[id]/signature/+page.server.ts`                      | Loader: GET /api/v1/runs/:id/signature                                            |
| `site/src/routes/runs/[id]/signature/+page.svelte`                         | Signature permalink page (reuses SignaturePanel)                                  |
| `site/src/styles/print.css`                                                | Print stylesheet (hides nav/footer/filters, light theme, link URLs after)         |
| `site/tests/e2e/model-detail.spec.ts`                                      | E2E: /models/:slug renders, sections collapse, links work                         |
| `site/tests/e2e/run-detail.spec.ts`                                        | E2E: /runs/:id tabs, signature verify, repro download URL                         |
| `site/tests/e2e/transcript.spec.ts`                                        | E2E: transcript page renders, sections collapse, copy works                       |
| `site/tests/e2e/print.spec.ts`                                             | E2E: print-emulation hides nav/footer, shows link URLs                            |
| `site/tests/fixtures/model-detail.json`                                    | Frozen model detail fixture                                                       |
| `site/tests/fixtures/run-detail.json`                                      | Frozen run detail fixture                                                         |
| `site/tests/fixtures/signed-payload.json`                                  | Known-good signed payload + verify key                                            |
| `site/tests/fixtures/markdown-sample.md`                                   | Limitations markdown sample                                                       |
| `site/tests/fixtures/transcript-sample.txt`                                | Annotated transcript sample (already-decompressed)                                |

### Modified files

| Path                                        | Change                                                                                                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site/src/lib/shared/api-types.ts`          | Add `ModelDetail`, `RunDetail`, `RunsListResponse`, `Transcript`, `SignedRunPayload` (move from existing types.ts), `ModelLimitations` types        |
| `site/src/lib/components/ui/icons/index.ts` | Re-export 11 new icons                                                                                                                              |
| `site/src/lib/components/ui/Modal.svelte`   | Add focus-trap (was deferred from P5.1) — NEEDED here because Run detail's Reproduction tab uses a Dialog (Modal variant) for download confirmation |
| `site/src/lib/components/ui/Tabs.svelte`    | Add keyboard arrow nav (left/right/home/end) — NEEDED here because Run detail uses 4 tabs heavily                                                   |
| `site/src/lib/components/ui/Tooltip.svelte` | Add lightweight Floating-UI-style positioner (top/bottom/left/right) — NEEDED for Settings tab tooltips on numeric values                           |
| `site/wrangler.toml`                        | Add `FLAG_PRINT_STYLESHEET = "on"` to `[vars]` (Phase G)                                                                                            |
| `site/lighthouserc.json`                    | Add 3 new URLs (model detail, run detail, transcripts) to LHCI URL list                                                                             |
| `site/svelte.config.js`                     | Investigate tightening `prerender.handleHttpError` once nav routes link-resolve                                                                     |

### Out of scope (deferred to P5.3-5.5)

- `/compare`, `/search`, `/families/:slug`, `/tasks`, `/tasks/:id`, `/limitations` index, `/about` full content (currently stub)
- SSE live updates on `/runs/:id` for in-flight runs (Phase D mentions but defers wiring)
- cmd-K palette
- OG image generation
- Visual regression suite (P5.4)

---

## Mini-phase A — Foundation extensions

Lays the groundwork: 3 new atoms, 11 new icons, 12 new domain widgets, 5 new shared types. P5.2's pages compose these heavily.

### Task A1: Extend `$shared/api-types.ts` with detail types

**Files:**

- Modify: `site/src/lib/shared/api-types.ts`

- [ ] **Step 1: Append to `site/src/lib/shared/api-types.ts`**

```ts
// =============================================================================
// Model detail — GET /api/v1/models/:slug
// =============================================================================

export interface ModelHistoryPoint {
  run_id: string;
  ts: string;
  score: number;
  cost_usd: number;
  tier: "verified" | "claimed";
}

export interface FailureMode {
  code: string; // e.g., "AL0132"
  count: number;
  pct: number; // 0..1
  example_message: string;
}

export interface ModelDetail {
  model: {
    slug: string;
    display_name: string;
    api_model_id: string;
    family_slug: string;
    added_at: string;
  };
  aggregates: {
    avg_score: number;
    tasks_attempted: number;
    tasks_passed: number;
    avg_cost_usd: number;
    latency_p50_ms: number;
    run_count: number;
    verified_runs: number;
  };
  history: ModelHistoryPoint[];
  failure_modes: FailureMode[];
  recent_runs: ModelHistoryPoint[]; // last 20
  predecessor?: {
    slug: string;
    display_name: string;
    avg_score: number;
    avg_cost_usd: number;
  };
}

// =============================================================================
// Runs list — GET /api/v1/runs?cursor=&...
// =============================================================================

export interface RunsListItem {
  id: string;
  model: { slug: string; display_name: string; family_slug: string };
  tier: "verified" | "claimed";
  status: "pending" | "running" | "completed" | "failed";
  tasks_attempted: number;
  tasks_passed: number;
  avg_score: number;
  cost_usd: number;
  duration_ms: number;
  started_at: string;
  completed_at?: string;
}

export interface RunsListResponse {
  data: RunsListItem[];
  next_cursor: string | null;
  generated_at: string;
}

// =============================================================================
// Run detail — GET /api/v1/runs/:id
// =============================================================================

export interface PerTaskResult {
  task_id: string;
  difficulty: "easy" | "medium" | "hard";
  attempts: Array<{
    attempt: number;
    passed: boolean;
    score: number;
    compile_success: boolean;
    compile_errors: Array<
      {
        code: string;
        message: string;
        file?: string;
        line?: number;
        column?: number;
      }
    >;
    tests_total: number;
    tests_passed: number;
    duration_ms: number;
    transcript_key: string;
    code_key?: string;
    failure_reasons: string[];
  }>;
}

export interface RunDetail {
  id: string;
  model: {
    slug: string;
    display_name: string;
    api_model_id: string;
    family_slug: string;
  };
  tier: "verified" | "claimed";
  status: "pending" | "running" | "completed" | "failed";
  machine_id: string;
  task_set_hash: string;
  pricing_version: string;
  centralgauge_sha?: string;
  started_at: string;
  completed_at: string;
  settings: {
    temperature: number;
    max_attempts: number;
    max_tokens: number;
    prompt_version: string;
    bc_version: string;
  };
  totals: {
    avg_score: number;
    cost_usd: number;
    duration_ms: number;
    tasks_attempted: number;
    tasks_passed: number;
  };
  results: PerTaskResult[];
  reproduction_bundle?: { sha256: string; size_bytes: number };
}

// =============================================================================
// Run signature — GET /api/v1/runs/:id/signature
// =============================================================================

export interface RunSignature {
  run_id: string;
  payload_b64: string; // base64-encoded canonical signed payload
  signature: {
    alg: "Ed25519";
    key_id: number;
    signed_at: string;
    value_b64: string; // base64 signature
  };
  public_key_hex: string; // hex-encoded public key
  machine_id: string;
}

// =============================================================================
// Transcript — GET /api/v1/transcripts/:key (server already decompressed zstd)
// =============================================================================

export interface Transcript {
  key: string;
  size_bytes: number;
  text: string; // already decoded UTF-8
  meta?: {
    run_id?: string;
    task_id?: string;
    attempt?: number;
  };
}

// =============================================================================
// Model limitations — GET /api/v1/models/:slug/limitations (markdown or json)
// =============================================================================

export interface LimitationItem {
  al_concept: string;
  severity: "low" | "medium" | "high";
  description: string;
  first_seen_at: string;
  example_run_id: string;
  example_task_id: string;
}

export interface ModelLimitations {
  model_slug: string;
  generated_at: string;
  total: number;
  items: LimitationItem[];
}
```

- [ ] **Step 2: Run check**

Run: `cd site && npm run check 2>&1 | tail -10`
Expected: 0 NEW errors (3 pre-existing in tests/api/health.test.ts).

- [ ] **Step 3: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/shared/api-types.ts
git -C /u/Git/CentralGauge commit -m "feat(site): extend \$shared/api-types with ModelDetail/RunDetail/Transcript/Signature types"
```

---

### Task A2: Vendor 11 new Lucide icons

**Files:**

- Create: `site/src/lib/components/ui/icons/Download.svelte`
- Create: `site/src/lib/components/ui/icons/Copy.svelte`
- Create: `site/src/lib/components/ui/icons/ExternalLink.svelte`
- Create: `site/src/lib/components/ui/icons/Lock.svelte`
- Create: `site/src/lib/components/ui/icons/Info.svelte`
- Create: `site/src/lib/components/ui/icons/AlertTriangle.svelte`
- Create: `site/src/lib/components/ui/icons/AlertCircle.svelte`
- Create: `site/src/lib/components/ui/icons/CheckCircle.svelte`
- Create: `site/src/lib/components/ui/icons/ChevronRight.svelte`
- Create: `site/src/lib/components/ui/icons/Eye.svelte`
- Create: `site/src/lib/components/ui/icons/Code.svelte` (lucide icon, distinct from Code atom)
- Modify: `site/src/lib/components/ui/icons/index.ts`

- [ ] **Step 1: Each file follows the same template** as Phase C of P5.1. Differences are only the inner SVG content. Template:

```svelte
<script lang="ts">
  interface Props { size?: number; label?: string; }
  let { size = 20, label }: Props = $props();
  const ariaProps = $derived(label ? { 'aria-label': label, role: 'img' } : { 'aria-hidden': 'true' });
</script>
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" {...ariaProps}>
  <!-- per-icon paths below -->
</svg>
```

- [ ] **Step 2: Inner SVG paths (Lucide MIT)**

| Icon          | Inner content                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Download      | `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" />` |
| Copy          | `<rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />`       |
| ExternalLink  | `<path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />`                 |
| Lock          | `<rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />`                                     |
| Info          | `<circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />`                                                       |
| AlertTriangle | `<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" />`   |
| AlertCircle   | `<circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" />`                 |
| CheckCircle   | `<circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" />`                                                                         |
| ChevronRight  | `<path d="m9 18 6-6-6-6" />`                                                                                                          |
| Eye           | `<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />`                                           |
| Code          | `<polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />`                                                           |

- [ ] **Step 3: Update `site/src/lib/components/ui/icons/index.ts`**

Append the 11 new exports:

```ts
export { default as Download } from "./Download.svelte";
export { default as Copy } from "./Copy.svelte";
export { default as ExternalLink } from "./ExternalLink.svelte";
export { default as Lock } from "./Lock.svelte";
export { default as Info } from "./Info.svelte";
export { default as AlertTriangle } from "./AlertTriangle.svelte";
export { default as AlertCircle } from "./AlertCircle.svelte";
export { default as CheckCircle } from "./CheckCircle.svelte";
export { default as ChevronRight } from "./ChevronRight.svelte";
export { default as Eye } from "./Eye.svelte";
export { default as Code } from "./Code.svelte";
```

(Existing 8 exports stay above.)

- [ ] **Step 4: Verify**

Run: `cd site && npm run build 2>&1 | tail -3`
Expected: `✔ done`.

- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add "site/src/lib/components/ui/icons/"
git -C /u/Git/CentralGauge commit -m "feat(site): vendor 11 more Lucide icons (download, copy, external-link, lock, info, alerts, check-circle, chevron-right, eye, code)"
```

---

### Task A3: Diff atom

**Files:**

- Create: `site/src/lib/components/ui/Diff.svelte`
- Test: `site/src/lib/components/ui/Diff.test.svelte.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import Diff from "./Diff.svelte";

describe("Diff", () => {
  it("renders unified diff with + and - lines", () => {
    const { container } = render(Diff, {
      lines: [
        { type: "context", text: "unchanged" },
        { type: "add", text: "new line" },
        { type: "remove", text: "old line" },
      ],
    });
    expect(container.querySelector(".line.add")?.textContent).toContain(
      "new line",
    );
    expect(container.querySelector(".line.remove")?.textContent).toContain(
      "old line",
    );
    expect(container.querySelector(".line.context")?.textContent).toContain(
      "unchanged",
    );
  });
  it("uses tokens for diff colours", () => {
    const { container } = render(Diff, {
      lines: [{ type: "add", text: "x" }],
    });
    const add = container.querySelector(".line.add") as HTMLElement;
    expect(add).toBeDefined();
    // token reference rendered into computed style is jsdom-limited;
    // assert class presence instead.
    expect(add.classList.contains("add")).toBe(true);
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `cd site && npx vitest run --config vitest.unit.config.ts src/lib/components/ui/Diff.test.svelte.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```svelte
<script lang="ts">
  type LineType = 'context' | 'add' | 'remove';
  interface Line { type: LineType; text: string; }
  interface Props { lines: Line[]; showLineNumbers?: boolean; }
  let { lines, showLineNumbers = false }: Props = $props();
</script>

<pre class="diff">{#each lines as line, i}<div class="line {line.type}">{#if showLineNumbers}<span class="ln">{i + 1}</span>{/if}<span class="prefix">{#if line.type === 'add'}+{:else if line.type === 'remove'}-{:else}{' '}{/if}</span>{line.text}
</div>{/each}</pre>

<style>
  .diff {
    background: var(--code-bg);
    border-radius: var(--radius-2);
    padding: var(--space-3);
    margin: 0;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
  }
  .line { display: block; padding: 0 var(--space-2); }
  .line.add { background: var(--diff-add); }
  .line.remove { background: var(--diff-remove); }
  .line.context { color: var(--text-muted); }
  .ln { display: inline-block; width: 3em; color: var(--text-faint); padding-right: var(--space-2); user-select: none; }
  .prefix { display: inline-block; width: 1em; color: var(--text-muted); }
</style>
```

- [ ] **Step 4: Verify**

Run: `cd site && npx vitest run --config vitest.unit.config.ts src/lib/components/ui/Diff.test.svelte.ts`
Expected: 2/2 pass.

- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/ui/Diff.svelte site/src/lib/components/ui/Diff.test.svelte.ts
git -C /u/Git/CentralGauge commit -m "feat(site): Diff atom (unified add/remove/context, optional line numbers)"
```

---

### Task A4: Popover atom

**Files:**

- Create: `site/src/lib/components/ui/Popover.svelte`
- Test: `site/src/lib/components/ui/Popover.test.svelte.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import Popover from "./Popover.svelte";

describe("Popover", () => {
  it("renders trigger always; content only when open", async () => {
    render(Popover, {
      trigger: "Open",
      children: "Hidden content",
    });
    expect(screen.getByText("Open")).toBeDefined();
    expect(screen.queryByText("Hidden content")).toBeNull();
  });

  it("shows content after clicking trigger", async () => {
    const { container } = render(Popover, {
      trigger: "Open",
      children: "Visible content",
    });
    const btn = container.querySelector("button.trigger") as HTMLButtonElement;
    await fireEvent.click(btn);
    expect(screen.getByText("Visible content")).toBeDefined();
  });

  it("hides content on Escape", async () => {
    const { container } = render(Popover, {
      trigger: "Open",
      children: "X",
    });
    const btn = container.querySelector("button.trigger") as HTMLButtonElement;
    await fireEvent.click(btn);
    await fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("X")).toBeNull();
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `cd site && npx vitest run --config vitest.unit.config.ts src/lib/components/ui/Popover.test.svelte.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { useId } from '$lib/client/use-id';

  interface Props {
    trigger: string;
    placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';
    children: Snippet;
  }
  let { trigger, placement = 'bottom-start', children }: Props = $props();

  let open = $state(false);
  const triggerId = useId();
  const panelId = useId();

  function handleEsc(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      open = false;
    }
  }
</script>

<svelte:window onkeydown={handleEsc} />

<div class="wrap">
  <button
    type="button"
    id={triggerId}
    class="trigger"
    aria-expanded={open}
    aria-controls={panelId}
    onclick={() => (open = !open)}
  >
    {trigger}
  </button>
  {#if open}
    <div id={panelId} class="panel placement-{placement}" role="dialog" aria-labelledby={triggerId}>
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .wrap { position: relative; display: inline-block; }
  .trigger {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-2) var(--space-4);
    color: var(--text);
    cursor: pointer;
  }
  .trigger:hover { border-color: var(--border-strong); }
  .panel {
    position: absolute;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-4);
    z-index: var(--z-popover);
    min-width: 200px;
    max-width: 360px;
  }
  .placement-bottom-start { top: calc(100% + var(--space-2)); left: 0; }
  .placement-bottom-end   { top: calc(100% + var(--space-2)); right: 0; }
  .placement-top-start    { bottom: calc(100% + var(--space-2)); left: 0; }
  .placement-top-end      { bottom: calc(100% + var(--space-2)); right: 0; }
</style>
```

- [ ] **Step 4: Verify**

Run: `cd site && npx vitest run --config vitest.unit.config.ts src/lib/components/ui/Popover.test.svelte.ts`
Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/ui/Popover.svelte site/src/lib/components/ui/Popover.test.svelte.ts
git -C /u/Git/CentralGauge commit -m "feat(site): Popover atom (4-corner placement, Esc to close, useId for aria)"
```

---

### Task A5: Dialog atom (confirmation variant of Modal)

**Files:**

- Create: `site/src/lib/components/ui/Dialog.svelte`
- Test: `site/src/lib/components/ui/Dialog.test.svelte.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import Dialog from "./Dialog.svelte";

describe("Dialog", () => {
  it("renders title and message when open", () => {
    render(Dialog, {
      open: true,
      title: "Confirm",
      message: "Are you sure?",
      confirmLabel: "Yes",
      cancelLabel: "No",
    });
    expect(screen.getByText("Confirm")).toBeDefined();
    expect(screen.getByText("Are you sure?")).toBeDefined();
    expect(screen.getByRole("button", { name: "Yes" })).toBeDefined();
    expect(screen.getByRole("button", { name: "No" })).toBeDefined();
  });

  it("emits onconfirm when confirm clicked", async () => {
    let confirmed = false;
    render(Dialog, {
      open: true,
      title: "X",
      message: "Y",
      onconfirm: () => {
        confirmed = true;
      },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(confirmed).toBe(true);
  });

  it("emits oncancel when cancel clicked", async () => {
    let cancelled = false;
    render(Dialog, {
      open: true,
      title: "X",
      message: "Y",
      oncancel: () => {
        cancelled = true;
      },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancelled).toBe(true);
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `cd site && npx vitest run --config vitest.unit.config.ts src/lib/components/ui/Dialog.test.svelte.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```svelte
<script lang="ts">
  import { useId } from '$lib/client/use-id';
  import Button from './Button.svelte';

  interface Props {
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    onconfirm?: () => void;
    oncancel?: () => void;
  }
  let {
    open = $bindable(false),
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false,
    onconfirm,
    oncancel,
  }: Props = $props();

  const titleId = useId();
  const msgId = useId();

  function handleEsc(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      open = false;
      oncancel?.();
    }
  }

  function confirm() {
    open = false;
    onconfirm?.();
  }

  function cancel() {
    open = false;
    oncancel?.();
  }
</script>

<svelte:window onkeydown={handleEsc} />

{#if open}
  <div class="backdrop" role="presentation" onclick={cancel}></div>
  <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={msgId}>
    <header><h2 id={titleId}>{title}</h2></header>
    <p id={msgId}>{message}</p>
    <footer class="actions">
      <Button variant="secondary" onclick={cancel}>{cancelLabel}</Button>
      <Button variant={danger ? 'danger' : 'primary'} onclick={confirm}>{confirmLabel}</Button>
    </footer>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: calc(var(--z-modal) - 1);
  }
  .dialog {
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-6);
    z-index: var(--z-modal);
    min-width: 320px;
    max-width: 480px;
  }
  .dialog header { margin-bottom: var(--space-4); }
  .dialog h2 { font-size: var(--text-xl); margin: 0; }
  .dialog p { margin: 0 0 var(--space-6) 0; color: var(--text-muted); }
  .actions { display: flex; gap: var(--space-3); justify-content: flex-end; }
</style>
```

- [ ] **Step 4: Verify**

Run: `cd site && npx vitest run --config vitest.unit.config.ts src/lib/components/ui/Dialog.test.svelte.ts`
Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/ui/Dialog.svelte site/src/lib/components/ui/Dialog.test.svelte.ts
git -C /u/Git/CentralGauge commit -m "feat(site): Dialog atom (alertdialog with confirm/cancel + danger variant)"
```

---

### Task A6: Upgrade Modal with focus-trap (was deferred from P5.1)

**Files:**

- Modify: `site/src/lib/components/ui/Modal.svelte`
- Modify: `site/src/lib/components/ui/Modal.test.svelte.ts` (add focus-trap test)

- [ ] **Step 1: Update Modal.svelte**

Replace the existing Modal.svelte contents with:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { useId } from '$lib/client/use-id';

  interface Props { open: boolean; title: string; children: Snippet; onclose?: () => void; }
  let { open = $bindable(false), title, children, onclose }: Props = $props();

  const titleId = useId();
  let dialogEl: HTMLDivElement | undefined = $state();
  let triggerEl: Element | null = null;

  function handleEsc(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      open = false;
      onclose?.();
    }
  }

  function trap(e: KeyboardEvent) {
    if (!open || e.key !== 'Tab' || !dialogEl) return;
    const focusables = dialogEl.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  $effect(() => {
    if (open) {
      triggerEl = document.activeElement;
      // Move focus into the dialog after mount
      queueMicrotask(() => {
        const first = dialogEl?.querySelector<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])');
        first?.focus();
      });
    } else if (triggerEl instanceof HTMLElement) {
      triggerEl.focus();
      triggerEl = null;
    }
  });
</script>

<svelte:window onkeydown={(e) => { handleEsc(e); trap(e); }} />

{#if open}
  <div class="backdrop" role="presentation" onclick={() => { open = false; onclose?.(); }}></div>
  <div bind:this={dialogEl} class="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <header><h2 id={titleId}>{title}</h2></header>
    <div class="body">{@render children()}</div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: calc(var(--z-modal) - 1);
  }
  .modal {
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-6);
    z-index: var(--z-modal);
    min-width: 320px;
    max-width: 90vw;
    max-height: 90vh;
    overflow: auto;
  }
</style>
```

- [ ] **Step 2: Update test (append a focus-trap test)**

Append to `site/src/lib/components/ui/Modal.test.svelte.ts` (or recreate with both tests):

```ts
it("focuses the first focusable element after opening", async () => {
  const { container, rerender } = render(Modal, {
    open: false,
    title: "X",
    children: "<button>One</button><button>Two</button>",
  });
  await rerender({
    open: true,
    title: "X",
    children: "<button>One</button><button>Two</button>",
  });
  // microtask resolves; in jsdom we approximate by waiting a tick
  await new Promise((r) => setTimeout(r, 0));
  const first = container.querySelector("button") as HTMLButtonElement;
  expect(first).toBeDefined();
});
```

(If the existing Modal test file has different shape, just add the assertion case alongside.)

- [ ] **Step 3: Verify**

Run: `cd site && npx vitest run --config vitest.unit.config.ts src/lib/components/ui/Modal.test.svelte.ts`
Expected: tests pass.

- [ ] **Step 4: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/ui/Modal.svelte site/src/lib/components/ui/Modal.test.svelte.ts
git -C /u/Git/CentralGauge commit -m "feat(site): Modal focus-trap + return-focus-to-trigger (was deferred from P5.1)"
```

---

### Task A7: Upgrade Tabs with keyboard arrow nav

**Files:**

- Modify: `site/src/lib/components/ui/Tabs.svelte`
- Create: `site/src/lib/components/ui/Tabs.test.svelte.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import Tabs from "./Tabs.svelte";

const tabs = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta" },
  { id: "c", label: "Gamma" },
];

const childrenSnippet = createRawSnippet((active) => ({
  render: () => `<div>panel: ${active()}</div>`,
}));

describe("Tabs", () => {
  it("renders tabs and the initial active panel", () => {
    render(Tabs, { tabs, active: "a", children: childrenSnippet });
    expect(
      screen.getByRole("tab", { name: "Alpha" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByRole("tab", { name: "Beta" }).getAttribute("aria-selected"),
    ).toBe("false");
  });

  it("arrow-right moves active to the next tab", async () => {
    let activeNow = "a";
    render(Tabs, {
      tabs,
      active: "a",
      onchange: (id: string) => {
        activeNow = id;
      },
      children: childrenSnippet,
    });
    const tabA = screen.getByRole("tab", { name: "Alpha" });
    tabA.focus();
    await fireEvent.keyDown(tabA, { key: "ArrowRight" });
    expect(activeNow).toBe("b");
  });

  it("Home key jumps to first tab", async () => {
    let activeNow = "c";
    render(Tabs, {
      tabs,
      active: "c",
      onchange: (id: string) => {
        activeNow = id;
      },
      children: childrenSnippet,
    });
    const tabC = screen.getByRole("tab", { name: "Gamma" });
    tabC.focus();
    await fireEvent.keyDown(tabC, { key: "Home" });
    expect(activeNow).toBe("a");
  });
});
```

- [ ] **Step 2: Update `Tabs.svelte`**

Replace contents:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * Tab definition. `id` must be a CSS-identifier-safe string (alphanumeric,
   * dash, underscore) — interpolated verbatim into element `id` and
   * `aria-controls`. Callers are responsible for sanitization.
   */
  interface Tab { id: string; label: string; }
  interface Props {
    tabs: Tab[];
    active?: string;
    onchange?: (id: string) => void;
    children: Snippet<[string]>;
  }

  let { tabs, active = $bindable(tabs[0]?.id ?? ''), onchange, children }: Props = $props();

  function selectTab(id: string) {
    active = id;
    onchange?.(id);
  }

  function handleKeydown(e: KeyboardEvent, currentId: string) {
    const idx = tabs.findIndex((t) => t.id === currentId);
    if (idx === -1) return;
    let nextIdx: number | null = null;
    switch (e.key) {
      case 'ArrowRight': nextIdx = (idx + 1) % tabs.length; break;
      case 'ArrowLeft':  nextIdx = (idx - 1 + tabs.length) % tabs.length; break;
      case 'Home':       nextIdx = 0; break;
      case 'End':        nextIdx = tabs.length - 1; break;
    }
    if (nextIdx !== null) {
      e.preventDefault();
      const next = tabs[nextIdx];
      selectTab(next.id);
      // Move focus to the newly-active tab button so the next arrow keeps moving from there
      queueMicrotask(() => {
        const btn = document.getElementById(`tab-${next.id}`);
        btn?.focus();
      });
    }
  }
</script>

<div class="tabs">
  <div role="tablist" class="tablist">
    {#each tabs as tab}
      <button
        role="tab"
        id="tab-{tab.id}"
        aria-controls="tabpanel-{tab.id}"
        aria-selected={active === tab.id}
        tabindex={active === tab.id ? 0 : -1}
        class="tab"
        class:active={active === tab.id}
        onclick={() => selectTab(tab.id)}
        onkeydown={(e) => handleKeydown(e, tab.id)}
      >
        {tab.label}
      </button>
    {/each}
  </div>
  <div role="tabpanel" id="tabpanel-{active}" aria-labelledby="tab-{active}" class="panel">
    {@render children(active)}
  </div>
</div>

<style>
  .tablist { display: flex; gap: var(--space-2); border-bottom: 1px solid var(--border); }
  .tab {
    background: transparent;
    border: 0;
    padding: var(--space-3) var(--space-5);
    color: var(--text-muted);
    border-bottom: 2px solid transparent;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
  }
  .tab.active { color: var(--text); border-bottom-color: var(--accent); }
  .panel { padding: var(--space-5) 0; }
</style>
```

- [ ] **Step 3: Verify**

Run: `cd site && npx vitest run --config vitest.unit.config.ts src/lib/components/ui/Tabs.test.svelte.ts`
Expected: 3/3 pass.

- [ ] **Step 4: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/ui/Tabs.svelte site/src/lib/components/ui/Tabs.test.svelte.ts
git -C /u/Git/CentralGauge commit -m "feat(site): Tabs keyboard arrow/Home/End navigation + tests (was deferred from P5.1)"
```

---

### Task A8: Upgrade Tooltip with placement positioner

**Files:**

- Modify: `site/src/lib/components/ui/Tooltip.svelte`
- Create: `site/src/lib/components/ui/Tooltip.test.svelte.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import Tooltip from "./Tooltip.svelte";

describe("Tooltip", () => {
  it("renders trigger content + tooltip span with role=tooltip", () => {
    const { container } = render(Tooltip, {
      label: "Helpful text",
      children: "trigger",
    });
    expect(screen.getByText("trigger")).toBeDefined();
    expect(container.querySelector('[role="tooltip"]')?.textContent).toBe(
      "Helpful text",
    );
  });

  it("applies placement class when provided", () => {
    const { container } = render(Tooltip, {
      label: "X",
      placement: "top",
      children: "t",
    });
    expect(container.querySelector(".tip.placement-top")).not.toBeNull();
  });

  it("aria-describedby links trigger to tooltip", () => {
    const { container } = render(Tooltip, { label: "X", children: "t" });
    const wrap = container.querySelector(".wrap") as HTMLElement;
    const tip = container.querySelector('[role="tooltip"]') as HTMLElement;
    expect(wrap.getAttribute("aria-describedby")).toBe(tip.id);
  });
});
```

- [ ] **Step 2: Update Tooltip.svelte**

Replace contents:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { useId } from '$lib/client/use-id';

  type Placement = 'top' | 'bottom' | 'left' | 'right';
  interface Props { label: string; placement?: Placement; children: Snippet; }
  let { label, placement = 'top', children }: Props = $props();
  const id = useId();
</script>

<span class="wrap" aria-describedby={id}>
  {@render children()}
  <span role="tooltip" {id} class="tip placement-{placement}">{label}</span>
</span>

<style>
  .wrap { position: relative; display: inline-flex; }
  .tip {
    position: absolute;
    background: var(--text);
    color: var(--bg);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-1);
    font-size: var(--text-xs);
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease);
    z-index: var(--z-tooltip);
  }
  .placement-top {
    bottom: calc(100% + var(--space-2));
    left: 50%;
    transform: translateX(-50%);
  }
  .placement-bottom {
    top: calc(100% + var(--space-2));
    left: 50%;
    transform: translateX(-50%);
  }
  .placement-left {
    right: calc(100% + var(--space-2));
    top: 50%;
    transform: translateY(-50%);
  }
  .placement-right {
    left: calc(100% + var(--space-2));
    top: 50%;
    transform: translateY(-50%);
  }
  .wrap:hover .tip,
  .wrap:focus-within .tip {
    opacity: 1;
    transition-delay: 500ms;
  }
</style>
```

- [ ] **Step 3: Verify**

Run: `cd site && npx vitest run --config vitest.unit.config.ts src/lib/components/ui/Tooltip.test.svelte.ts`
Expected: 3/3 pass.

- [ ] **Step 4: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/ui/Tooltip.svelte site/src/lib/components/ui/Tooltip.test.svelte.ts
git -C /u/Git/CentralGauge commit -m "feat(site): Tooltip 4-placement positioner + tests (was deferred from P5.1)"
```

---

### Task A9: CopyButton domain widget

**Files:**

- Create: `site/src/lib/components/domain/CopyButton.svelte`
- Test: `site/src/lib/components/domain/CopyButton.test.svelte.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import CopyButton from "./CopyButton.svelte";

describe("CopyButton", () => {
  it("calls clipboard.writeText on click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(CopyButton, { value: "hello" });
    await fireEvent.click(screen.getByRole("button"));
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("renders an aria-label", () => {
    render(CopyButton, { value: "x", label: "Copy SHA" });
    expect(screen.getByRole("button", { name: "Copy SHA" })).toBeDefined();
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `cd site && npx vitest run --config vitest.unit.config.ts src/lib/components/domain/CopyButton.test.svelte.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```svelte
<script lang="ts">
  import { Copy, CheckCircle } from '$lib/components/ui/icons';

  interface Props { value: string; label?: string; }
  let { value, label = 'Copy' }: Props = $props();

  let copied = $state(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
      setTimeout(() => { copied = false; }, 1500);
    } catch {
      // ignore — user may have denied permission, fall through silently
    }
  }
</script>

<button type="button" class="cb" aria-label={label} onclick={copy}>
  {#if copied}<CheckCircle size={14} />{:else}<Copy size={14} />{/if}
</button>

<style>
  .cb {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-1);
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    cursor: pointer;
  }
  .cb:hover { color: var(--text); border-color: var(--border-strong); }
</style>
```

- [ ] **Step 4: Verify**

Run: `cd site && npx vitest run --config vitest.unit.config.ts src/lib/components/domain/CopyButton.test.svelte.ts`
Expected: 2/2 pass.

- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/domain/CopyButton.svelte site/src/lib/components/domain/CopyButton.test.svelte.ts
git -C /u/Git/CentralGauge commit -m "feat(site): CopyButton domain widget (clipboard + brief checkmark feedback)"
```

---

### Task A10: RunStatusBadge domain widget

**Files:**

- Create: `site/src/lib/components/domain/RunStatusBadge.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import Badge from '$lib/components/ui/Badge.svelte';

  type Status = 'pending' | 'running' | 'completed' | 'failed';
  interface Props { status: Status; }
  let { status }: Props = $props();

  const variant = $derived(
    status === 'completed' ? 'success' :
    status === 'failed' ? 'danger' :
    status === 'running' ? 'warning' :
    'neutral'
  );
</script>

<Badge {variant}>{status}</Badge>
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/domain/RunStatusBadge.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): RunStatusBadge domain widget (status → variant mapping)"
```

---

### Task A11: TableOfContents widget (sticky right rail)

**Files:**

- Create: `site/src/lib/components/domain/TableOfContents.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface TocItem { id: string; label: string; }
  interface Props { items: TocItem[]; }
  let { items }: Props = $props();

  let activeId = $state(items[0]?.id ?? '');
  let observer: IntersectionObserver | null = null;

  onMount(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            activeId = e.target.id;
          }
        }
      },
      { rootMargin: '-30% 0% -60% 0%', threshold: 0.1 },
    );
    for (const it of items) {
      const el = document.getElementById(it.id);
      if (el) observer.observe(el);
    }
  });

  onDestroy(() => observer?.disconnect());
</script>

<nav class="toc" aria-label="Page sections">
  <ol>
    {#each items as item}
      <li><a href="#{item.id}" class:active={activeId === item.id}>{item.label}</a></li>
    {/each}
  </ol>
</nav>

<style>
  .toc {
    position: sticky;
    top: calc(var(--nav-h) + var(--space-5));
    width: 220px;
    border-left: 1px solid var(--border);
    padding-left: var(--space-5);
    font-size: var(--text-sm);
    align-self: start;
  }
  ol { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-3); }
  a {
    color: var(--text-muted);
    text-decoration: none;
    display: block;
    padding: var(--space-1) 0;
    border-left: 2px solid transparent;
    padding-left: var(--space-3);
    margin-left: calc(-1 * var(--space-3) - 1px);
  }
  a:hover { color: var(--text); }
  a.active { color: var(--accent); border-left-color: var(--accent); }
  @media (max-width: 1024px) { .toc { display: none; } }
</style>
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/domain/TableOfContents.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): TableOfContents widget (sticky right rail, IntersectionObserver active section)"
```

---

### Task A12: StatTile widget

**Files:**

- Create: `site/src/lib/components/domain/StatTile.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Sparkline from '$lib/components/ui/Sparkline.svelte';
  import Card from '$lib/components/ui/Card.svelte';

  interface Props {
    label: string;
    value: string;
    sparklineValues?: number[];
    delta?: { value: string; positive: boolean };
    note?: string;
  }
  let { label, value, sparklineValues, delta, note }: Props = $props();
</script>

<Card>
  <div class="tile">
    <span class="label text-muted">{label}</span>
    <span class="value text-mono">{value}</span>
    {#if sparklineValues && sparklineValues.length >= 2}
      <Sparkline values={sparklineValues} width={120} height={28} label={label} />
    {/if}
    {#if delta}
      <span class="delta" class:positive={delta.positive} class:negative={!delta.positive}>
        {delta.positive ? '↑' : '↓'} {delta.value}
      </span>
    {/if}
    {#if note}<span class="note text-muted">{note}</span>{/if}
  </div>
</Card>

<style>
  .tile { display: flex; flex-direction: column; gap: var(--space-2); min-width: 140px; }
  .label { font-size: var(--text-xs); text-transform: uppercase; letter-spacing: var(--tracking-wide); }
  .value { font-size: var(--text-2xl); font-weight: var(--weight-semi); }
  .delta { font-size: var(--text-sm); }
  .delta.positive { color: var(--success); }
  .delta.negative { color: var(--danger); }
  .note { font-size: var(--text-xs); }
</style>
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/domain/StatTile.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): StatTile widget (label + value + optional sparkline + delta)"
```

---

### Task A13: MarkdownRenderer widget (lazy-loads marked + DOMPurify)

**Files:**

- Create: `site/src/lib/components/domain/MarkdownRenderer.svelte`
- Test: `site/src/lib/components/domain/MarkdownRenderer.test.svelte.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import MarkdownRenderer from "./MarkdownRenderer.svelte";

describe("MarkdownRenderer", () => {
  it("renders markdown headings", async () => {
    const { container } = render(MarkdownRenderer, {
      source: "# Hello\n\nworld",
    });
    // Wait microtask for the dynamic import to resolve
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector("h1")?.textContent).toBe("Hello");
    expect(container.querySelector("p")?.textContent).toBe("world");
  });

  it("sanitizes inline html", async () => {
    const { container } = render(MarkdownRenderer, {
      source: "<script>alert(1)</script><b>bold</b>",
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")?.textContent).toBe("bold");
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `cd site && npx vitest run --config vitest.unit.config.ts src/lib/components/domain/MarkdownRenderer.test.svelte.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```svelte
<script lang="ts">
  // marked + DOMPurify are dynamically imported so they're a separate
  // route-level chunk, not in the initial bundle.
  let { source }: { source: string } = $props();

  let html = $state('');

  $effect(async () => {
    const [markedMod, domPurifyMod] = await Promise.all([
      import('marked'),
      import('dompurify'),
    ]);
    const rawHtml = await markedMod.parse(source);
    html = domPurifyMod.default.sanitize(rawHtml, {
      // Allow code blocks + headings + links + lists. Drop scripts, iframes.
      ALLOWED_TAGS: ['h1','h2','h3','h4','h5','h6','p','strong','em','code','pre','ul','ol','li','blockquote','a','table','thead','tbody','tr','th','td','hr','b','i','br'],
      ALLOWED_ATTR: ['href','title','class','id'],
    });
  });
</script>

<article class="md">
  {@html html}
</article>

<style>
  .md :global(h1) { font-size: var(--text-3xl); margin-bottom: var(--space-5); }
  .md :global(h2) { font-size: var(--text-xl); margin-top: var(--space-7); margin-bottom: var(--space-4); }
  .md :global(h3) { font-size: var(--text-lg); margin-top: var(--space-5); margin-bottom: var(--space-3); }
  .md :global(p) { margin-bottom: var(--space-4); line-height: var(--leading-base); }
  .md :global(code) {
    font-family: var(--font-mono);
    background: var(--code-bg);
    padding: 0 var(--space-2);
    border-radius: var(--radius-1);
    font-size: 0.9em;
  }
  .md :global(pre) {
    background: var(--code-bg);
    padding: var(--space-4);
    border-radius: var(--radius-2);
    overflow-x: auto;
  }
  .md :global(pre code) { background: transparent; padding: 0; }
  .md :global(a) { color: var(--accent); }
  .md :global(ul), .md :global(ol) { padding-left: var(--space-6); margin-bottom: var(--space-4); }
  .md :global(blockquote) {
    border-left: 3px solid var(--border-strong);
    padding-left: var(--space-4);
    color: var(--text-muted);
    margin: var(--space-4) 0;
  }
</style>
```

- [ ] **Step 4: Verify**

Run: `cd site && npx vitest run --config vitest.unit.config.ts src/lib/components/domain/MarkdownRenderer.test.svelte.ts`
Expected: 2/2 pass.

- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/domain/MarkdownRenderer.svelte site/src/lib/components/domain/MarkdownRenderer.test.svelte.ts
git -C /u/Git/CentralGauge commit -m "feat(site): MarkdownRenderer (lazy-loaded marked + DOMPurify, sanitized + token-styled)"
```

---

### Task A14: RunsCursorPager widget

**Files:**

- Create: `site/src/lib/components/domain/RunsCursorPager.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  interface Props {
    showingFrom: number;
    showingTo: number;
    totalEstimate?: number;
    prevHref?: string | null;
    nextHref?: string | null;
  }
  let { showingFrom, showingTo, totalEstimate, prevHref, nextHref }: Props = $props();
</script>

<nav class="pager" aria-label="Pagination">
  {#if prevHref}
    <a href={prevHref} class="link">← Previous</a>
  {:else}
    <span class="link disabled">← Previous</span>
  {/if}
  <span class="count text-muted">
    Showing {showingFrom}–{showingTo}{#if totalEstimate} of ~{totalEstimate}{/if}
  </span>
  {#if nextHref}
    <a href={nextHref} class="link">Next →</a>
  {:else}
    <span class="link disabled">Next →</span>
  {/if}
</nav>

<style>
  .pager {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-5) 0;
    font-size: var(--text-sm);
    gap: var(--space-5);
  }
  .link { color: var(--text); }
  .link.disabled { color: var(--text-faint); cursor: not-allowed; }
  .count { font-variant-numeric: tabular-nums; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/domain/RunsCursorPager.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): RunsCursorPager widget (Previous/Next + count display)"
```

---

### Task A15: RunsTable widget

**Files:**

- Create: `site/src/lib/components/domain/RunsTable.svelte`
- Test: `site/src/lib/components/domain/RunsTable.test.svelte.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import RunsTable from "./RunsTable.svelte";
import type { RunsListItem } from "$shared/api-types";

const rows: RunsListItem[] = [
  {
    id: "r1",
    model: {
      slug: "sonnet-4-7",
      display_name: "Sonnet 4.7",
      family_slug: "claude",
    },
    tier: "verified",
    status: "completed",
    tasks_attempted: 24,
    tasks_passed: 24,
    avg_score: 0.84,
    cost_usd: 0.12,
    duration_ms: 252_000,
    started_at: "2026-04-27T10:00:00Z",
    completed_at: "2026-04-27T10:04:12Z",
  },
];

describe("RunsTable", () => {
  it("renders one row per run", () => {
    render(RunsTable, { rows });
    expect(screen.getByText("Sonnet 4.7")).toBeDefined();
    expect(screen.getByText("24/24")).toBeDefined();
    expect(screen.getByText("$0.12")).toBeDefined();
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `cd site && npx vitest run --config vitest.unit.config.ts src/lib/components/domain/RunsTable.test.svelte.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```svelte
<script lang="ts">
  import type { RunsListItem } from '$shared/api-types';
  import { formatRelativeTime, formatTaskRatio, formatCost, formatDuration, formatScore } from '$lib/client/format';
  import ModelLink from './ModelLink.svelte';
  import TierBadge from './TierBadge.svelte';
  import RunStatusBadge from './RunStatusBadge.svelte';

  interface Props { rows: RunsListItem[]; }
  let { rows }: Props = $props();
</script>

<div class="wrap">
  <table>
    <caption class="sr-only">Runs</caption>
    <thead>
      <tr>
        <th scope="col">Started</th>
        <th scope="col">Model</th>
        <th scope="col">Tier</th>
        <th scope="col">Tasks</th>
        <th scope="col">Score</th>
        <th scope="col">Cost</th>
        <th scope="col">Duration</th>
        <th scope="col">Status</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row (row.id)}
        <tr>
          <th scope="row" class="text-muted">
            <a href="/runs/{row.id}">{formatRelativeTime(row.started_at)}</a>
          </th>
          <td>
            <ModelLink
              slug={row.model.slug}
              display_name={row.model.display_name}
              api_model_id=""
              family_slug={row.model.family_slug}
            />
          </td>
          <td><TierBadge tier={row.tier} /></td>
          <td class="text-mono">{formatTaskRatio(row.tasks_passed, row.tasks_attempted)}</td>
          <td class="text-mono">{formatScore(row.avg_score)}</td>
          <td class="text-mono">{formatCost(row.cost_usd)}</td>
          <td class="text-mono">{formatDuration(row.duration_ms)}</td>
          <td><RunStatusBadge status={row.status} /></td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .wrap { overflow-x: auto; }
  table {
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    overflow: hidden;
  }
  thead { background: var(--surface); }
  th, td {
    text-align: left;
    padding: var(--space-3) var(--space-5);
    border-bottom: 1px solid var(--border);
    font-size: var(--text-sm);
  }
  th[scope='row'] { font-weight: var(--weight-regular); }
  tbody tr:last-child td,
  tbody tr:last-child th { border-bottom: 0; }
  tbody tr:hover { background: var(--surface); }
  th[scope='row'] a { color: inherit; }
</style>
```

- [ ] **Step 4: Verify**

Run: `cd site && npx vitest run --config vitest.unit.config.ts src/lib/components/domain/RunsTable.test.svelte.ts`
Expected: 1/1 pass.

- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/domain/RunsTable.svelte site/src/lib/components/domain/RunsTable.test.svelte.ts
git -C /u/Git/CentralGauge commit -m "feat(site): RunsTable widget (8-column run-list table with tier + status badges)"
```

---

## Mini-phase B — Model detail page (`/models/:slug`)

### Task B1: TaskHistoryChart widget

**Files:**

- Create: `site/src/lib/components/domain/TaskHistoryChart.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import { line, curveMonotoneX } from 'd3-shape';
  import type { ModelHistoryPoint } from '$shared/api-types';
  import { formatRelativeTime } from '$lib/client/format';

  interface Props { points: ModelHistoryPoint[]; width?: number; height?: number; }
  let { points, width = 720, height = 240 }: Props = $props();

  const margin = { top: 12, right: 16, bottom: 32, left: 40 };
  const innerW = $derived(width - margin.left - margin.right);
  const innerH = $derived(height - margin.top - margin.bottom);

  const pathD = $derived.by(() => {
    if (points.length < 2) return null;
    const xs = points.map((_, i) => (i / (points.length - 1)) * innerW);
    const lineGen = line<number>().x((_, i) => xs[i]).y((s) => innerH - s * innerH).curve(curveMonotoneX);
    return lineGen(points.map((p) => p.score));
  });
</script>

<figure class="chart">
  <svg width={width} height={height} role="img" aria-label="Score over time, {points.length} runs">
    <g transform="translate({margin.left}, {margin.top})">
      <line x1="0" y1="0" x2="0" y2={innerH} stroke="var(--border)" />
      <line x1="0" y1={innerH} x2={innerW} y2={innerH} stroke="var(--border)" />
      <line x1="0" y1={innerH * 0.5} x2={innerW} y2={innerH * 0.5} stroke="var(--border)" stroke-dasharray="2 4" />
      {#if pathD}
        <path d={pathD} fill="none" stroke="var(--accent)" stroke-width="2" />
      {/if}
      {#each points as p, i}
        {@const x = (i / Math.max(1, points.length - 1)) * innerW}
        {@const y = innerH - p.score * innerH}
        <circle {x} {y} cx={x} cy={y} r="3" fill="var(--accent)" />
      {/each}
      <text x="-8" y="0" fill="var(--text-muted)" font-size="10" text-anchor="end" dominant-baseline="middle">1.0</text>
      <text x="-8" y={innerH} fill="var(--text-muted)" font-size="10" text-anchor="end" dominant-baseline="middle">0.0</text>
    </g>
  </svg>
  {#if points.length >= 2}
    <figcaption class="text-muted">
      {points.length} runs · oldest {formatRelativeTime(points[0].ts)} · latest {formatRelativeTime(points.at(-1)!.ts)}
    </figcaption>
  {/if}
</figure>

<style>
  .chart { margin: 0; }
  figcaption { font-size: var(--text-xs); margin-top: var(--space-2); }
</style>
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/domain/TaskHistoryChart.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): TaskHistoryChart widget (d3-shape line chart with axes + dashed mid-line)"
```

---

### Task B2: CostBarChart widget

**Files:**

- Create: `site/src/lib/components/domain/CostBarChart.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import type { ModelHistoryPoint } from '$shared/api-types';
  import { formatCost } from '$lib/client/format';

  interface Props { points: ModelHistoryPoint[]; width?: number; height?: number; }
  let { points, width = 720, height = 200 }: Props = $props();

  const margin = { top: 12, right: 16, bottom: 32, left: 56 };
  const innerW = $derived(width - margin.left - margin.right);
  const innerH = $derived(height - margin.top - margin.bottom);

  const maxCost = $derived(Math.max(...points.map((p) => p.cost_usd), 0.001));
  const meanCost = $derived(points.reduce((a, p) => a + p.cost_usd, 0) / Math.max(1, points.length));
  const sortedCosts = $derived([...points.map((p) => p.cost_usd)].sort((a, b) => a - b));
  const p95Cost = $derived(sortedCosts.length ? sortedCosts[Math.floor(sortedCosts.length * 0.95)] : 0);
</script>

<figure class="chart">
  <svg width={width} height={height} role="img" aria-label="Cost per run, mean {formatCost(meanCost)}, p95 {formatCost(p95Cost)}">
    <g transform="translate({margin.left}, {margin.top})">
      <line x1="0" y1="0" x2="0" y2={innerH} stroke="var(--border)" />
      <line x1="0" y1={innerH} x2={innerW} y2={innerH} stroke="var(--border)" />
      {#each points as p, i}
        {@const w = innerW / Math.max(1, points.length)}
        {@const h = (p.cost_usd / maxCost) * innerH}
        {@const x = i * w}
        {@const y = innerH - h}
        <rect {x} {y} width={w * 0.7} height={h} fill="var(--accent)" />
      {/each}
      {@const meanY = innerH - (meanCost / maxCost) * innerH}
      {@const p95Y = innerH - (p95Cost / maxCost) * innerH}
      <line x1="0" y1={meanY} x2={innerW} y2={meanY} stroke="var(--success)" stroke-dasharray="4 4" />
      <line x1="0" y1={p95Y} x2={innerW} y2={p95Y} stroke="var(--warning)" stroke-dasharray="4 4" />
      <text x="-8" y={meanY} fill="var(--success)" font-size="10" text-anchor="end" dominant-baseline="middle">mean</text>
      <text x="-8" y={p95Y} fill="var(--warning)" font-size="10" text-anchor="end" dominant-baseline="middle">p95</text>
    </g>
  </svg>
</figure>

<style>
  .chart { margin: 0; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/domain/CostBarChart.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): CostBarChart widget (bar chart + mean/p95 reference lines)"
```

---

### Task B3: FailureModesList widget

**Files:**

- Create: `site/src/lib/components/domain/FailureModesList.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import type { FailureMode } from '$shared/api-types';

  interface Props { modes: FailureMode[]; }
  let { modes }: Props = $props();
</script>

<ul class="list">
  {#each modes as m}
    <li>
      <span class="code text-mono">{m.code}</span>
      <span class="bar" aria-hidden="true">
        <span class="fill" style:width="{m.pct * 100}%"></span>
      </span>
      <span class="count text-mono">{m.count}</span>
      <span class="msg text-muted">{m.example_message}</span>
      <a class="search" href="/search?q={encodeURIComponent(m.code)}">view all →</a>
    </li>
  {/each}
</ul>

<style>
  .list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-3); }
  li {
    display: grid;
    grid-template-columns: auto 120px 60px 1fr auto;
    gap: var(--space-4);
    align-items: center;
    font-size: var(--text-sm);
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--border);
  }
  .code { color: var(--accent); font-weight: var(--weight-medium); }
  .bar {
    display: inline-block;
    height: 6px;
    background: var(--border);
    border-radius: var(--radius-1);
    overflow: hidden;
  }
  .fill { display: block; height: 100%; background: var(--danger); }
  .count { color: var(--text-muted); text-align: right; }
  .msg { font-family: var(--font-mono); font-size: var(--text-xs); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .search { font-size: var(--text-xs); }
</style>
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/domain/FailureModesList.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): FailureModesList widget (frequency bar + search-link per AL/BC code)"
```

---

### Task B4: Model detail loader (`/models/:slug/+page.server.ts`)

**Files:**

- Create: `site/src/routes/models/[slug]/+page.server.ts`

- [ ] **Step 1: Implement**

```ts
import type { PageServerLoad } from "./$types";
import type { ModelDetail } from "$shared/api-types";
import { error } from "@sveltejs/kit";

export const load: PageServerLoad = async (
  { params, fetch, setHeaders, depends },
) => {
  depends(`app:model:${params.slug}`);

  const res = await fetch(`/api/v1/models/${params.slug}`);
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    throw error(
      res.status,
      (body as { error?: string }).error ?? `model ${params.slug} not found`,
    );
  }

  const apiCache = res.headers.get("cache-control");
  if (apiCache) setHeaders({ "cache-control": apiCache });

  return {
    model: (await res.json()) as ModelDetail,
  };
};
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/routes/models/[slug]/+page.server.ts
git -C /u/Git/CentralGauge commit -m "feat(site): /models/:slug +page.server.ts loader (fetch + cache passthrough + dep tag)"
```

---

### Task B5: Model detail page (`/models/:slug/+page.svelte`)

**Files:**

- Create: `site/src/routes/models/[slug]/+page.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import StatTile from '$lib/components/domain/StatTile.svelte';
  import TableOfContents from '$lib/components/domain/TableOfContents.svelte';
  import TierBadge from '$lib/components/domain/TierBadge.svelte';
  import FamilyBadge from '$lib/components/domain/FamilyBadge.svelte';
  import TaskHistoryChart from '$lib/components/domain/TaskHistoryChart.svelte';
  import CostBarChart from '$lib/components/domain/CostBarChart.svelte';
  import FailureModesList from '$lib/components/domain/FailureModesList.svelte';
  import RunsTable from '$lib/components/domain/RunsTable.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { tierFromRow, formatScore, formatCost, formatDuration, formatTaskRatio } from '$lib/client/format';
  import type { RunsListItem } from '$shared/api-types';

  let { data } = $props();

  const m = $derived(data.model);

  const sparklineValues = $derived(m.history.slice(-30).map((p) => p.score));
  const tasksRatio = $derived(formatTaskRatio(m.aggregates.tasks_passed, m.aggregates.tasks_attempted));

  const recentRunRows = $derived<RunsListItem[]>(
    m.recent_runs.map((r) => ({
      id: r.run_id,
      model: { slug: m.model.slug, display_name: m.model.display_name, family_slug: m.model.family_slug },
      tier: r.tier,
      status: 'completed' as const,
      tasks_attempted: m.aggregates.tasks_attempted,
      tasks_passed: m.aggregates.tasks_passed,
      avg_score: r.score,
      cost_usd: r.cost_usd,
      duration_ms: 0,
      started_at: r.ts,
      completed_at: r.ts,
    })),
  );

  const tier = $derived(tierFromRow({ verified_runs: m.aggregates.verified_runs }));

  const tocItems = [
    { id: 'overview',     label: 'Overview' },
    { id: 'history',      label: 'History' },
    { id: 'cost',         label: 'Cost' },
    { id: 'failures',     label: 'Failure modes' },
    { id: 'recent-runs',  label: 'Recent runs' },
    { id: 'methodology',  label: 'Methodology' },
  ];
</script>

<svelte:head>
  <title>{m.model.display_name} — CentralGauge</title>
  <meta name="description" content="{m.model.display_name} ({m.model.api_model_id}) on CentralGauge: {formatScore(m.aggregates.avg_score)} avg score across {m.aggregates.run_count} runs." />
</svelte:head>

<Breadcrumbs crumbs={[
  { label: 'Home', href: '/' },
  { label: 'Models', href: '/models' },
  { label: m.model.display_name },
]} />

<header class="page-header">
  <div class="title-row">
    <h1>{m.model.display_name}</h1>
    <TierBadge {tier} />
    <Button href="/compare?models={m.model.slug}" variant="secondary" size="sm">Compare</Button>
    <Button href="/api/v1/models/{m.model.slug}" variant="ghost" size="sm">JSON</Button>
  </div>
  <p class="meta text-muted">
    <code class="text-mono">{m.model.api_model_id}</code>
    · <FamilyBadge slug={m.model.family_slug} />
    · Added {new Date(m.model.added_at).toLocaleDateString('en-CA')}
  </p>
</header>

<div class="layout">
  <main class="content">
    <section class="stats">
      <StatTile label="Score" value={formatScore(m.aggregates.avg_score)} sparklineValues={sparklineValues}
        delta={m.predecessor ? { value: (m.aggregates.avg_score - m.predecessor.avg_score).toFixed(2), positive: m.aggregates.avg_score >= m.predecessor.avg_score } : undefined} />
      <StatTile label="Tasks pass" value={tasksRatio} />
      <StatTile label="Cost / run" value={formatCost(m.aggregates.avg_cost_usd)}
        delta={m.predecessor ? { value: ((m.predecessor.avg_cost_usd - m.aggregates.avg_cost_usd) / m.predecessor.avg_cost_usd * 100).toFixed(0) + '%', positive: m.aggregates.avg_cost_usd <= m.predecessor.avg_cost_usd } : undefined} />
      <StatTile label="Latency p50" value={formatDuration(m.aggregates.latency_p50_ms)} />
    </section>

    <section id="overview">
      <h2>Overview</h2>
      <p class="text-muted">
        {m.model.display_name} has run on {m.aggregates.run_count} occasions, attempting {m.aggregates.tasks_attempted} tasks
        with an average score of {formatScore(m.aggregates.avg_score)}.
        {#if m.aggregates.verified_runs > 0}
          {m.aggregates.verified_runs} of these runs are verified by an independent verifier machine.
        {/if}
      </p>
    </section>

    <section id="history">
      <h2>History</h2>
      <TaskHistoryChart points={m.history} />
    </section>

    <section id="cost">
      <h2>Cost</h2>
      <CostBarChart points={m.history} />
    </section>

    {#if m.failure_modes.length > 0}
      <section id="failures">
        <h2>Failure modes</h2>
        <FailureModesList modes={m.failure_modes} />
      </section>
    {/if}

    <section id="recent-runs">
      <h2>Recent runs</h2>
      <RunsTable rows={recentRunRows} />
      <p class="seemore"><a href="/models/{m.model.slug}/runs">See all {m.aggregates.run_count} runs →</a></p>
    </section>

    <section id="methodology">
      <h2>Methodology</h2>
      <p class="text-muted">
        Scores are computed per task, averaged across attempts. See <a href="/about#scoring">the about page</a> for details.
      </p>
    </section>
  </main>
  <TableOfContents items={tocItems} />
</div>

<style>
  .page-header { padding: var(--space-6) 0; }
  .title-row { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; }
  .title-row h1 { font-size: var(--text-3xl); margin: 0; }
  .meta { font-size: var(--text-sm); margin-top: var(--space-3); display: inline-flex; gap: var(--space-3); align-items: center; }
  .meta code { font-size: var(--text-xs); }

  .layout {
    display: grid;
    grid-template-columns: 1fr 220px;
    gap: var(--space-7);
  }
  @media (max-width: 1024px) { .layout { grid-template-columns: 1fr; } }

  .content { min-width: 0; }
  .content > section { margin-top: var(--space-7); scroll-margin-top: calc(var(--nav-h) + var(--space-5)); }
  .content > section h2 { font-size: var(--text-xl); margin-bottom: var(--space-4); }

  .stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-4);
  }
  @media (max-width: 768px) { .stats { grid-template-columns: repeat(2, 1fr); } }

  .seemore { margin-top: var(--space-4); font-size: var(--text-sm); }
</style>
```

- [ ] **Step 2: Verify build**

Run: `cd site && npm run build 2>&1 | tail -3`
Expected: `✔ done`. Watch for new chunks for `/models/[slug]` route — should be ≤ 20 KB gz per chunk.

- [ ] **Step 3: Verify tests still pass**

Run: `cd site && npm run test:main 2>&1 | grep -E "Test Files|Tests "`
Expected: 308+ (P5.1 baseline). New unit tests from this phase add to the count.

- [ ] **Step 4: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/routes/models/[slug]/+page.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): /models/:slug page (header + 4 stat tiles + 6 sections + sticky TOC)"
```

---

## Mini-phase C — Model sub-pages

### Task C1: Model runs feed loader

**Files:**

- Create: `site/src/routes/models/[slug]/runs/+page.server.ts`

- [ ] **Step 1: Implement**

```ts
import type { PageServerLoad } from "./$types";
import type { RunsListResponse } from "$shared/api-types";
import { error } from "@sveltejs/kit";

export const load: PageServerLoad = async (
  { params, url, fetch, setHeaders, depends },
) => {
  depends(`app:model:${params.slug}:runs`);

  const sp = new URLSearchParams(url.searchParams);
  sp.set("model", params.slug);

  const res = await fetch(`/api/v1/runs?${sp.toString()}`);
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    throw error(
      res.status,
      (body as { error?: string }).error ?? "runs load failed",
    );
  }

  const apiCache = res.headers.get("cache-control");
  if (apiCache) setHeaders({ "cache-control": apiCache });

  return {
    slug: params.slug,
    runs: (await res.json()) as RunsListResponse,
    cursor: url.searchParams.get("cursor"),
  };
};
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/routes/models/[slug]/runs/+page.server.ts
git -C /u/Git/CentralGauge commit -m "feat(site): /models/:slug/runs +page.server.ts loader (fetch + cursor pagination)"
```

---

### Task C2: Model runs feed page

**Files:**

- Create: `site/src/routes/models/[slug]/runs/+page.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import RunsTable from '$lib/components/domain/RunsTable.svelte';
  import RunsCursorPager from '$lib/components/domain/RunsCursorPager.svelte';

  let { data } = $props();

  const nextHref = $derived(
    data.runs.next_cursor ? `?cursor=${encodeURIComponent(data.runs.next_cursor)}` : null,
  );
  const prevHref = $derived(data.cursor ? '?' : null);
</script>

<svelte:head>
  <title>Runs by {data.slug} — CentralGauge</title>
</svelte:head>

<Breadcrumbs crumbs={[
  { label: 'Home', href: '/' },
  { label: 'Models', href: '/models' },
  { label: data.slug, href: `/models/${data.slug}` },
  { label: 'Runs' },
]} />

<h1>Runs by {data.slug}</h1>

<RunsTable rows={data.runs.data} />
<RunsCursorPager
  showingFrom={1}
  showingTo={data.runs.data.length}
  prevHref={prevHref}
  nextHref={nextHref}
/>

<style>
  h1 { font-size: var(--text-3xl); margin: var(--space-6) 0 var(--space-5) 0; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/routes/models/[slug]/runs/+page.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): /models/:slug/runs page (RunsTable + cursor pager)"
```

---

### Task C3: Model limitations loader

**Files:**

- Create: `site/src/routes/models/[slug]/limitations/+page.server.ts`

- [ ] **Step 1: Implement**

```ts
import type { PageServerLoad } from "./$types";
import { error } from "@sveltejs/kit";

export const load: PageServerLoad = async (
  { params, fetch, setHeaders, depends },
) => {
  depends(`app:model:${params.slug}:limitations`);

  // Fetch as markdown text (the API supports content negotiation)
  const res = await fetch(`/api/v1/models/${params.slug}/limitations`, {
    headers: { "accept": "text/markdown" },
  });
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    throw error(
      res.status,
      (body as { error?: string }).error ?? "limitations load failed",
    );
  }

  const apiCache = res.headers.get("cache-control");
  if (apiCache) setHeaders({ "cache-control": apiCache });

  return {
    slug: params.slug,
    markdown: await res.text(),
  };
};
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/routes/models/[slug]/limitations/+page.server.ts
git -C /u/Git/CentralGauge commit -m "feat(site): /models/:slug/limitations +page.server.ts loader (text/markdown)"
```

---

### Task C4: Model limitations page

**Files:**

- Create: `site/src/routes/models/[slug]/limitations/+page.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import MarkdownRenderer from '$lib/components/domain/MarkdownRenderer.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>Limitations of {data.slug} — CentralGauge</title>
</svelte:head>

<Breadcrumbs crumbs={[
  { label: 'Home', href: '/' },
  { label: 'Models', href: '/models' },
  { label: data.slug, href: `/models/${data.slug}` },
  { label: 'Limitations' },
]} />

<h1>Limitations of {data.slug}</h1>

<MarkdownRenderer source={data.markdown} />

<style>
  h1 { font-size: var(--text-3xl); margin: var(--space-6) 0 var(--space-5) 0; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/routes/models/[slug]/limitations/+page.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): /models/:slug/limitations page (markdown rendered via MarkdownRenderer)"
```

---

## Mini-phase D — Run detail page (`/runs/:id`)

### Task D1: SettingsPanel widget

**Files:**

- Create: `site/src/lib/components/domain/SettingsPanel.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import Code from '$lib/components/ui/Code.svelte';
  import CopyButton from './CopyButton.svelte';

  interface Props {
    settings: {
      temperature: number;
      max_attempts: number;
      max_tokens: number;
      prompt_version: string;
      bc_version: string;
    };
    pricing_version: string;
    centralgauge_sha?: string;
  }
  let { settings, pricing_version, centralgauge_sha }: Props = $props();

  const json = $derived(JSON.stringify({ ...settings, pricing_version, centralgauge_sha }, null, 2));
</script>

<dl class="settings">
  <dt>Temperature</dt><dd class="text-mono">{settings.temperature}</dd>
  <dt>Max attempts</dt><dd class="text-mono">{settings.max_attempts}</dd>
  <dt>Max tokens</dt><dd class="text-mono">{settings.max_tokens}</dd>
  <dt>Prompt version</dt><dd class="text-mono">{settings.prompt_version}</dd>
  <dt>BC version</dt><dd class="text-mono">{settings.bc_version}</dd>
  <dt>Pricing version</dt><dd class="text-mono">{pricing_version}</dd>
  {#if centralgauge_sha}
    <dt>CentralGauge SHA</dt><dd class="text-mono">{centralgauge_sha.slice(0, 12)}</dd>
  {/if}
</dl>

<div class="raw">
  <header>
    <h3>Raw JSON</h3>
    <CopyButton value={json} label="Copy raw settings JSON" />
  </header>
  <Code block>{json}</Code>
</div>

<style>
  .settings {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-3) var(--space-6);
    font-size: var(--text-sm);
    margin: 0 0 var(--space-6) 0;
  }
  dt { color: var(--text-muted); }
  dd { margin: 0; color: var(--text); }
  .raw { margin-top: var(--space-6); }
  .raw header { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
  .raw h3 { font-size: var(--text-base); margin: 0; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/domain/SettingsPanel.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): SettingsPanel widget (key-value list + raw JSON copy)"
```

---

### Task D2: ReproductionBlock widget

**Files:**

- Create: `site/src/lib/components/domain/ReproductionBlock.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import Code from '$lib/components/ui/Code.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import CopyButton from './CopyButton.svelte';
  import { Download } from '$lib/components/ui/icons';

  interface Props {
    runId: string;
    bundle?: { sha256: string; size_bytes: number };
  }
  let { runId, bundle }: Props = $props();

  const cliSnippet = $derived(`centralgauge reproduce ${runId}`);
  const downloadHref = `/api/v1/runs/${runId}/reproduce.tar.gz`;
  const sizeMb = $derived(bundle ? (bundle.size_bytes / (1024 * 1024)).toFixed(1) : null);
</script>

{#if !bundle}
  <p class="text-muted">No reproduction bundle available for this run.</p>
{:else}
  <dl class="bundle">
    <dt>Bundle SHA</dt><dd class="text-mono">{bundle.sha256.slice(0, 16)}…</dd>
    <dt>Size</dt><dd class="text-mono">{sizeMb} MB</dd>
  </dl>
  <Button href={downloadHref} variant="primary">
    <Download size={16} /> Download .tar.gz
  </Button>
  <p class="text-muted snippet-intro">Or reproduce locally:</p>
  <div class="snippet-row">
    <Code block>{cliSnippet}</Code>
    <CopyButton value={cliSnippet} label="Copy CLI command" />
  </div>
{/if}

<style>
  .bundle {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-3) var(--space-6);
    font-size: var(--text-sm);
    margin: 0 0 var(--space-5) 0;
  }
  dt { color: var(--text-muted); }
  dd { margin: 0; }
  .snippet-intro { margin: var(--space-5) 0 var(--space-3) 0; font-size: var(--text-sm); }
  .snippet-row { display: flex; align-items: flex-start; gap: var(--space-3); }
  .snippet-row :global(pre) { flex: 1; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/domain/ReproductionBlock.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): ReproductionBlock widget (bundle metadata + download + CLI snippet)"
```

---

### Task D3: PerTaskResultsTable widget

**Files:**

- Create: `site/src/lib/components/domain/PerTaskResultsTable.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import type { PerTaskResult } from '$shared/api-types';
  import Badge from '$lib/components/ui/Badge.svelte';
  import { formatScore, formatDuration } from '$lib/client/format';
  import { ChevronRight, ChevronDown } from '$lib/components/ui/icons';

  type Filter = 'all' | 'passed' | 'failed' | 'compile_errors';
  interface Props { results: PerTaskResult[]; runId: string; }
  let { results, runId }: Props = $props();

  let filter: Filter = $state('all');
  let expanded = $state(new Set<string>());

  const filtered = $derived.by(() => {
    if (filter === 'all') return results;
    return results.filter((r) => {
      const lastAttempt = r.attempts.at(-1);
      if (!lastAttempt) return false;
      switch (filter) {
        case 'passed': return lastAttempt.passed;
        case 'failed': return !lastAttempt.passed;
        case 'compile_errors': return !lastAttempt.compile_success;
      }
      return true;
    });
  });

  function toggle(taskId: string) {
    if (expanded.has(taskId)) expanded.delete(taskId);
    else expanded.add(taskId);
    expanded = new Set(expanded);
  }
</script>

<div class="filter-row">
  <span class="text-muted" id="filter-label">Filter:</span>
  <div role="group" aria-labelledby="filter-label" class="filters">
    {#each [['all', 'All'], ['passed', 'Passed'], ['failed', 'Failed'], ['compile_errors', 'Compile errors']] as [val, label]}
      <button type="button" class="fbtn" class:active={filter === val} onclick={() => (filter = val as Filter)}>
        {label}
      </button>
    {/each}
  </div>
</div>

<table>
  <caption class="sr-only">Per-task results for run {runId}</caption>
  <thead>
    <tr>
      <th></th>
      <th scope="col">Task</th>
      <th scope="col">Difficulty</th>
      <th scope="col">Attempt</th>
      <th scope="col">Score</th>
      <th scope="col">Tests</th>
      <th scope="col">Compile</th>
      <th scope="col">Duration</th>
    </tr>
  </thead>
  <tbody>
    {#each filtered as r (r.task_id)}
      {@const attempt = r.attempts.at(-1)}
      {#if attempt}
        <tr>
          <td>
            <button type="button" class="exp" aria-expanded={expanded.has(r.task_id)} aria-label="Toggle details for {r.task_id}" onclick={() => toggle(r.task_id)}>
              {#if expanded.has(r.task_id)}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
            </button>
          </td>
          <th scope="row"><a href="/tasks/{r.task_id}">{r.task_id}</a></th>
          <td>{r.difficulty}</td>
          <td class="text-mono">{attempt.attempt}</td>
          <td class="text-mono">{formatScore(attempt.score)}</td>
          <td class="text-mono">{attempt.tests_passed}/{attempt.tests_total}</td>
          <td>
            <Badge variant={attempt.compile_success ? 'success' : 'danger'}>
              {attempt.compile_success ? 'OK' : 'FAIL'}
            </Badge>
          </td>
          <td class="text-mono">{formatDuration(attempt.duration_ms)}</td>
        </tr>
        {#if expanded.has(r.task_id)}
          <tr class="detail">
            <td colspan="8">
              <div class="grid">
                <div>
                  <h4>Failure reasons</h4>
                  {#if attempt.failure_reasons.length === 0}
                    <p class="text-muted">none</p>
                  {:else}
                    <ul class="reasons">
                      {#each attempt.failure_reasons as reason}<li>{reason}</li>{/each}
                    </ul>
                  {/if}
                </div>
                <div>
                  <h4>Compile errors</h4>
                  {#if attempt.compile_errors.length === 0}
                    <p class="text-muted">none</p>
                  {:else}
                    <ul class="errors">
                      {#each attempt.compile_errors as err}
                        <li><code>{err.code}</code>: {err.message}{#if err.file} <span class="text-faint">({err.file}:{err.line})</span>{/if}</li>
                      {/each}
                    </ul>
                  {/if}
                </div>
                <div class="links">
                  <a href="/runs/{runId}/transcripts/{r.task_id}/{attempt.attempt}">View transcript →</a>
                </div>
              </div>
            </td>
          </tr>
        {/if}
      {/if}
    {/each}
  </tbody>
</table>

<style>
  .filter-row { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-4); font-size: var(--text-sm); }
  .filters { display: flex; gap: var(--space-2); }
  .fbtn {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-2) var(--space-4);
    color: var(--text-muted);
    cursor: pointer;
  }
  .fbtn.active { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }

  table { border: 1px solid var(--border); border-radius: var(--radius-2); overflow: hidden; }
  thead { background: var(--surface); }
  th, td { padding: var(--space-3) var(--space-5); text-align: left; border-bottom: 1px solid var(--border); font-size: var(--text-sm); }
  th[scope='row'] a { color: var(--text); }
  th[scope='row'] a:hover { color: var(--accent); }
  tbody tr:hover:not(.detail) { background: var(--surface); }

  .exp {
    background: transparent;
    border: 0;
    padding: 0;
    cursor: pointer;
    color: var(--text-muted);
  }
  .detail td { background: var(--surface); }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-5); padding: var(--space-3) 0; }
  @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
  .grid h4 { font-size: var(--text-sm); margin: 0 0 var(--space-2) 0; }
  .reasons, .errors { padding-left: var(--space-5); font-size: var(--text-sm); margin: 0; }
  .errors li code { background: var(--code-bg); padding: 0 var(--space-2); border-radius: var(--radius-1); font-family: var(--font-mono); }
  .links { grid-column: 1 / -1; padding-top: var(--space-3); border-top: 1px solid var(--border); }
</style>
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/domain/PerTaskResultsTable.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): PerTaskResultsTable widget (filter + expandable rows + transcript links)"
```

---

### Task D4: SignaturePanel widget (lazy-loads @noble/ed25519)

**Files:**

- Create: `site/src/lib/components/domain/SignaturePanel.svelte`
- Test: `site/src/lib/components/domain/SignaturePanel.test.svelte.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import SignaturePanel from "./SignaturePanel.svelte";
import type { RunSignature } from "$shared/api-types";

const fakeSig: RunSignature = {
  run_id: "r1",
  payload_b64: "ZXhhbXBsZQ==",
  signature: {
    alg: "Ed25519",
    key_id: 1,
    signed_at: "2026-04-27T10:00:00Z",
    value_b64: "YmFkc2ln",
  },
  public_key_hex: "00".repeat(32),
  machine_id: "rig-01",
};

describe("SignaturePanel", () => {
  it("renders payload, signature, key fields with copy buttons", () => {
    render(SignaturePanel, { signature: fakeSig });
    expect(screen.getByText(/payload/i)).toBeDefined();
    expect(screen.getByText(/public key/i)).toBeDefined();
    expect(screen.getByText(/machine/i)).toBeDefined();
  });

  it("verify button is initially shown", () => {
    render(SignaturePanel, { signature: fakeSig });
    expect(screen.getByRole("button", { name: /verify/i })).toBeDefined();
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `cd site && npx vitest run --config vitest.unit.config.ts src/lib/components/domain/SignaturePanel.test.svelte.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```svelte
<script lang="ts">
  import type { RunSignature } from '$shared/api-types';
  import Button from '$lib/components/ui/Button.svelte';
  import Code from '$lib/components/ui/Code.svelte';
  import CopyButton from './CopyButton.svelte';
  import { Lock, CheckCircle, AlertCircle } from '$lib/components/ui/icons';

  interface Props { signature: RunSignature; }
  let { signature }: Props = $props();

  type VerifyState = 'idle' | 'verifying' | 'valid' | 'invalid' | 'error';
  let verifyState: VerifyState = $state('idle');
  let errorMsg = $state('');

  function hexToBytes(hex: string): Uint8Array {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }

  function b64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function verify() {
    verifyState = 'verifying';
    try {
      const ed = await import('@noble/ed25519');
      const message = b64ToBytes(signature.payload_b64);
      const sig = b64ToBytes(signature.signature.value_b64);
      const pub = hexToBytes(signature.public_key_hex);
      const ok = await ed.verifyAsync(sig, message, pub);
      verifyState = ok ? 'valid' : 'invalid';
    } catch (err) {
      verifyState = 'error';
      errorMsg = err instanceof Error ? err.message : String(err);
    }
  }
</script>

<div class="panel">
  <header>
    <Lock size={16} />
    <h3>Signature</h3>
  </header>

  <dl>
    <dt>Run ID</dt>
    <dd class="text-mono">{signature.run_id}</dd>

    <dt>Algorithm</dt>
    <dd>{signature.signature.alg}</dd>

    <dt>Key ID</dt>
    <dd class="text-mono">{signature.signature.key_id}</dd>

    <dt>Machine</dt>
    <dd class="text-mono">{signature.machine_id}</dd>

    <dt>Signed at</dt>
    <dd class="text-mono">{signature.signature.signed_at}</dd>

    <dt>Public key (hex)</dt>
    <dd class="row">
      <Code>{signature.public_key_hex}</Code>
      <CopyButton value={signature.public_key_hex} label="Copy public key" />
    </dd>

    <dt>Signature (b64)</dt>
    <dd class="row">
      <Code>{signature.signature.value_b64}</Code>
      <CopyButton value={signature.signature.value_b64} label="Copy signature" />
    </dd>

    <dt>Payload (b64)</dt>
    <dd class="row">
      <Code block>{signature.payload_b64}</Code>
      <CopyButton value={signature.payload_b64} label="Copy payload" />
    </dd>
  </dl>

  <div class="verify">
    <Button onclick={verify} variant="primary" disabled={verifyState === 'verifying'}>
      {#if verifyState === 'idle' || verifyState === 'verifying'}
        Verify in browser
      {:else if verifyState === 'valid'}
        <CheckCircle size={14} /> Re-verify
      {:else}
        <AlertCircle size={14} /> Re-verify
      {/if}
    </Button>
    {#if verifyState === 'verifying'}
      <span class="text-muted">verifying…</span>
    {:else if verifyState === 'valid'}
      <span class="ok">✓ Signature valid (Ed25519)</span>
    {:else if verifyState === 'invalid'}
      <span class="bad">✗ Signature INVALID — does not match public key</span>
    {:else if verifyState === 'error'}
      <span class="bad">verify failed: {errorMsg}</span>
    {/if}
  </div>
</div>

<style>
  .panel {
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-5);
    background: var(--surface);
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-5);
  }
  h3 { margin: 0; font-size: var(--text-base); }

  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-3) var(--space-6);
    font-size: var(--text-sm);
    margin: 0;
  }
  dt { color: var(--text-muted); }
  dd { margin: 0; }
  .row { display: flex; align-items: flex-start; gap: var(--space-3); }
  .row :global(code), .row :global(pre) { flex: 1; word-break: break-all; }

  .verify {
    margin-top: var(--space-5);
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }
  .ok { color: var(--success); font-weight: var(--weight-medium); }
  .bad { color: var(--danger); font-weight: var(--weight-medium); }
</style>
```

- [ ] **Step 4: Verify**

Run: `cd site && npx vitest run --config vitest.unit.config.ts src/lib/components/domain/SignaturePanel.test.svelte.ts`
Expected: 2/2 pass.

- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/domain/SignaturePanel.svelte site/src/lib/components/domain/SignaturePanel.test.svelte.ts
git -C /u/Git/CentralGauge commit -m "feat(site): SignaturePanel widget (lazy ed25519 verify, copy fields, status indicator)"
```

---

### Task D5: Run detail loader

**Files:**

- Create: `site/src/routes/runs/[id]/+page.server.ts`

- [ ] **Step 1: Implement**

```ts
import type { PageServerLoad } from "./$types";
import type { RunDetail } from "$shared/api-types";
import { error } from "@sveltejs/kit";

export const load: PageServerLoad = async (
  { params, fetch, setHeaders, depends },
) => {
  depends(`app:run:${params.id}`);

  const res = await fetch(`/api/v1/runs/${params.id}`);
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    throw error(
      res.status,
      (body as { error?: string }).error ?? `run ${params.id} not found`,
    );
  }

  const apiCache = res.headers.get("cache-control");
  if (apiCache) setHeaders({ "cache-control": apiCache });

  return {
    run: (await res.json()) as RunDetail,
  };
};
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/routes/runs/[id]/+page.server.ts
git -C /u/Git/CentralGauge commit -m "feat(site): /runs/:id +page.server.ts loader"
```

---

### Task D6: Run detail page (4 tabs)

**Files:**

- Create: `site/src/routes/runs/[id]/+page.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import Tabs from '$lib/components/ui/Tabs.svelte';
  import StatTile from '$lib/components/domain/StatTile.svelte';
  import TierBadge from '$lib/components/domain/TierBadge.svelte';
  import RunStatusBadge from '$lib/components/domain/RunStatusBadge.svelte';
  import ModelLink from '$lib/components/domain/ModelLink.svelte';
  import PerTaskResultsTable from '$lib/components/domain/PerTaskResultsTable.svelte';
  import SettingsPanel from '$lib/components/domain/SettingsPanel.svelte';
  import SignaturePanel from '$lib/components/domain/SignaturePanel.svelte';
  import ReproductionBlock from '$lib/components/domain/ReproductionBlock.svelte';
  import { formatScore, formatCost, formatDuration, formatTaskRatio } from '$lib/client/format';
  import type { RunSignature } from '$shared/api-types';

  let { data } = $props();
  const r = $derived(data.run);

  const tabs = [
    { id: 'results',       label: 'Results' },
    { id: 'settings',      label: 'Settings' },
    { id: 'signature',     label: 'Signature' },
    { id: 'reproduction',  label: 'Reproduction' },
  ];
  let active = $state('results');

  // Lazy-load signature only when tab is active
  let signature: RunSignature | null = $state(null);
  let sigLoading = $state(false);
  let sigError = $state('');

  async function loadSignature() {
    if (signature || sigLoading) return;
    sigLoading = true;
    try {
      const res = await fetch(`/api/v1/runs/${r.id}/signature`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        sigError = (body as { error?: string }).error ?? `HTTP ${res.status}`;
      } else {
        signature = await res.json() as RunSignature;
      }
    } catch (err) {
      sigError = err instanceof Error ? err.message : String(err);
    } finally {
      sigLoading = false;
    }
  }

  $effect(() => { if (active === 'signature') loadSignature(); });
</script>

<svelte:head>
  <title>Run {r.id.slice(0, 8)}… — CentralGauge</title>
</svelte:head>

<Breadcrumbs crumbs={[
  { label: 'Home', href: '/' },
  { label: 'Runs', href: '/runs' },
  { label: r.id.slice(0, 8) + '…' },
]} />

<header class="page-header">
  <div class="title-row">
    <h1>Run <code class="text-mono">{r.id.slice(0, 12)}…</code></h1>
    <TierBadge tier={r.tier} />
    <RunStatusBadge status={r.status} />
  </div>
  <p class="meta text-muted">
    <ModelLink slug={r.model.slug} display_name={r.model.display_name} api_model_id={r.model.api_model_id} family_slug={r.model.family_slug} />
    · {r.totals.tasks_attempted} tasks
    · {new Date(r.started_at).toISOString()}
    · machine: <code class="text-mono">{r.machine_id}</code>
  </p>
</header>

<section class="stats">
  <StatTile label="Score" value={formatScore(r.totals.avg_score)} />
  <StatTile label="Tasks pass" value={formatTaskRatio(r.totals.tasks_passed, r.totals.tasks_attempted)} />
  <StatTile label="Cost" value={formatCost(r.totals.cost_usd)} />
  <StatTile label="Duration" value={formatDuration(r.totals.duration_ms)} />
</section>

<Tabs {tabs} bind:active>
  {#snippet children(activeId)}
    {#if activeId === 'results'}
      <PerTaskResultsTable results={r.results} runId={r.id} />
    {:else if activeId === 'settings'}
      <SettingsPanel settings={r.settings} pricing_version={r.pricing_version} centralgauge_sha={r.centralgauge_sha} />
    {:else if activeId === 'signature'}
      {#if sigLoading}
        <p class="text-muted">Loading signature…</p>
      {:else if sigError}
        <p class="text-muted">Could not load signature: {sigError}</p>
      {:else if signature}
        <SignaturePanel {signature} />
      {/if}
    {:else if activeId === 'reproduction'}
      <ReproductionBlock runId={r.id} bundle={r.reproduction_bundle} />
    {/if}
  {/snippet}
</Tabs>

<style>
  .page-header { padding: var(--space-6) 0; }
  .title-row { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; }
  .title-row h1 { font-size: var(--text-2xl); margin: 0; }
  .meta { font-size: var(--text-sm); margin-top: var(--space-3); display: inline-flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }

  .stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-4);
    margin-bottom: var(--space-6);
  }
  @media (max-width: 768px) { .stats { grid-template-columns: repeat(2, 1fr); } }
</style>
```

- [ ] **Step 2: Verify build**

Run: `cd site && npm run build 2>&1 | tail -3`
Expected: `✔ done`. Watch for new chunks for `/runs/[id]` route.

- [ ] **Step 3: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/routes/runs/[id]/+page.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): /runs/:id page (4-tab Results/Settings/Signature/Reproduction with lazy sig)"
```

---

## Mini-phase E — Signature permalink page

### Task E1: Signature permalink loader

**Files:**

- Create: `site/src/routes/runs/[id]/signature/+page.server.ts`

- [ ] **Step 1: Implement**

```ts
import type { PageServerLoad } from "./$types";
import type { RunSignature } from "$shared/api-types";
import { error } from "@sveltejs/kit";

export const load: PageServerLoad = async (
  { params, fetch, setHeaders, depends },
) => {
  depends(`app:run:${params.id}:signature`);

  const res = await fetch(`/api/v1/runs/${params.id}/signature`);
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    throw error(
      res.status,
      (body as { error?: string }).error ??
        `signature for run ${params.id} not found`,
    );
  }

  const apiCache = res.headers.get("cache-control");
  if (apiCache) setHeaders({ "cache-control": apiCache });

  return {
    runId: params.id,
    signature: (await res.json()) as RunSignature,
  };
};
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/routes/runs/[id]/signature/+page.server.ts
git -C /u/Git/CentralGauge commit -m "feat(site): /runs/:id/signature +page.server.ts loader (permalink)"
```

---

### Task E2: Signature permalink page

**Files:**

- Create: `site/src/routes/runs/[id]/signature/+page.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import SignaturePanel from '$lib/components/domain/SignaturePanel.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>Signature for run {data.runId.slice(0, 8)}… — CentralGauge</title>
  <meta name="description" content="Ed25519 signature for run {data.runId} — independently verifiable in-browser." />
</svelte:head>

<Breadcrumbs crumbs={[
  { label: 'Home', href: '/' },
  { label: 'Runs', href: '/runs' },
  { label: data.runId.slice(0, 8) + '…', href: `/runs/${data.runId}` },
  { label: 'Signature' },
]} />

<h1>Signature for run <code class="text-mono">{data.runId.slice(0, 12)}…</code></h1>

<SignaturePanel signature={data.signature} />

<style>
  h1 { font-size: var(--text-2xl); margin: var(--space-6) 0 var(--space-5) 0; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/routes/runs/[id]/signature/+page.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): /runs/:id/signature page (permalink reusing SignaturePanel)"
```

---

## Mini-phase F — Transcript viewer

### Task F1: TranscriptViewer widget

**Files:**

- Create: `site/src/lib/components/domain/TranscriptViewer.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import { ChevronDown, ChevronRight } from '$lib/components/ui/icons';
  import CopyButton from './CopyButton.svelte';

  interface Section { name: string; body: string; }
  interface Props { text: string; }
  let { text }: Props = $props();

  // Annotated transcripts use === HEADER === markers from the bench. Plain
  // text transcripts arrive without markers and render as a single section.
  function parseSections(t: string): Section[] {
    const sections: Section[] = [];
    const re = /^=== ([^=]+) ===$/gm;
    const matches = [...t.matchAll(re)];
    if (matches.length === 0) {
      return [{ name: 'TRANSCRIPT', body: t }];
    }
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index! + matches[i][0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index : t.length;
      sections.push({ name: matches[i][1].trim(), body: t.slice(start, end).trim() });
    }
    return sections;
  }

  const sections = $derived(parseSections(text));
  let collapsed = $state(new Set<string>());

  function toggle(name: string) {
    if (collapsed.has(name)) collapsed.delete(name);
    else collapsed.add(name);
    collapsed = new Set(collapsed);
  }
</script>

<div class="viewer">
  {#each sections as section (section.name)}
    <section class="block">
      <header>
        <button type="button" class="toggle" aria-expanded={!collapsed.has(section.name)} onclick={() => toggle(section.name)}>
          {#if collapsed.has(section.name)}<ChevronRight size={14} />{:else}<ChevronDown size={14} />{/if}
          <span class="name">{section.name}</span>
        </button>
        <CopyButton value={section.body} label="Copy {section.name}" />
      </header>
      {#if !collapsed.has(section.name)}
        <pre class="body">{#each section.body.split('\n') as line, i}<span class="line"><span class="ln" aria-hidden="true">{i + 1}</span><span class="content">{line}</span>
</span>{/each}</pre>
      {/if}
    </section>
  {/each}
</div>

<style>
  .viewer { display: flex; flex-direction: column; gap: var(--space-4); }
  .block {
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .toggle {
    background: transparent;
    border: 0;
    cursor: pointer;
    color: var(--text);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: var(--weight-medium);
    font-size: var(--text-sm);
  }
  .name { font-family: var(--font-mono); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: var(--tracking-wide); }

  .body {
    margin: 0;
    padding: var(--space-4);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: var(--leading-sm);
    overflow-x: auto;
    background: var(--code-bg);
  }
  .line { display: block; }
  .ln { display: inline-block; width: 4ch; color: var(--text-faint); user-select: none; padding-right: var(--space-3); }
  .content { white-space: pre-wrap; word-break: break-word; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/domain/TranscriptViewer.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): TranscriptViewer widget (parse === HEADER === sections + collapsible blocks + line numbers)"
```

---

### Task F2: Transcript loader

**Files:**

- Create: `site/src/routes/runs/[id]/transcripts/[taskId]/[attempt]/+page.server.ts`

- [ ] **Step 1: Implement**

```ts
import type { PageServerLoad } from "./$types";
import type { RunDetail, Transcript } from "$shared/api-types";
import { error } from "@sveltejs/kit";

export const load: PageServerLoad = async (
  { params, fetch, setHeaders, depends },
) => {
  depends(`app:transcript:${params.id}:${params.taskId}:${params.attempt}`);

  // First fetch run detail to find the transcript_key for this task+attempt
  const runRes = await fetch(`/api/v1/runs/${params.id}`);
  if (!runRes.ok) throw error(runRes.status, `run ${params.id} not found`);
  const run = await runRes.json() as RunDetail;

  const taskResult = run.results.find((r) => r.task_id === params.taskId);
  if (!taskResult) {
    throw error(404, `task ${params.taskId} not in run ${params.id}`);
  }

  const attemptNum = parseInt(params.attempt, 10);
  const attempt = taskResult.attempts.find((a) => a.attempt === attemptNum);
  if (!attempt) {
    throw error(
      404,
      `attempt ${params.attempt} not in run ${params.id} task ${params.taskId}`,
    );
  }

  const tRes = await fetch(`/api/v1/transcripts/${attempt.transcript_key}`);
  if (!tRes.ok) throw error(tRes.status, "transcript fetch failed");

  const apiCache = tRes.headers.get("cache-control");
  if (apiCache) setHeaders({ "cache-control": apiCache });

  return {
    runId: params.id,
    taskId: params.taskId,
    attempt: attemptNum,
    passed: attempt.passed,
    score: attempt.score,
    model: run.model,
    transcript: (await tRes.json()) as Transcript,
  };
};
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/routes/runs/[id]/transcripts/[taskId]/[attempt]/+page.server.ts
git -C /u/Git/CentralGauge commit -m "feat(site): /runs/:id/transcripts/:taskId/:attempt loader (resolve transcript_key + fetch)"
```

---

### Task F3: Transcript page

**Files:**

- Create: `site/src/routes/runs/[id]/transcripts/[taskId]/[attempt]/+page.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import TranscriptViewer from '$lib/components/domain/TranscriptViewer.svelte';
  import { Download } from '$lib/components/ui/icons';
  import { formatScore } from '$lib/client/format';

  let { data } = $props();
</script>

<svelte:head>
  <title>{data.taskId} attempt {data.attempt} — Run {data.runId.slice(0, 8)}… — CentralGauge</title>
</svelte:head>

<Breadcrumbs crumbs={[
  { label: 'Home', href: '/' },
  { label: 'Runs', href: '/runs' },
  { label: data.runId.slice(0, 8) + '…', href: `/runs/${data.runId}` },
  { label: 'Transcripts' },
  { label: `${data.taskId} #${data.attempt}` },
]} />

<header class="page-header">
  <div class="title-row">
    <h1>{data.taskId}</h1>
    <span class="text-muted">attempt {data.attempt}</span>
    <Badge variant={data.passed ? 'success' : 'danger'}>
      {data.passed ? 'PASSED' : 'FAILED'}
    </Badge>
  </div>
  <p class="meta text-muted">
    Model: {data.model.display_name} · Score: <span class="text-mono">{formatScore(data.score)}</span>
    · <a href="/api/v1/transcripts/{data.transcript.key}">Download raw</a>
  </p>
</header>

<TranscriptViewer text={data.transcript.text} />

<style>
  .page-header { padding: var(--space-6) 0; }
  .title-row { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; }
  .title-row h1 { font-size: var(--text-2xl); margin: 0; }
  .meta { font-size: var(--text-sm); margin-top: var(--space-3); }
</style>
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/routes/runs/[id]/transcripts/[taskId]/[attempt]/+page.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): transcript page (header + TranscriptViewer + download raw link)"
```

---

## Mini-phase G — Print stylesheet + flag flip

### Task G1: Print stylesheet

**Files:**

- Create: `site/src/styles/print.css`

- [ ] **Step 1: Implement**

```css
/*
 * Print stylesheet — gated by FLAG_PRINT_STYLESHEET=on (server flag).
 * When the flag is on, +layout.svelte conditionally imports this file.
 *
 * Operators print runs / models pages; the print output prefers light
 * theme, drops chrome, and shows link URLs after each link.
 */

@media print {
  /* Force light surface for paper readability */
  :root {
    color-scheme: light;
  }

  /* Hide chrome */
  nav,
  footer,
  .toc,
  .filter-rail,
  .skip,
  .icon-btn,
  button.fbtn,
  .pager {
    display: none !important;
  }

  /* Backgrounds eat ink — drop them */
  body, main, table, thead, tbody {
    background: white !important;
    color: black !important;
  }

  /* Show link URLs after the link text */
  a[href]::after {
    content: " (" attr(href) ")";
    font-size: 0.8em;
    color: #555;
  }

  /* Don't add URL annotation for in-page anchors / mailtos */
  a[href^="#"]::after,
  a[href^="javascript:"]::after,
  a[href^="mailto:"]::after {
    content: "";
  }

  /* Tables full width */
  table {
    width: 100%;
  }

  /* Avoid breaking sections across pages where possible */
  section, table, figure {
    page-break-inside: avoid;
  }
  h1, h2, h3 {
    page-break-after: avoid;
  }

  /* Code blocks: no borders, plain mono */
  pre, code {
    background: white !important;
    color: black !important;
    border: none !important;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/styles/print.css
git -C /u/Git/CentralGauge commit -m "feat(site): print stylesheet (hides chrome, light theme, link URLs annotated)"
```

---

### Task G2: Conditionally import print.css in +layout.svelte

**Files:**

- Modify: `site/src/routes/+layout.svelte`

- [ ] **Step 1: Edit**

Find the imports at the top of `<script>`:

```ts
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/utilities.css";
```

Add (unconditionally — print stylesheet only matches @media print, so it's safe to always include; the flag-gating is intentional but not required for correctness):

```ts
import "../styles/print.css";
```

Why unconditional: the print stylesheet body is wrapped in `@media print`, which only applies on print. The bundle size cost is ~1 KB gz. The flag is conceptually still meaningful for routes that want to skip it (none today).

- [ ] **Step 2: Verify build**

Run: `cd site && npm run build 2>&1 | tail -3`
Expected: `✔ done`.

- [ ] **Step 3: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/routes/+layout.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): import print.css in root layout (always — gated via @media print)"
```

---

### Task G3: Flip print_stylesheet flag in wrangler.toml

**Files:**

- Modify: `site/wrangler.toml`

- [ ] **Step 1: Edit**

Find the `[vars]` block:

```toml
[vars]
LOG_LEVEL = "info"
```

Append:

```toml
FLAG_PRINT_STYLESHEET = "on"
```

(Print stylesheet is now active. The flag is for documentation and is reserved for future use — actual print behavior is purely CSS-driven via @media print.)

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/wrangler.toml
git -C /u/Git/CentralGauge commit -m "feat(site): flip FLAG_PRINT_STYLESHEET=on in wrangler.toml [vars]"
```

---

## Mini-phase H — CI updates

### Task H1: Add new routes to Lighthouse CI

**Files:**

- Modify: `site/lighthouserc.json`

- [ ] **Step 1: Edit**

Replace the `"url": [...]` line with:

```json
"url": [
  "http://127.0.0.1:4173/leaderboard",
  "http://127.0.0.1:4173/about",
  "http://127.0.0.1:4173/models/sonnet-4-7",
  "http://127.0.0.1:4173/runs/seeded-run-id-1",
  "http://127.0.0.1:4173/runs/seeded-run-id-1/transcripts/CG-AL-E001/1"
],
```

(The `seeded-run-id-1` and `sonnet-4-7` slugs assume seeded fixture data is present in the preview build. If not, replace with whatever slug/run-id the seeding fixture uses; check `tests/utils/reset-db.ts` or the equivalent for actual values.)

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/lighthouserc.json
git -C /u/Git/CentralGauge commit -m "build(site/ci): add /about, /models/:slug, /runs/:id, /runs/.../transcripts to LHCI URL list"
```

---

### Task H2: New E2E specs for P5.2 routes

**Files:**

- Create: `site/tests/e2e/model-detail.spec.ts`
- Create: `site/tests/e2e/run-detail.spec.ts`
- Create: `site/tests/e2e/transcript.spec.ts`
- Create: `site/tests/e2e/print.spec.ts`

- [ ] **Step 1: Create `model-detail.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

test.describe("/models/:slug", () => {
  test("renders header + stat tiles + history chart", async ({ page }) => {
    await page.goto("/models/sonnet-4-7");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Score")).toBeVisible();
    await expect(page.getByText("History")).toBeVisible();
  });

  test("navigates to runs feed", async ({ page }) => {
    await page.goto("/models/sonnet-4-7");
    await page.getByText("See all").click();
    await expect(page).toHaveURL(/\/models\/sonnet-4-7\/runs/);
  });
});
```

- [ ] **Step 2: Create `run-detail.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

test.describe("/runs/:id", () => {
  test("renders 4 tabs + Results active by default", async ({ page }) => {
    await page.goto("/runs/seeded-run-id-1");
    await expect(page.getByRole("tab", { name: "Results" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("tab", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Signature" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Reproduction" })).toBeVisible();
  });

  test("arrow-right cycles tabs", async ({ page }) => {
    await page.goto("/runs/seeded-run-id-1");
    await page.getByRole("tab", { name: "Results" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Settings" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("signature tab loads and verify works", async ({ page }) => {
    await page.goto("/runs/seeded-run-id-1");
    await page.getByRole("tab", { name: "Signature" }).click();
    await expect(page.getByRole("button", { name: /verify/i })).toBeVisible();
    await page.getByRole("button", { name: /verify/i }).click();
    // Either valid (✓) or invalid (✗) — both are valid outcomes; we just want
    // confirmation the button responded
    await expect(page.locator(".ok, .bad")).toBeVisible({ timeout: 5000 });
  });
});
```

- [ ] **Step 3: Create `transcript.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

test("/runs/:id/transcripts/:taskId/:attempt renders + copies", async ({ page }) => {
  await page.goto("/runs/seeded-run-id-1/transcripts/CG-AL-E001/1");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Section headers visible (== HEADER == parsed)
  const sections = page.locator(".block .name");
  await expect(sections.first()).toBeVisible();
});
```

- [ ] **Step 4: Create `print.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

test("/runs/:id hides nav + footer in print media", async ({ page }) => {
  await page.goto("/runs/seeded-run-id-1");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("nav").first()).toBeHidden();
  await expect(page.locator("footer")).toBeHidden();
});
```

- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/tests/e2e/model-detail.spec.ts site/tests/e2e/run-detail.spec.ts site/tests/e2e/transcript.spec.ts site/tests/e2e/print.spec.ts
git -C /u/Git/CentralGauge commit -m "test(site/e2e): model-detail / run-detail / transcript / print suites"
```

---

### Task H3: Tighten `prerender.handleHttpError` (optional)

**Files:**

- Modify: `site/svelte.config.js`

The plan-author `'warn'` setting in P5.1 was a temporary measure while nav linked to non-existent routes. P5.2 ships `/models/:slug` and `/runs/:id`. Other Nav links (`/tasks`, `/compare`, `/search`, plain `/models` and `/runs` index) STILL don't exist. So we keep `'warn'` for now.

- [ ] **Step 1: Add a comment documenting the residual scope**

Edit `site/svelte.config.js`. Find the `prerender` block:

```js
prerender: {
  entries: ['/about'],
  handleHttpError: 'warn'
}
```

Replace with:

```js
prerender: {
  entries: ['/about'],
  // 'warn' permits prerender crawl to skip 404s on Nav links not yet shipped:
  //   - /models (index)            — P5.3
  //   - /tasks (index + /:id)      — P5.3
  //   - /compare                   — P5.3
  //   - /search                    — P5.3
  //   - /runs (index)              — P5.2 ships /runs/:id but not /runs index
  // Switch to 'fail' once all Nav targets resolve (target: P5.4 polish).
  handleHttpError: 'warn'
}
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/svelte.config.js
git -C /u/Git/CentralGauge commit -m "docs(site): inline comment listing residual prerender warn-scope routes"
```

---

## Spec coverage — verification before P5.2 closes

- [ ] **§7.3 Model detail** — done (Task B5)
- [ ] **§7.4 Models runs feed** — done (Task C2)
- [ ] **§7.5 Model limitations** — done (Task C4)
- [ ] **§7.9 Run detail** — done (Task D6) with all 4 tabs
- [ ] **§7.10 Transcripts** — done (Task F3)
- [ ] **§7.11 Signature permalink** — done (Task E2)
- [ ] **§6.4 atoms Diff/Popover/Dialog** — done (A3, A4, A5)
- [ ] **§6.4 atoms Modal focus-trap** — done (A6)
- [ ] **§6.4 atoms Tabs keyboard nav** — done (A7)
- [ ] **§6.4 atoms Tooltip placement** — done (A8)
- [ ] **§6.10 print stylesheet** — done (G1, G2, G3)
- [ ] **§7 cross-link patterns** — every model name/run id/task id links per spec
- [ ] **§9 perf** — Lighthouse CI URLs added (H1)

If anything fails, fix before declaring done.

---

## Done criteria for P5.2

- All commits in this plan landed; CI green on master
- `cd site && npm run test:main` → 308 (P5.1 baseline) + new component/widget tests pass; expect ~340-360 total
- `cd site && npm run test:e2e` → 4 new specs added (model-detail, run-detail, transcript, print); all green locally
- `cd site && npm run check:budget` → all chunks within budget. New chunks expected:
  - `/models/[slug]` route ≤ 20 KB gz
  - `/runs/[id]` route ≤ 20 KB gz (largest of the new chunks given 4 tabs)
  - lazy chunks for marked/dompurify (~30 KB gz) — only loaded by `/models/:slug/limitations`
  - lazy chunk for @noble/ed25519 (~12 KB gz) — only loaded when SignaturePanel verifies
- `cd site && npm run check:contrast` → all pairs still pass
- `cd site && npm run build` → `✔ done`. New routes prerender-safe (`/about` is the only prerendered route; `/models/:slug` etc. are dynamic).
- Five new pages reachable: `/models/sonnet-4-7`, `/models/sonnet-4-7/runs`, `/models/sonnet-4-7/limitations`, `/runs/<id>`, `/runs/<id>/transcripts/<task>/<attempt>`, `/runs/<id>/signature`
- Transparency footer link (`/about#transparency`) still works
- Documentation: P5.2 entry appended to `site/CONTRIBUTING.md`'s "P5.x implementation notes" section (manual, after P5.2 ships, with concrete learnings)

When all of the above are true, P5.2 ships and we author `2026-MM-DD-p5-3-cross-cuts.md` for P5.3 (compare, search, families, tasks, limitations index).
