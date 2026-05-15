import {
  assert,
  assertEquals,
  assertExists,
  assertGreater,
  assertGreaterOrEqual,
  assertRejects,
} from "@std/assert";
import type { TraceEvent } from "../../../src/tracing/tracer.ts";
import {
  closeTracer,
  getTracer,
  getUnixOriginMicros,
  initTracer,
  resolveTracePath,
} from "../../../src/tracing/tracer.ts";

// Tests must close the tracer between cases so the singleton doesn't leak.

async function withTracer(
  fn: (filePath: string) => Promise<void> | void,
): Promise<TraceEvent[]> {
  const dir = await Deno.makeTempDir({ prefix: "cg-tracer-test-" });
  const file = `${dir}/trace.json`;
  try {
    initTracer(file);
    await fn(file);
    await closeTracer();
    const text = await Deno.readTextFile(file);
    const parsed = JSON.parse(text) as { traceEvents: TraceEvent[] };
    return parsed.traceEvents;
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

function arg<T = unknown>(
  ev: TraceEvent | undefined,
  key: string,
): T | undefined {
  return ev?.args?.[key] as T | undefined;
}

Deno.test("getTracer() returns the disabled stub by default", async () => {
  await closeTracer();
  const t = getTracer();
  assertEquals(t.enabled, false);
});

Deno.test("disabled tracer span() runs body and returns its value", async () => {
  await closeTracer();
  const t = getTracer();
  assertEquals(t.enabled, false);
  const result = t.span("test", { tid: "x" }, () => 42);
  assertEquals(result, 42);
  const promised = await t.span(
    "test",
    { tid: "x" },
    () => Promise.resolve("hello"),
  );
  assertEquals(promised, "hello");
});

Deno.test("disabled tracer start() returns a noop handle", async () => {
  await closeTracer();
  const t = getTracer();
  const h = t.start("noop", { tid: "x" });
  h.end();
  h.end({ ok: false });
});

Deno.test("disabled tracer instant() is a noop", async () => {
  await closeTracer();
  getTracer().instant("ev", { tid: "orchestrator" });
});

Deno.test("getUnixOriginMicros() returns null when disabled", async () => {
  await closeTracer();
  assertEquals(getUnixOriginMicros(), null);
});

Deno.test("active tracer span() emits an X event with dur", async () => {
  const events = await withTracer(async () => {
    await getTracer().span(
      "op",
      { tid: "Cronus281", cat: ["container"] },
      () => {},
    );
  });
  const ops = events.filter((e) => e.name === "op" && e.ph === "X");
  assertEquals(ops.length, 1);
  assertExists(ops[0]!.dur);
  assertGreaterOrEqual(ops[0]!.dur!, 0);
  assertEquals(ops[0]!.pid, 0);
  assertEquals(ops[0]!.tid, 100);
  assertEquals(ops[0]!.cat, "container");
});

Deno.test("active tracer span() emits ok=true on success", async () => {
  const events = await withTracer(() => {
    getTracer().span("ok-span", { tid: "Cronus281" }, () => "x");
  });
  const ev = events.find((e) => e.name === "ok-span" && e.ph === "X");
  assertEquals(arg<boolean>(ev, "ok"), true);
});

Deno.test("active tracer span() propagates throw AND emits ok=false", async () => {
  let captured: unknown = null;
  const events = await withTracer(() => {
    try {
      getTracer().span("throws", { tid: "Cronus281" }, () => {
        throw new RangeError("nope");
      });
    } catch (e) {
      captured = e;
    }
  });
  assert(captured instanceof RangeError);
  assertEquals((captured as RangeError).message, "nope");
  const ev = events.find((e) => e.name === "throws" && e.ph === "X");
  assertExists(ev);
  assertEquals(arg<boolean>(ev, "ok"), false);
  assertEquals(arg<string>(ev, "errorType"), "RangeError");
  assertEquals(arg<string>(ev, "errorMessage"), "nope");
});

Deno.test("active tracer async span propagates rejection AND emits ok=false", async () => {
  let captured: unknown = null;
  const events = await withTracer(async () => {
    try {
      await getTracer().span("async-throws", { tid: "Cronus281" }, async () => {
        await Promise.resolve();
        throw new TypeError("async nope");
      });
    } catch (e) {
      captured = e;
    }
  });
  assert(captured instanceof TypeError);
  const ev = events.find((e) => e.name === "async-throws" && e.ph === "X");
  assertEquals(arg<boolean>(ev, "ok"), false);
  assertEquals(arg<string>(ev, "errorType"), "TypeError");
});

Deno.test("active tracer instant() emits an i event", async () => {
  const events = await withTracer(() => {
    getTracer().instant("infra-retry-fired", {
      tid: "Cronus281",
      cat: ["infra"],
      args: { from: "Cronus281", to: "Cronus285" },
    });
  });
  const ev = events.find((e) => e.name === "infra-retry-fired");
  assertExists(ev);
  assertEquals(ev!.ph, "i");
  assertEquals(arg<string>(ev, "from"), "Cronus281");
  assertEquals(arg<string>(ev, "to"), "Cronus285");
});

Deno.test("active tracer beginAsync/end emits matched b/e events", async () => {
  const events = await withTracer(() => {
    const h = getTracer().beginAsync("soap-call", {
      tid: "Cronus281",
      sublane: "soap",
      cat: ["soap"],
      args: { url: "http://x" },
    });
    h.end({ args: { httpStatus: 200 }, ok: true });
  });
  const begin = events.find((e) => e.name === "soap-call" && e.ph === "b");
  const end = events.find((e) => e.name === "soap-call" && e.ph === "e");
  assertExists(begin);
  assertExists(end);
  assertEquals(begin!.id, end!.id);
  assertEquals(arg<number>(end, "httpStatus"), 200);
  assertEquals(arg<boolean>(end, "ok"), true);
});

Deno.test("active tracer assigns numeric tids and emits thread_name metadata", async () => {
  const events = await withTracer(() => {
    getTracer().instant("a", { tid: "Cronus281" });
    getTracer().instant("b", { tid: "Cronus281", sublane: "pwsh" });
    getTracer().instant("c", { tid: "Cronus285" });
  });
  const a = events.find((e) => e.name === "a")!;
  const b = events.find((e) => e.name === "b")!;
  const c = events.find((e) => e.name === "c")!;
  assertEquals(a.tid, 100);
  assertEquals(b.tid, 101);
  assertEquals(c.tid, 110);

  const meta = events.filter((e) => e.ph === "M" && e.name === "thread_name");
  const labels = meta.map((m) => arg<string>(m, "name"));
  assert(labels.includes("Cronus281 (slot)"));
  assert(labels.includes("Cronus281 (pwsh)"));
  assert(labels.includes("Cronus285 (slot)"));
});

Deno.test("active tracer redacts string args and caps length", async () => {
  const longSecret = "Bearer " + "x".repeat(500);
  const events = await withTracer(() => {
    getTracer().instant("ev", {
      tid: "orchestrator",
      args: { token: longSecret, n: 42, ok: true },
    });
  });
  const ev = events.find((e) => e.name === "ev");
  const token = arg<string>(ev, "token") ?? "";
  assertGreater(201, token.length, `expected capped, got len=${token.length}`);
  assertEquals(arg<number>(ev, "n"), 42);
  assertEquals(arg<boolean>(ev, "ok"), true);
});

Deno.test("active tracer writes valid Chrome Trace JSON on close", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-tracer-test-" });
  const file = `${dir}/trace.json`;
  try {
    initTracer(file);
    getTracer().instant("ev", { tid: "orchestrator" });
    await closeTracer();
    const text = await Deno.readTextFile(file);
    const parsed = JSON.parse(text) as {
      traceEvents: TraceEvent[];
      displayTimeUnit: string;
    };
    assertEquals(parsed.displayTimeUnit, "ms");
    assertGreater(parsed.traceEvents.length, 0);
    const procName = parsed.traceEvents.find(
      (e) => e.ph === "M" && e.name === "process_name",
    );
    assertExists(procName);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("active tracer ts is bench-relative and monotonic", async () => {
  const events = await withTracer(async () => {
    getTracer().instant("first", { tid: "orchestrator" });
    await new Promise((r) => setTimeout(r, 5));
    getTracer().instant("second", { tid: "orchestrator" });
  });
  const first = events.find((e) => e.name === "first")!;
  const second = events.find((e) => e.name === "second")!;
  assertGreaterOrEqual(first.ts!, 0);
  assertGreater(second.ts!, first.ts!);
});

Deno.test("getUnixOriginMicros() returns a positive number when active", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-tracer-test-" });
  try {
    initTracer(`${dir}/trace.json`);
    const origin = getUnixOriginMicros();
    assertExists(origin);
    assertGreater(origin!, 0);
    await closeTracer();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("resolveTracePath: --no-trace wins over everything", () => {
  assertEquals(
    resolveTracePath({ noTrace: true, trace: true, traceFile: "/x" }),
    null,
  );
});

Deno.test("resolveTracePath: --trace-file overrides --trace", () => {
  assertEquals(
    resolveTracePath({ trace: true, traceFile: "/explicit/path.json" }),
    "/explicit/path.json",
  );
});

Deno.test("resolveTracePath: --trace alone uses defaultDir", () => {
  assertEquals(
    resolveTracePath({ trace: true, defaultDir: "results/x" }),
    "results/x/trace.json",
  );
});

Deno.test("resolveTracePath: env CENTRALGAUGE_TRACE_FILE when no flags", () => {
  const orig = Deno.env.get("CENTRALGAUGE_TRACE_FILE");
  try {
    Deno.env.set("CENTRALGAUGE_TRACE_FILE", "/from/env.json");
    assertEquals(resolveTracePath({}), "/from/env.json");
  } finally {
    if (orig === undefined) Deno.env.delete("CENTRALGAUGE_TRACE_FILE");
    else Deno.env.set("CENTRALGAUGE_TRACE_FILE", orig);
  }
});

Deno.test("resolveTracePath: nothing set -> null", () => {
  const orig = Deno.env.get("CENTRALGAUGE_TRACE_FILE");
  Deno.env.delete("CENTRALGAUGE_TRACE_FILE");
  try {
    assertEquals(resolveTracePath({}), null);
  } finally {
    if (orig !== undefined) Deno.env.set("CENTRALGAUGE_TRACE_FILE", orig);
  }
});

Deno.test("initTracer is idempotent on subsequent calls", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-tracer-test-" });
  try {
    const a = initTracer(`${dir}/a.json`);
    const b = initTracer(`${dir}/b.json`);
    assertEquals(a, b);
    await closeTracer();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("trace file is valid JSON after close, no .tmp leftover", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-tracer-test-" });
  const file = `${dir}/trace.json`;
  try {
    initTracer(file);
    for (let i = 0; i < 50; i++) {
      getTracer().instant(`ev-${i}`, { tid: "orchestrator" });
    }
    await closeTracer();
    const text = await Deno.readTextFile(file);
    const parsed = JSON.parse(text) as { traceEvents: TraceEvent[] };
    assertGreaterOrEqual(parsed.traceEvents.length, 50);
    await assertRejects(() => Deno.stat(`${file}.tmp`));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
