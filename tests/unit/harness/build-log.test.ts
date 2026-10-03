import { assertEquals } from "@std/assert";
import type { HostLogLine } from "../../../src/harness/backend.ts";
import {
  buildDiagnostics,
  type BuildLogMetrics,
  buildLogMetrics,
  diagSymbol,
  relDiagFile,
} from "../../../src/harness/build-log.ts";

const line = (o: Partial<HostLogLine>): HostLogLine => ({
  v: 1,
  request: "br_1",
  execution: "e",
  op: "compile",
  status: 200,
  outcome: "ok",
  at: "2026-10-05T00:00:00.000Z",
  spans: { compile_ms: 10 },
  apps_compiled: [],
  per_app_compiles: 0,
  diagnostics: 0,
  tests_run: 0,
  tests_failed: 0,
  container: null,
  retries: 0,
  diagnostic_list: [],
  changed_apps: [],
  build_ok: true,
  ...o,
});
const d = (code: string, file: string, symbol: string | null) => ({
  app: "Core",
  code,
  file,
  line: 1,
  symbol,
});

Deno.test("diagSymbol: quoted identifiers joined, null without quotes", () => {
  assertEquals(
    diagSymbol("The name 'Foo' does not exist in the current context"),
    "Foo",
  );
  assertEquals(
    diagSymbol(
      "'Codeunit \"Rental Mgt\"' does not contain a definition for 'Calc'",
    ),
    'Codeunit "Rental Mgt".Calc',
  );
  assertEquals(diagSymbol("App generation failed"), null);
});

Deno.test("relDiagFile: workspace-relative from the app folder, any separator", () => {
  assertEquals(
    relDiagFile("C:\\w\\snap-1\\Core\\src\\C.al", "Core"),
    "Core/src/C.al",
  );
  assertEquals(relDiagFile("/tmp/x/core/src/C.al", "Core"), "core/src/C.al");
  assertEquals(relDiagFile("x.al", "Core"), "x.al");
});

Deno.test("buildDiagnostics: errors only, normalized", () => {
  const out = buildDiagnostics([{
    folder: "Core",
    id: "i",
    version: "1.0.0.0",
    ok: false,
    attempted: true,
    file: null,
    compile_ms: 1,
    diagnostics: [
      {
        code: "AL0118",
        message: "The name 'Foo' does not exist",
        file: "C:\\s\\Core\\src\\C.al",
        line: 3,
        column: 1,
        severity: "error",
      },
      {
        code: "AL0432",
        message: "obsolete 'Bar'",
        file: "C:\\s\\Core\\src\\C.al",
        line: 4,
        column: 1,
        severity: "warning",
      },
    ],
  }]);
  assertEquals(out, [{
    app: "Core",
    code: "AL0118",
    file: "Core/src/C.al",
    line: 3,
    symbol: "Foo",
  }]);
});

Deno.test("buildLogMetrics: no log and pre-M11 lines are missing, not zero", () => {
  assertEquals(buildLogMetrics(undefined), null);
  const old = line({}) as Partial<HostLogLine>;
  delete old.build_ok;
  assertEquals(buildLogMetrics([old as HostLogLine]), null);
});

Deno.test("buildLogMetrics: an empty log is a no-build cell", () => {
  assertEquals(buildLogMetrics([]), {
    builds: 0,
    test_runs: 0,
    build_ms: 0,
    distinct_diagnostics: null,
    unknown_symbol: null,
    first_eligible: "no_build",
  });
});

Deno.test("buildLogMetrics: dedupe by (code, file, symbol); first eligible build skips pre-edit builds", () => {
  // A rejected line carries no build_ok key; it must not read as pre-M11.
  const rejected = line({
    request: "rejected_1",
    outcome: "rejected",
  }) as Partial<HostLogLine>;
  delete rejected.build_ok;
  const m = buildLogMetrics([
    line({ changed_apps: [], build_ok: true }),
    line({
      request: "br_2",
      changed_apps: ["Core"],
      build_ok: false,
      outcome: "failed",
      diagnostic_list: [
        d("AL0118", "Core/src/C.al", "Foo"),
        d("AL0118", "Core/src/C.al", "Foo"),
      ],
    }),
    line({
      request: "br_3",
      changed_apps: ["Core"],
      build_ok: false,
      outcome: "failed",
      diagnostic_list: [
        d("AL0118", "Core/src/C.al", "Foo"),
        d("AL0118", "Core/src/D.al", "Foo"),
        d("AL0103", "Core/src/C.al", null),
      ],
    }),
    line({
      request: "br_4",
      op: "test",
      changed_apps: ["Core"],
      build_ok: true,
      tests_run: 3,
    }),
    rejected as HostLogLine,
    line({
      request: "br_5",
      outcome: "failed",
      build_ok: null,
      changed_apps: ["Core"],
    }),
  ]);
  assertEquals(m, {
    builds: 4,
    test_runs: 1,
    build_ms: 40,
    distinct_diagnostics: 3,
    unknown_symbol: 2,
    first_eligible: "failed",
  });
});

// Run 002: incomplete or malformed structured lines are missing, never zero.
type Raw = { [K in keyof HostLogLine]?: unknown };
const raw = (
  o: Partial<HostLogLine>,
  mutate: (l: Raw) => void,
): HostLogLine => {
  const l = line(o) as unknown as Raw;
  mutate(l);
  return l as unknown as HostLogLine;
};
const complete: BuildLogMetrics = {
  builds: 1,
  test_runs: 0,
  build_ms: 10,
  distinct_diagnostics: 0,
  unknown_symbol: 0,
  first_eligible: "no_build",
};

Deno.test("buildLogMetrics run 002: missing or malformed diagnostic_list makes the burden missing", () => {
  const cases: ((l: Raw) => void)[] = [
    (l) => delete l.diagnostic_list,
    (l) => l.diagnostic_list = "AL0118",
    (l) => l.diagnostic_list = [{ ...d("AL0118", "C.al", "Foo"), code: 118 }],
    (l) => l.diagnostic_list = [{ ...d("AL0118", "C.al", "Foo"), line: "1" }],
    (l) => l.diagnostic_list = [{ code: "AL0118" }],
    (l) => l.diagnostic_list = [null],
  ];
  for (const mutate of cases) {
    assertEquals(buildLogMetrics([raw({}, mutate)]), {
      ...complete,
      distinct_diagnostics: null,
      unknown_symbol: null,
    });
  }
});

Deno.test("buildLogMetrics run 002: missing or malformed changed_apps before the first eligible build makes it missing, not no_build", () => {
  const cases: ((l: Raw) => void)[] = [
    (l) => delete l.changed_apps,
    (l) => l.changed_apps = "Core",
    (l) => l.changed_apps = [1],
  ];
  for (const mutate of cases) {
    assertEquals(buildLogMetrics([raw({}, mutate)]), {
      ...complete,
      first_eligible: null,
    });
    assertEquals(
      buildLogMetrics([
        raw({}, mutate),
        line({ request: "br_2", changed_apps: ["Core"], build_ok: true }),
      ]),
      { ...complete, builds: 2, build_ms: 20, first_eligible: null },
    );
  }
});

Deno.test("buildLogMetrics run 002: missing or malformed compile_ms makes build_ms missing", () => {
  const cases: ((l: Raw) => void)[] = [
    (l) => l.spans = {},
    (l) => l.spans = { compile_ms: "10" },
    (l) => l.spans = { compile_ms: Number.NaN },
    (l) => l.spans = null,
    (l) => delete l.spans,
  ];
  for (const mutate of cases) {
    assertEquals(buildLogMetrics([raw({}, mutate)]), {
      ...complete,
      build_ms: null,
    });
  }
});

Deno.test("buildLogMetrics run 002: malformed tests_run on a test build makes test_runs missing", () => {
  for (
    const mutate of [
      (l: Raw) => l.tests_run = "3",
      (l: Raw) => delete l.tests_run,
    ]
  ) {
    assertEquals(buildLogMetrics([raw({ op: "test" }, mutate)]), {
      ...complete,
      test_runs: null,
    });
  }
});

Deno.test("buildLogMetrics run 002: a malformed build_ok, op or outcome makes the whole cell missing", () => {
  const cases: ((l: Raw) => void)[] = [
    (l) => l.build_ok = "true",
    (l) => l.build_ok = 1,
    (l) => l.build_ok = undefined,
    (l) => l.op = 7,
    (l) => l.outcome = null,
  ];
  for (const mutate of cases) {
    assertEquals(buildLogMetrics([raw({}, mutate)]), null);
  }
  assertEquals(
    buildLogMetrics([null as unknown as HostLogLine]),
    null,
  );
});
