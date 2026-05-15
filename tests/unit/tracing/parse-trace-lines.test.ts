import { assert, assertEquals, assertExists } from "@std/assert";
import {
  mergeIntoTracer,
  parseTraceLines,
} from "../../../src/tracing/parse-trace-lines.ts";
import {
  closeTracer,
  initTracer,
  type TraceEvent,
} from "../../../src/tracing/tracer.ts";

// Pure parser tests — no tracer state.

Deno.test("parseTraceLines extracts a single well-formed event", () => {
  const stdout = `Some BCH chatter
[TRACE] {"name":"Get-BcContainerAppInfo","ph":"X","ts":12345,"dur":6789,"pid":0,"tid":101,"cat":"pwsh,bcch","args":{"container":"Cronus281"}}
PUBLISH_OK`;
  const r = parseTraceLines(stdout);
  assertEquals(r.events.length, 1);
  assertEquals(r.events[0]!.name, "Get-BcContainerAppInfo");
  assertEquals(r.events[0]!.dur, 6789);
  assertEquals(r.events[0]!.tid, 101);
  assertEquals(r.parseErrors, 0);
  // Filtered output preserves non-trace lines exactly.
  assertEquals(r.filteredOutput, "Some BCH chatter\nPUBLISH_OK");
});

Deno.test("parseTraceLines is strict about the prefix", () => {
  const stdout = [
    "[TRACE]", // missing space + brace
    "[TRACE] not-json", // missing opening brace
    '  [TRACE] {"x":1}', // leading whitespace → not a match
    "TRACE: hello",
  ].join("\n");
  const r = parseTraceLines(stdout);
  assertEquals(r.events.length, 0);
  assertEquals(r.parseErrors, 0); // lines didn't even start with prefix
  assertEquals(r.filteredOutput, stdout);
});

Deno.test("parseTraceLines counts JSON parse failures separately", () => {
  const stdout = [
    `[TRACE] {"name":"ok","ph":"X","pid":0,"tid":1}`,
    `[TRACE] {bad json}`,
    `[TRACE] {"missing":"required-fields"}`, // missing name/ph/tid
    `[TRACE] {"name":"ok2","ph":"i","pid":0,"tid":2}`,
  ].join("\n");
  const r = parseTraceLines(stdout);
  assertEquals(r.events.length, 2);
  assertEquals(r.parseErrors, 2);
  assertEquals(r.events[0]!.name, "ok");
  assertEquals(r.events[1]!.name, "ok2");
});

Deno.test("parseTraceLines handles multiple events per script", () => {
  const stdout = Array.from(
    { length: 5 },
    (_v, i) =>
      `[TRACE] {"name":"ev-${i}","ph":"X","ts":${
        i * 1000
      },"dur":500,"pid":0,"tid":101}`,
  ).join("\n");
  const r = parseTraceLines(stdout);
  assertEquals(r.events.length, 5);
  for (let i = 0; i < 5; i++) {
    assertEquals(r.events[i]!.name, `ev-${i}`);
    assertEquals(r.events[i]!.ts, i * 1000);
  }
});

Deno.test("parseTraceLines interleaves trace lines with normal output", () => {
  const stdout = `CLEANUP:Removing OldApp
[TRACE] {"name":"Get-BcContainerAppInfo","ph":"X","ts":100,"dur":5000,"pid":0,"tid":101}
PUBLISH_START:1234567890
[TRACE] {"name":"Publish-BcContainerApp","ph":"X","ts":5200,"dur":12000,"pid":0,"tid":101}
PUBLISH_END:1234580000
PUBLISH_OK`;
  const r = parseTraceLines(stdout);
  assertEquals(r.events.length, 2);
  assertEquals(r.parseErrors, 0);
  // Non-trace lines preserved in order.
  assertEquals(
    r.filteredOutput,
    `CLEANUP:Removing OldApp\nPUBLISH_START:1234567890\nPUBLISH_END:1234580000\nPUBLISH_OK`,
  );
});

Deno.test("parseTraceLines handles CRLF line endings", () => {
  const stdout =
    `[TRACE] {"name":"ev","ph":"X","ts":0,"dur":1,"pid":0,"tid":1}\r\nDONE\r\n`;
  const r = parseTraceLines(stdout);
  assertEquals(r.events.length, 1);
  assertEquals(r.filteredOutput, "DONE\n");
});

Deno.test("parseTraceLines handles empty input", () => {
  const r = parseTraceLines("");
  assertEquals(r.events.length, 0);
  assertEquals(r.parseErrors, 0);
  assertEquals(r.filteredOutput, "");
});

// mergeIntoTracer integration tests — write to a real (temp) trace file.

async function withTracer(
  fn: (filePath: string) => Promise<void> | void,
): Promise<TraceEvent[]> {
  const dir = await Deno.makeTempDir({ prefix: "cg-parse-trace-test-" });
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

Deno.test("mergeIntoTracer is a noop when tracer is disabled", async () => {
  await closeTracer();
  const stdout =
    `[TRACE] {"name":"x","ph":"X","ts":0,"dur":1,"pid":0,"tid":1}\nDONE`;
  const result = mergeIntoTracer(stdout);
  // Returns input unchanged.
  assertEquals(result, stdout);
});

Deno.test("mergeIntoTracer forwards events into active tracer", async () => {
  const events = await withTracer(() => {
    const stdout = [
      `[TRACE] {"name":"Get-BcContainerAppInfo","ph":"X","ts":1000,"dur":5000,"pid":0,"tid":101,"cat":"pwsh,bcch"}`,
      `[TRACE] {"name":"Unpublish-BcContainerApp","ph":"X","ts":6500,"dur":3500,"pid":0,"tid":101,"cat":"pwsh,bcch"}`,
      `CLEANUP_DONE`,
    ].join("\n");
    const filtered = mergeIntoTracer(stdout, "Cronus281 (pwsh cmdlets)");
    assertEquals(filtered, "CLEANUP_DONE");
  });
  const getInfo = events.find((e) => e.name === "Get-BcContainerAppInfo");
  const unpub = events.find((e) => e.name === "Unpublish-BcContainerApp");
  assertExists(getInfo);
  assertExists(unpub);
  // ts and dur preserved exactly from pwsh side.
  assertEquals(getInfo!.ts, 1000);
  assertEquals(getInfo!.dur, 5000);
  assertEquals(unpub!.ts, 6500);
  assertEquals(unpub!.dur, 3500);
  // Lane labeled with the supplied default.
  const meta = events.filter(
    (e) => e.ph === "M" && e.name === "thread_name" && e.tid === 101,
  );
  assertEquals(meta.length, 1);
  assertEquals(meta[0]!.args!["name"], "Cronus281 (pwsh cmdlets)");
});

Deno.test("mergeIntoTracer emits trace-parse-error on malformed lines", async () => {
  const events = await withTracer(() => {
    const stdout = [
      `[TRACE] {"name":"ok","ph":"X","ts":0,"dur":1,"pid":0,"tid":101}`,
      `[TRACE] {garbage}`,
      `[TRACE] {garbage2}`,
    ].join("\n");
    mergeIntoTracer(stdout, "Cronus281 (pwsh cmdlets)");
  });
  const parseErr = events.find((e) => e.name === "trace-parse-error");
  assertExists(parseErr);
  assertEquals(parseErr!.args!["count"], 2);
});

Deno.test("mergeIntoTracer's pushPreformed redacts string args", async () => {
  const events = await withTracer(() => {
    // Build an event with a long secret-looking string in args.
    const longSecret = "Bearer " + "x".repeat(500);
    const json = JSON.stringify({
      name: "ev",
      ph: "X",
      ts: 0,
      dur: 1,
      pid: 0,
      tid: 101,
      args: { token: longSecret },
    });
    mergeIntoTracer(`[TRACE] ${json}`);
  });
  const ev = events.find((e) => e.name === "ev");
  assertExists(ev);
  const token = ev!.args!["token"] as string;
  // Capped to ≤200 chars (+1 char for the ellipsis).
  assert(
    token.length <= 201,
    `expected redacted+capped; got length=${token.length}`,
  );
});
