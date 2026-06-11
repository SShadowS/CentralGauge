// tests/unit/cli/container-setup.test.ts
//
// GH #13 (footnote): the last task's candidate + prereq stayed published at
// bench end — cleanup only ran at next-task prep and bench startup, never at
// end-of-run. endOfRunNuke() sweeps all CentralGauge apps from the bench
// containers when a run completes.
import { assertEquals } from "@std/assert";
import type { ContainerProvider } from "../../../src/container/interface.ts";
import { endOfRunNuke } from "../../../cli/commands/bench/container-setup.ts";

Deno.test("endOfRunNuke calls prenukeCentralGaugeApps with all containers", async () => {
  const calls: string[][] = [];
  const provider = {
    prenukeCentralGaugeApps: (names: string[]) => {
      calls.push(names);
      return Promise.resolve();
    },
  } as unknown as ContainerProvider;

  await endOfRunNuke(provider, ["Cronus28", "Cronus281"]);

  assertEquals(calls, [["Cronus28", "Cronus281"]]);
});

Deno.test("endOfRunNuke no-ops when provider lacks prenukeCentralGaugeApps", async () => {
  // Must not throw (e.g. docker/mock providers).
  await endOfRunNuke({} as unknown as ContainerProvider, ["Cronus28"]);
});

Deno.test("endOfRunNuke is best-effort and swallows provider errors", async () => {
  const provider = {
    prenukeCentralGaugeApps: () => Promise.reject(new Error("container down")),
  } as unknown as ContainerProvider;

  // Must not throw — end-of-run cleanup must never fail the bench.
  await endOfRunNuke(provider, ["Cronus28"]);
});

Deno.test("endOfRunNuke no-ops on an empty container list", async () => {
  let called = false;
  const provider = {
    prenukeCentralGaugeApps: () => {
      called = true;
      return Promise.resolve();
    },
  } as unknown as ContainerProvider;

  await endOfRunNuke(provider, []);

  assertEquals(called, false);
});
