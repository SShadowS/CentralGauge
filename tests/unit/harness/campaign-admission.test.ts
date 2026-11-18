/**
 * H-114b test 1: the dynamic-concurrency admission gate (admissionGate), pure,
 * on a fake clock and a fake RAM reader.
 */

import { assert, assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import {
  admissionGate,
  ADMIT_FREE_GIB,
  ADMIT_HOLD_MS,
  ADMIT_POLL_MS,
  ADMIT_SETTLE_MS,
  freeRamGib,
  MAX_DYNAMIC_CONCURRENCY,
} from "../../../src/harness/campaign.ts";

const MIN = 60_000;

/** A gate on a fake clock; `ram` is the next reading (or a throw). */
function fake(start = 0) {
  const s = { t: start, ram: 60 as number | (() => number) };
  const gate = admissionGate({
    threshold: 30,
    holdMs: 5 * MIN,
    settleMs: 5 * MIN,
    read: () => typeof s.ram === "function" ? s.ram() : s.ram,
    now: () => s.t,
  });
  /** Polls every POLL until `until`; the instants that admitted. */
  const poll = (until: number) => {
    const yes: number[] = [];
    while (s.t <= until) {
      if (gate.tryAdmit()) yes.push(s.t);
      s.t += ADMIT_POLL_MS;
    }
    return yes;
  };
  return { s, gate, poll };
}

Deno.test("H-114b rulings: T 30 GiB, ceiling 4, hold 5 min, settle 5 min, poll 5 s", () => {
  assertEquals(
    [
      ADMIT_FREE_GIB,
      MAX_DYNAMIC_CONCURRENCY,
      ADMIT_HOLD_MS,
      ADMIT_SETTLE_MS,
      ADMIT_POLL_MS,
    ],
    [30, 4, 5 * MIN, 5 * MIN, 5_000],
  );
});

Deno.test("admission: a reading below T never admits; exactly T counts", () => {
  const low = fake();
  low.s.ram = 29.99;
  assertEquals(low.poll(60 * MIN), []);
  const at = fake();
  at.s.ram = 30;
  assertEquals(at.poll(5 * MIN), [5 * MIN]);
});

Deno.test("admission: only after HOLD of unbroken readings >= T; one reading below restarts the hold", () => {
  const { s, gate } = fake();
  s.t = 10 * MIN; // settle long past
  assertEquals(gate.tryAdmit(), false, "first reading starts the hold");
  s.t += 4 * MIN;
  assertEquals(gate.tryAdmit(), false, "4 min held");
  s.ram = 20;
  s.t += 30_000;
  assertEquals(gate.tryAdmit(), false, "below T breaks the run");
  s.ram = 60;
  s.t += 5_000;
  const restart = s.t;
  assertEquals(gate.tryAdmit(), false, "hold restarts here");
  s.t = restart + 5 * MIN - 1;
  assertEquals(gate.tryAdmit(), false, "1 ms short of a fresh hold");
  s.t = restart + 5 * MIN;
  assertEquals(gate.tryAdmit(), true);
});

Deno.test("admission: the initial settle starts at creation; high RAM from t=0 admits no earlier than max(HOLD, SETTLE)", () => {
  const { poll } = fake(1_000_000);
  assertEquals(poll(1_000_000 + 5 * MIN)[0], 1_000_000 + 5 * MIN);
  // A short hold still waits for the creation-time settle.
  const s = { t: 0 };
  const gate = admissionGate({
    threshold: 30,
    holdMs: 0,
    settleMs: 5 * MIN,
    read: () => 60,
    now: () => s.t,
  });
  s.t = 5 * MIN - 1;
  assertEquals(gate.tryAdmit(), false, "inside the creation settle");
  s.t = 5 * MIN;
  assertEquals(gate.tryAdmit(), true);
});

Deno.test("admission reserves: two tryAdmit at the same instant admit once; the next needs a fresh SETTLE and HOLD", () => {
  const { s, gate } = fake();
  s.t = 10 * MIN;
  gate.tryAdmit();
  s.t = 15 * MIN;
  assertEquals(gate.tryAdmit(), true, "first worker");
  assertEquals(gate.tryAdmit(), false, "second worker, same tick");
  // Inside the settle of that admission: no, even with RAM high throughout.
  s.t = 15 * MIN + 5 * MIN - 5_000;
  assertEquals(gate.tryAdmit(), false, "inside the settle");
  s.t = 15 * MIN + 5 * MIN;
  assertEquals(gate.tryAdmit(), true, "a full settle and a fresh hold since");
  assertEquals(gate.tryAdmit(), false, "and again only one admit");
});

Deno.test("admission: the fresh hold after a reservation starts at its first reading, never earlier", () => {
  const { s, gate } = fake();
  s.t = 10 * MIN;
  gate.tryAdmit();
  s.t = 15 * MIN;
  assertEquals(gate.tryAdmit(), true);
  // No worker waited for 8 min (no readings); the hold starts now.
  s.t = 23 * MIN;
  assertEquals(gate.tryAdmit(), false, "settle long over, hold just started");
  s.t = 28 * MIN - 1;
  assertEquals(gate.tryAdmit(), false);
  s.t = 28 * MIN;
  assertEquals(gate.tryAdmit(), true);
});

Deno.test("admission: a reader that throws or returns NaN/Infinity never admits and restarts the hold", () => {
  for (
    const bad of [
      () => {
        throw new Error("no sysinfo");
      },
      () => NaN,
      () => Infinity,
    ]
  ) {
    const { s, gate, poll } = fake();
    s.ram = bad;
    assertEquals(poll(30 * MIN), [], String(bad));
    s.ram = 60;
    s.t = 30 * MIN;
    assertEquals(gate.tryAdmit(), false, "hold starts only now");
    s.t = 35 * MIN;
    assertEquals(gate.tryAdmit(), true);
  }
  // A bad reading in the middle of a hold restarts it.
  const { s, gate } = fake();
  s.t = 10 * MIN;
  gate.tryAdmit();
  s.ram = NaN;
  s.t = 14 * MIN;
  assertEquals(gate.tryAdmit(), false);
  s.ram = 60;
  s.t = 15 * MIN;
  assertEquals(gate.tryAdmit(), false, "the earlier hold is gone");
  s.t = 20 * MIN;
  assertEquals(gate.tryAdmit(), true);
});

Deno.test("the default RAM reader is systemMemoryInfo().free in GiB, never .available", () => {
  const info = Deno.systemMemoryInfo();
  const s = stub(Deno, "systemMemoryInfo", () => ({
    ...info,
    total: 100 * 2 ** 30,
    free: 39.5 * 2 ** 30,
    available: 0,
  }));
  try {
    assertEquals(freeRamGib(), 39.5);
  } finally {
    s.restore();
  }
  assert(Number.isFinite(freeRamGib()));
});
