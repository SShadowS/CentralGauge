import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { HostLogLine } from "../../../src/harness/backend.ts";
import type { CampaignRecords } from "../../../src/harness/integrity.ts";
import {
  buildReport,
  loadReportLogs,
  type ReportLogs,
} from "../../../src/harness/report.ts";
import type { VerdictLog } from "../../../src/harness/verdict.ts";
import { campaign, execution, judgment, telemetry } from "./fixtures.ts";

/** plain: HX-001 pass, HX-002 fail; skills: both pass. */
async function records(): Promise<CampaignRecords> {
  const c = await campaign();
  const rows: Array<[string, string, boolean]> = [
    ["plain", "HX-001", true],
    ["plain", "HX-002", false],
    ["skills", "HX-001", true],
    ["skills", "HX-002", true],
  ];
  const executions = [];
  const judgments = [];
  for (const [arm, task, pass] of rows) {
    const e = execution(c, { arm, task }, { telemetry: telemetry(1) });
    executions.push(e);
    judgments.push(judgment(c, e, pass));
  }
  return { campaign: c, executions, artifacts: [], judgments };
}

function line(
  execution: string,
  op: string,
  over: Partial<HostLogLine> = {},
): HostLogLine {
  return {
    v: 1,
    request: crypto.randomUUID(),
    execution,
    op,
    status: 200,
    outcome: "ok",
    at: "2026-10-01T10:00:00.000Z",
    spans: {},
    apps_compiled: [],
    per_app_compiles: 0,
    diagnostics: 0,
    tests_run: 0,
    tests_failed: 0,
    container: "C1",
    retries: 0,
    ...over,
  };
}

function vlog(
  judgmentId: string,
  executionId: string,
  total: number,
  queue: number,
): VerdictLog {
  return {
    v: 1,
    judgment_id: judgmentId,
    execution_id: executionId,
    violations: [],
    diagnostics: [],
    test_messages: [],
    notes: [],
    spans: {
      reconstruct_ms: 0,
      compile_ms: 0,
      queue_ms: queue,
      provisioning_ms: 0,
      candidate_publish_ms: 0,
      test_ms: 0,
      total_ms: total,
    },
    containers: ["C1"],
    infra_retries: [],
    per_app_compiles: 0,
    error: null,
  };
}

function logsFor(r: CampaignRecords): ReportLogs {
  const [p1, p2, s1, s2] = r.executions;
  return {
    host: new Map([
      [p1!.id, [
        line(p1!.id, "compile", {
          apps_compiled: ["Core", "Rental"],
          per_app_compiles: 2,
          diagnostics: 3,
        }),
        line(p1!.id, "compile", { per_app_compiles: 1, diagnostics: 1 }),
        line(p1!.id, "test", { tests_run: 4 }),
        line(p1!.id, "compile", { status: 429, outcome: "rejected" }),
      ]],
      [p2!.id, [line(p2!.id, "symbols")]],
      [s1!.id, [line(s1!.id, "compile", { per_app_compiles: 1 })]],
      [s2!.id, []],
    ]),
    verdict: new Map(
      r.judgments.map((j, i) => [
        j.id,
        vlog(
          j.id,
          j.execution_id,
          [100, 300, 200, 50][i]!,
          [10, 30, 20, 40][i]!,
        ),
      ]),
    ),
  };
}

Deno.test("efficiency counts backend requests, logical builds and per-app compiles per arm from host logs", async () => {
  const r = await records();
  const rep = await buildReport(r, {
    resamples: 50,
    seed: 1,
    logs: logsFor(r),
  });
  const [plain, skills] = rep.efficiency;
  assertEquals(
    [
      plain!.arm,
      plain!.backend_requests,
      plain!.logical_builds,
      plain!.per_app_compiles,
      plain!.test_runs,
    ],
    ["plain", 5, 2, 3, 1],
  );
  assertEquals(plain!.diagnostics_per_build, 2);
  assertEquals(
    [
      skills!.backend_requests,
      skills!.logical_builds,
      skills!.per_app_compiles,
      skills!.test_runs,
    ],
    [1, 1, 1, 0],
  );
  assertEquals(skills!.diagnostics_per_build, 0);
  assertEquals([plain!.host_logs, skills!.host_logs], [2, 2]);
});

Deno.test("verdict medians come from verdict logs", async () => {
  const r = await records();
  const rep = await buildReport(r, {
    resamples: 50,
    seed: 1,
    logs: logsFor(r),
  });
  const [plain, skills] = rep.efficiency;
  assertEquals([plain!.verdict_ms_median, plain!.verdict_queue_ms_median], [
    200,
    20,
  ]);
  assertEquals([skills!.verdict_ms_median, skills!.verdict_queue_ms_median], [
    125,
    30,
  ]);
  const none = await buildReport(r, { resamples: 50, seed: 1 });
  assertEquals(
    [none.efficiency[0]!.verdict_ms_median, none.efficiency[0]!.host_logs],
    [null, 0],
  );
});

Deno.test("slices group by kind and coupling", async () => {
  const r = await records();
  r.campaign.tasks_meta = [
    {
      id: "HX-001",
      kind: "bugfix",
      coupling: ["events", "interfaces"],
      limits: {},
    },
    { id: "HX-002", kind: "feature", coupling: ["events"], limits: {} },
  ];
  const rep = await buildReport(r, { resamples: 50, seed: 1 });
  assertEquals(
    rep.slices.map((s) => [s.by, s.value, s.tasks, s.pass_rate]),
    [
      ["kind", "bugfix", 1, { plain: 1, skills: 1 }],
      ["kind", "feature", 1, { plain: 0, skills: 1 }],
      ["coupling", "events", 2, { plain: 0.5, skills: 1 }],
      ["coupling", "interfaces", 1, { plain: 1, skills: 1 }],
    ],
  );
});

Deno.test("both-pass table is descriptive and matched on scored cells only", async () => {
  const r = await records();
  // An unscored skills cell on HX-002: that pair is not matched.
  const j = r.judgments[3]!;
  r.judgments[3] = {
    ...j,
    scorers: j.scorers.map((s) => ({ ...s, passed: null })),
    verdict: "unscored",
  };
  const rep = await buildReport(r, { resamples: 50, seed: 1 });
  assertEquals(rep.both_pass, [{
    baseline: "plain",
    variant: "skills",
    pairs: 1,
    both_pass: 1,
    baseline_only: 0,
    variant_only: 0,
    neither: 0,
  }]);
  assertEquals(Object.keys(rep.both_pass[0]!).includes("winner"), false);
});

Deno.test("loadReportLogs reads the published host logs and verdict logs; missing files are absent", async () => {
  const r = await records();
  const root = await Deno.realPath(await Deno.makeTempDir());
  const [p1] = r.executions;
  await Deno.mkdir(join(root, "runs", p1!.id), { recursive: true });
  await Deno.writeTextFile(
    join(root, "runs", p1!.id, "host-log.jsonl"),
    JSON.stringify(line(p1!.id, "compile")) + "\n" + "{cut by a crash\n",
  );
  const j = r.judgments[0]!;
  await Deno.mkdir(join(root, "verdicts"), { recursive: true });
  await Deno.writeTextFile(
    join(root, "verdicts", `${j.id}.json`),
    JSON.stringify(vlog(j.id, j.execution_id, 5, 1)),
  );
  const logs = await loadReportLogs(root, r);
  assertEquals(logs.host.get(p1!.id)!.map((l) => l.op), ["compile"]);
  assertEquals(logs.host.has(r.executions[1]!.id), false);
  assertEquals(logs.verdict.get(j.id)!.spans.total_ms, 5);
  assertEquals(logs.verdict.size, 1);
});
