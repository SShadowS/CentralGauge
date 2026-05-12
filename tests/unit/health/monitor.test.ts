// tests/unit/health/monitor.test.ts
import { assertEquals, assertExists } from "@std/assert";
import { ContainerHealthMonitor } from "../../../src/health/monitor.ts";
import type { HealthAlert } from "../../../src/health/types.ts";

Deno.test("3 consecutive same-fingerprint infra errors trip alert", () => {
  const mon = new ContainerHealthMonitor({ windowSize: 10 });
  for (let i = 0; i < 3; i++) {
    mon.record({
      containerName: "Cronus281",
      result: "infra_error",
      fingerprint: "test:abc123",
      signatureId: "syslib0014",
      timestamp: 1000 + i,
    });
  }
  const state = mon.getState();
  assertEquals(state.alerts.length, 1);
  const alert = state.alerts[0];
  assertExists(alert);
  assertEquals(alert.kind, "persistent_container_failure");
  assertEquals(alert.containerName, "Cronus281");
  assertEquals(alert.signatureId, "syslib0014");
});

Deno.test("2 errors do not trip alert", () => {
  const mon = new ContainerHealthMonitor({ windowSize: 10 });
  for (let i = 0; i < 2; i++) {
    mon.record({
      containerName: "Cronus281",
      result: "infra_error",
      fingerprint: "test:abc",
      timestamp: 1000 + i,
    });
  }
  assertEquals(mon.getState().alerts.length, 0);
});

Deno.test("3-of-10 same fingerprint also trips (non-consecutive)", () => {
  const mon = new ContainerHealthMonitor({ windowSize: 10 });
  const seq: Array<"pass" | "infra_error"> = [
    "pass",
    "infra_error",
    "pass",
    "infra_error",
    "pass",
    "infra_error",
    "pass",
    "pass",
    "pass",
    "pass",
  ];
  for (const [i, result] of seq.entries()) {
    mon.record({
      containerName: "Cronus281",
      result,
      ...(result === "infra_error" ? { fingerprint: "test:abc" } : {}),
      timestamp: 1000 + i,
    });
  }
  assertEquals(mon.getState().alerts.length, 1);
});

Deno.test("global outage suppresses per-container alert", () => {
  const mon = new ContainerHealthMonitor({ windowSize: 10 });
  for (const c of ["Cronus28", "Cronus281", "Cronus282", "Cronus283"]) {
    for (let i = 0; i < 3; i++) {
      mon.record({
        containerName: c,
        result: "infra_error",
        fingerprint: "test:license-expired",
        timestamp: 1000 + i,
      });
    }
  }
  const state = mon.getState();
  const kinds = state.alerts.map((a: HealthAlert) => a.kind);
  assertEquals(kinds.includes("global_outage"), true);
  // No per-container alert for the same fingerprint when global is active
  const perContainer = state.alerts.filter(
    (a: HealthAlert) => a.kind === "persistent_container_failure",
  );
  assertEquals(perContainer.length, 0);
});

Deno.test("alert is idempotent — same threshold doesn't fire twice", () => {
  const mon = new ContainerHealthMonitor({ windowSize: 10 });
  for (let i = 0; i < 5; i++) {
    mon.record({
      containerName: "Cronus281",
      result: "infra_error",
      fingerprint: "test:abc",
      timestamp: 1000 + i,
    });
  }
  assertEquals(mon.getState().alerts.length, 1);
});

Deno.test("eventId is monotonic", () => {
  const mon = new ContainerHealthMonitor({ windowSize: 10 });
  const ids: number[] = [];
  for (let i = 0; i < 5; i++) {
    mon.record({
      containerName: "Cronus28",
      result: "pass",
      timestamp: 1000 + i,
    });
    ids.push(mon.getState().eventId);
  }
  for (let i = 1; i < ids.length; i++) {
    const prev = ids[i - 1] ?? -1;
    const curr = ids[i] ?? -2;
    assertEquals(curr > prev, true);
  }
});

Deno.test("getState returns ContainerHealth entries with rolling window", () => {
  const mon = new ContainerHealthMonitor({ windowSize: 3 });
  for (let i = 0; i < 5; i++) {
    mon.record({
      containerName: "Cronus28",
      result: "pass",
      timestamp: 1000 + i,
    });
  }
  const c = mon
    .getState()
    .containers.find((x) => x.containerName === "Cronus28");
  assertExists(c);
  assertEquals(c!.recent.length, 3); // windowed
  assertEquals(c!.passCount, 5); // counter NOT windowed
});

Deno.test("cold start: 1 error never trips", () => {
  const mon = new ContainerHealthMonitor({ windowSize: 10 });
  mon.record({
    containerName: "Cronus281",
    result: "infra_error",
    fingerprint: "test:abc",
    timestamp: 1000,
  });
  assertEquals(mon.getState().alerts.length, 0);
});
