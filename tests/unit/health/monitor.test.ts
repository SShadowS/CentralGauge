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

Deno.test("ramp-up: 2-of-6 same fp does NOT trip global outage when expectedContainers is set", () => {
  // Regression for the live-bench bug: monitor was firing global_outage with
  // ratio 2/2 (containers seen so far) when 4 more containers were still in
  // LLM/compile phases. With expectedContainers=6 the ratio becomes 2/6=33%
  // which is below the 50% threshold, so per-container alerts fire instead.
  const mon = new ContainerHealthMonitor({
    windowSize: 10,
    expectedContainers: 6,
  });
  for (const c of ["Cronus28", "Cronus281"]) {
    for (let i = 0; i < 3; i++) {
      mon.record({
        containerName: c,
        result: "infra_error",
        fingerprint: "test:syslib0014",
        timestamp: 1000 + i,
      });
    }
  }
  const state = mon.getState();
  const kinds = state.alerts.map((a) => a.kind);
  assertEquals(kinds.includes("global_outage"), false);
  // Each container should get its own persistent alert
  assertEquals(
    state.alerts.filter((a) => a.kind === "persistent_container_failure")
      .length,
    2,
  );
});

Deno.test("globalOutageMinContainers default 3 prevents 2-container global", () => {
  // Even without expectedContainers, 2 containers all hitting the same fp
  // shouldn't trigger global by default — 2 is too easy to hit coincidentally.
  const mon = new ContainerHealthMonitor({ windowSize: 10 });
  for (const c of ["Cronus28", "Cronus281"]) {
    for (let i = 0; i < 3; i++) {
      mon.record({
        containerName: c,
        result: "infra_error",
        fingerprint: "test:syslib0014",
        timestamp: 1000 + i,
      });
    }
  }
  const state = mon.getState();
  const kinds = state.alerts.map((a) => a.kind);
  assertEquals(kinds.includes("global_outage"), false);
  assertEquals(
    state.alerts.filter((a) => a.kind === "persistent_container_failure")
      .length,
    2,
  );
});

Deno.test("expectedContainerNames seeds zero-count rows before any record()", () => {
  const mon = new ContainerHealthMonitor({
    windowSize: 10,
    expectedContainerNames: ["Cronus28", "Cronus281", "Cronus282"],
  });
  const state = mon.getState();
  assertEquals(state.containers.length, 3);
  for (const c of state.containers) {
    assertEquals(c.passCount, 0);
    assertEquals(c.failCount, 0);
    assertEquals(c.errorCount, 0);
  }
});

Deno.test("getState() sorts containers: configured order first, then unseeded by name", () => {
  const mon = new ContainerHealthMonitor({
    windowSize: 10,
    expectedContainerNames: ["Cronus28", "Cronus281"],
  });
  mon.record({
    containerName: "CronusZZ",
    result: "pass",
    timestamp: 1000,
  });
  mon.record({
    containerName: "CronusAA",
    result: "pass",
    timestamp: 1001,
  });
  const state = mon.getState();
  const names = state.containers.map((c) => c.containerName);
  assertEquals(names, ["Cronus28", "Cronus281", "CronusAA", "CronusZZ"]);
});

Deno.test("expectedContainerNames dedups duplicates while preserving first-occurrence order", () => {
  const mon = new ContainerHealthMonitor({
    windowSize: 10,
    expectedContainerNames: ["Cronus28", "Cronus281", "Cronus28"],
  });
  const state = mon.getState();
  assertEquals(state.containers.map((c) => c.containerName), [
    "Cronus28",
    "Cronus281",
  ]);
});

Deno.test("record() returns alertRaised=true ONLY on the transition outcome", () => {
  const mon = new ContainerHealthMonitor({ windowSize: 10 });
  // First two hits: alert not yet raised
  for (let i = 0; i < 2; i++) {
    const r = mon.record({
      containerName: "Cronus281",
      result: "infra_error",
      fingerprint: "test:abc",
      timestamp: 1000 + i,
    });
    assertEquals(r.alertRaised, false);
    assertEquals(r.alert, undefined);
  }
  // Third hit: raises persistent_container_failure
  const r3 = mon.record({
    containerName: "Cronus281",
    result: "infra_error",
    fingerprint: "test:abc",
    timestamp: 1003,
  });
  assertEquals(r3.alertRaised, true);
  assertExists(r3.alert);
  assertEquals(r3.alert!.kind, "persistent_container_failure");
  // Subsequent hits at same threshold: NOT re-raised
  const r4 = mon.record({
    containerName: "Cronus281",
    result: "infra_error",
    fingerprint: "test:abc",
    timestamp: 1004,
  });
  assertEquals(r4.alertRaised, false);
  assertEquals(r4.alert, undefined);
});

Deno.test("alertId is monotonic and assigned exactly once per transition", () => {
  const mon = new ContainerHealthMonitor({ windowSize: 10 });
  const ids: string[] = [];
  for (const c of ["Cronus28", "Cronus281"]) {
    for (let i = 0; i < 3; i++) {
      const r = mon.record({
        containerName: c,
        result: "infra_error",
        fingerprint: `test:${c}`, // different fp per container so no global outage
        timestamp: 1000 + i,
      });
      if (r.alertRaised && r.alert) ids.push(r.alert.alertId);
    }
  }
  assertEquals(ids.length, 2);
  assertEquals(
    ids[0] !== ids[1],
    true,
    "alertId must differ across transitions",
  );
  // Monotonic: parsed numeric tail of "alert-N" must increase
  const n0 = parseInt((ids[0] ?? "").replace("alert-", ""), 10);
  const n1 = parseInt((ids[1] ?? "").replace("alert-", ""), 10);
  assertEquals(n1 > n0, true);
});

Deno.test("on('alert_raised') fires exactly once per state transition", () => {
  const mon = new ContainerHealthMonitor({ windowSize: 10 });
  const fired: HealthAlert[] = [];
  const unsubscribe = mon.on("alert_raised", (alert) => {
    fired.push(alert);
  });
  for (let i = 0; i < 5; i++) {
    mon.record({
      containerName: "Cronus281",
      result: "infra_error",
      fingerprint: "test:abc",
      timestamp: 1000 + i,
    });
  }
  assertEquals(
    fired.length,
    1,
    "listener fires exactly once across 5 same-fp hits",
  );
  assertEquals(fired[0]!.kind, "persistent_container_failure");
  assertEquals(typeof fired[0]!.alertId, "string");
  unsubscribe();
  // After unsubscribe, no further calls (verify by re-trigger on a different container)
  for (let i = 0; i < 3; i++) {
    mon.record({
      containerName: "Cronus28",
      result: "infra_error",
      fingerprint: "test:other",
      timestamp: 2000 + i,
    });
  }
  assertEquals(fired.length, 1, "no further callbacks after unsubscribe");
});

Deno.test("on('alert_raised'): listener exception is isolated", () => {
  const mon = new ContainerHealthMonitor({ windowSize: 10 });
  const good: HealthAlert[] = [];
  mon.on("alert_raised", () => {
    throw new Error("intentional listener failure");
  });
  mon.on("alert_raised", (a) => good.push(a));
  // Monitor must still update state and still call the second listener
  for (let i = 0; i < 3; i++) {
    mon.record({
      containerName: "Cronus281",
      result: "infra_error",
      fingerprint: "test:abc",
      timestamp: 1000 + i,
    });
  }
  assertEquals(good.length, 1, "second listener must still be called");
  assertEquals(
    mon.getState().alerts.length,
    1,
    "monitor state must still update",
  );
});

Deno.test("on('alert_raised'): unsubscribe is idempotent", () => {
  const mon = new ContainerHealthMonitor({ windowSize: 10 });
  const unsub = mon.on("alert_raised", () => {});
  unsub();
  unsub(); // Second call must not throw
});

Deno.test("SUSPECT: catastrophic signature trips on FIRST hit (sql_service_down)", () => {
  const mon = new ContainerHealthMonitor({ windowSize: 10 });
  const r = mon.record({
    containerName: "Cronus28",
    result: "infra_error",
    fingerprint: "test:sql-fp",
    signatureId: "sql_service_down",
    timestamp: 1000,
  });
  assertEquals(r.alertRaised, true);
  assertExists(r.alert);
  assertEquals(r.alert!.kind, "suspect_container");
  assertEquals(r.alert!.count, 1);
  assertEquals(r.alert!.containerName, "Cronus28");
  assertEquals(mon.getState().alerts.length, 1);
});

Deno.test("SUSPECT: container_offline + pssession_lost are catastrophic too", () => {
  for (const sigId of ["container_offline", "pssession_lost"]) {
    const mon = new ContainerHealthMonitor({ windowSize: 10 });
    const r = mon.record({
      containerName: "Cronus28",
      result: "infra_error",
      fingerprint: `test:${sigId}`,
      signatureId: sigId,
      timestamp: 1000,
    });
    assertEquals(
      r.alertRaised,
      true,
      `${sigId} must trip SUSPECT on first hit`,
    );
    assertEquals(r.alert!.kind, "suspect_container");
  }
});

Deno.test("SUSPECT: non-catastrophic signature still needs 3 hits", () => {
  const mon = new ContainerHealthMonitor({ windowSize: 10 });
  // syslib0014 is catastrophic-FALSE in signatures.ts (we did not flag it)
  for (let i = 0; i < 2; i++) {
    const r = mon.record({
      containerName: "Cronus28",
      result: "infra_error",
      fingerprint: "test:syslib",
      signatureId: "syslib0014",
      timestamp: 1000 + i,
    });
    assertEquals(r.alertRaised, false);
  }
  const r3 = mon.record({
    containerName: "Cronus28",
    result: "infra_error",
    fingerprint: "test:syslib",
    signatureId: "syslib0014",
    timestamp: 1003,
  });
  assertEquals(r3.alertRaised, true);
  assertEquals(r3.alert!.kind, "persistent_container_failure");
});

Deno.test("SUSPECT: idempotent — same (container, fp) does not re-fire", () => {
  const mon = new ContainerHealthMonitor({ windowSize: 10 });
  const fired: HealthAlert[] = [];
  mon.on("alert_raised", (a) => fired.push(a));
  for (let i = 0; i < 5; i++) {
    mon.record({
      containerName: "Cronus28",
      result: "infra_error",
      fingerprint: "test:sql-fp",
      signatureId: "sql_service_down",
      timestamp: 1000 + i,
    });
  }
  assertEquals(fired.length, 1);
});

Deno.test("SUSPECT: 3+ same-fp hits do NOT upgrade SUSPECT to persistent", () => {
  const mon = new ContainerHealthMonitor({ windowSize: 10 });
  for (let i = 0; i < 5; i++) {
    mon.record({
      containerName: "Cronus28",
      result: "infra_error",
      fingerprint: "test:sql-fp",
      signatureId: "sql_service_down",
      timestamp: 1000 + i,
    });
  }
  const state = mon.getState();
  assertEquals(state.alerts.length, 1);
  assertEquals(state.alerts[0]!.kind, "suspect_container");
});

Deno.test("SUSPECT: global outage retracts existing suspect alerts", () => {
  const mon = new ContainerHealthMonitor({ windowSize: 10 });
  // Three containers each raise SUSPECT via sql_service_down — the global
  // path then kicks in (3-of-3 ≥ 50%) and must retract per-container suspects.
  for (const c of ["Cronus28", "Cronus281", "Cronus282"]) {
    mon.record({
      containerName: c,
      result: "infra_error",
      fingerprint: "test:sql-fp",
      signatureId: "sql_service_down",
      timestamp: 1000,
    });
  }
  const state = mon.getState();
  const kinds = state.alerts.map((a) => a.kind);
  assertEquals(kinds.includes("global_outage"), true);
  assertEquals(kinds.includes("suspect_container"), false);
});
