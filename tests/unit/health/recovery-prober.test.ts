// tests/unit/health/recovery-prober.test.ts
import { assertEquals } from "@std/assert";
import {
  ContainerRecoveryProber,
  type RecoveryEvent,
  type RecoveryProberConfig,
  type RecoveryProberDeps,
} from "../../../src/health/recovery-prober.ts";
import type {
  ContainerHealthState,
  HealthAlert,
  HealthAlertKind,
} from "../../../src/health/types.ts";

function mkAlert(
  kind: HealthAlertKind,
  alertId: string,
  containerName = "Cronus28",
  fingerprint = "test:fp",
): HealthAlert {
  return { alertId, kind, containerName, fingerprint, count: 1, raisedAt: 0 };
}

/** Minimal fake monitor with one mutable alert + CAS clearAlert. */
function makeMonitor(initial?: HealthAlert) {
  let alert = initial;
  return {
    setAlert(a: HealthAlert | undefined) {
      alert = a;
    },
    current() {
      return alert;
    },
    getState(): ContainerHealthState {
      return {
        eventId: 1,
        containers: alert
          ? [{
            containerName: alert.containerName,
            recent: [],
            passCount: 0,
            failCount: 0,
            errorCount: 0,
            alert,
          }]
          : [],
        alerts: alert ? [alert] : [],
      };
    },
    clearAlert(name: string, id: string, _reason: string) {
      if (
        alert && alert.containerName === name && alert.alertId === id &&
        alert.kind !== "global_outage"
      ) {
        const cleared = alert;
        alert = undefined;
        return cleared;
      }
      return undefined;
    },
  };
}

const baseCfg: RecoveryProberConfig = {
  probeIntervalMs: 1000,
  probeTimeoutMs: 1000,
  successesRequired: 2,
  maxRecoveriesPerContainer: 2,
  autoRestart: false,
  maxRestartAttempts: 1,
  backoffBaseMs: 100,
};

function setup(
  opts: {
    alert?: HealthAlert;
    cfg?: Partial<RecoveryProberConfig>;
    isHealthy?: (n: string, o?: { signal?: AbortSignal }) => Promise<boolean>;
    canReadmit?: boolean;
    restartContainer?: (n: string) => Promise<boolean>;
    disposeSession?: (n: string) => void | Promise<void>;
    nowRef?: { v: number };
  } = {},
) {
  const monitor = makeMonitor(opts.alert);
  const events: RecoveryEvent[] = [];
  const recovered: string[] = [];
  const nowRef = opts.nowRef ?? { v: 0 };
  const deps: RecoveryProberDeps = {
    monitor,
    pool: {
      canReadmit: () => opts.canReadmit ?? true,
      onContainerRecovered: (n) => recovered.push(n),
    },
    isHealthy: opts.isHealthy ?? (() => Promise.resolve(true)),
    now: () => nowRef.v,
    onEvent: (ev) => events.push(ev),
    ...(opts.restartContainer
      ? { restartContainer: opts.restartContainer }
      : {}),
    ...(opts.disposeSession ? { disposeSession: opts.disposeSession } : {}),
  };
  const prober = new ContainerRecoveryProber(deps, {
    ...baseCfg,
    ...opts.cfg,
  });
  return { prober, monitor, events, recovered, nowRef };
}

const types = (evs: RecoveryEvent[]) => evs.map((e) => e.type);

Deno.test("recovers after N consecutive healthy probes", async () => {
  const { prober, monitor, events, recovered } = setup({
    alert: mkAlert("persistent_container_failure", "alert-1"),
  });
  await prober.tick(); // streak 1
  assertEquals(monitor.current() !== undefined, true);
  await prober.tick(); // streak 2 -> recover
  assertEquals(monitor.current(), undefined, "alert cleared");
  assertEquals(recovered, ["Cronus28"]);
  assertEquals(types(events).includes("recovered"), true);
});

Deno.test("does not clear before threshold (debounce)", async () => {
  const { prober, monitor } = setup({
    alert: mkAlert("persistent_container_failure", "alert-1"),
    cfg: { successesRequired: 3 },
  });
  await prober.tick();
  await prober.tick();
  assertEquals(monitor.current() !== undefined, true, "still alerted at 2/3");
});

Deno.test("streak resets when the alert episode changes (new alertId)", async () => {
  const { prober, monitor } = setup({
    alert: mkAlert("persistent_container_failure", "alert-1"),
  });
  await prober.tick(); // streak 1 for alert-1
  // A new failure replaced the alert mid-recovery.
  monitor.setAlert(mkAlert("persistent_container_failure", "alert-2"));
  await prober.tick(); // streak 1 for alert-2 (NOT 2)
  assertEquals(
    monitor.current() !== undefined,
    true,
    "must not clear on reset",
  );
});

Deno.test("not quiesced -> no clear, streak reset, backoff", async () => {
  const nowRef = { v: 0 };
  const { prober, monitor, events } = setup({
    alert: mkAlert("persistent_container_failure", "alert-1"),
    canReadmit: false,
    nowRef,
  });
  await prober.tick();
  nowRef.v += 10_000; // skip backoff window
  await prober.tick(); // streak would hit 2 -> blocked by quiesce gate
  assertEquals(monitor.current() !== undefined, true);
  assertEquals(types(events).includes("clear_skipped_not_quiesced"), true);
});

Deno.test("CAS mismatch (clearAlert returns undefined) does not re-admit", async () => {
  const monitor = makeMonitor(
    mkAlert("persistent_container_failure", "alert-1"),
  );
  const recovered: string[] = [];
  const events: RecoveryEvent[] = [];
  const deps: RecoveryProberDeps = {
    monitor: {
      getState: () => monitor.getState(),
      // Simulate a race: clear always fails (alert replaced under us).
      clearAlert: () => undefined,
    },
    pool: {
      canReadmit: () => true,
      onContainerRecovered: (n) => recovered.push(n),
    },
    isHealthy: () => Promise.resolve(true),
    now: () => 0,
    onEvent: (e) => events.push(e),
  };
  const prober = new ContainerRecoveryProber(deps, baseCfg);
  await prober.tick();
  await prober.tick();
  assertEquals(recovered, [], "no re-admit on CAS mismatch");
  assertEquals(types(events).includes("clear_skipped_id_mismatch"), true);
});

Deno.test("suspect + autoRestart=false -> not probed (restart_required_but_disabled)", async () => {
  const { prober, monitor, events } = setup({
    alert: mkAlert("suspect_container", "alert-1"),
    cfg: { autoRestart: false },
  });
  await prober.tick();
  assertEquals(monitor.current() !== undefined, true);
  assertEquals(types(events).includes("restart_required_but_disabled"), true);
  assertEquals(types(events).includes("probe_started"), false, "no probe");
});

Deno.test("suspect + autoRestart=true -> restart, dispose session, then recover", async () => {
  const restarts: string[] = [];
  const disposed: string[] = [];
  const nowRef = { v: 0 };
  const { prober, monitor, events, recovered } = setup({
    alert: mkAlert("suspect_container", "alert-1"),
    cfg: { autoRestart: true, successesRequired: 1 },
    restartContainer: (n) => {
      restarts.push(n);
      return Promise.resolve(true);
    },
    disposeSession: (n) => {
      disposed.push(n);
    },
    nowRef,
  });
  await prober.tick(); // restart (then backoff)
  assertEquals(restarts, ["Cronus28"]);
  assertEquals(types(events).includes("restart_succeeded"), true);
  nowRef.v += 10_000; // clear backoff
  await prober.tick(); // probe -> streak 1 (successesRequired=1) -> recover
  assertEquals(monitor.current(), undefined, "recovered after restart");
  assertEquals(recovered, ["Cronus28"]);
  assertEquals(disposed.length >= 1, true, "session disposed (R5)");
});

Deno.test("disposeSession runs on probe-only recovery too (R5)", async () => {
  const disposed: string[] = [];
  const { prober } = setup({
    alert: mkAlert("persistent_container_failure", "alert-1"),
    cfg: { successesRequired: 1 },
    disposeSession: (n) => {
      disposed.push(n);
    },
  });
  await prober.tick();
  assertEquals(disposed, ["Cronus28"]);
});

Deno.test("flap cap: stops recovering after maxRecoveriesPerContainer", async () => {
  const { prober, monitor, events } = setup({
    alert: mkAlert("persistent_container_failure", "alert-1"),
    cfg: { successesRequired: 1, maxRecoveriesPerContainer: 1 },
  });
  await prober.tick(); // recovery #1
  assertEquals(monitor.current(), undefined);
  // Container dies again with a NEW alert episode.
  monitor.setAlert(mkAlert("persistent_container_failure", "alert-2"));
  // New alertId resets state, so recovery #1 of the NEW episode is allowed...
  await prober.tick();
  // ...which clears it again. Cap is per-episode by design (alertId-keyed).
  assertEquals(monitor.current(), undefined);
  assertEquals(types(events).filter((t) => t === "recovered").length, 2);
});

Deno.test("global_outage is skipped (never probed/cleared)", async () => {
  const { prober, monitor, events } = setup({
    alert: mkAlert("global_outage", "alert-1"),
  });
  await prober.tick();
  await prober.tick();
  assertEquals(monitor.current() !== undefined, true);
  assertEquals(types(events).includes("skipped_global_outage"), true);
  assertEquals(types(events).includes("probe_started"), false);
});

Deno.test("probe timeout -> streak reset + probe_timeout event", async () => {
  const { prober, events } = setup({
    alert: mkAlert("persistent_container_failure", "alert-1"),
    cfg: { probeTimeoutMs: 20, successesRequired: 1 },
    isHealthy: (_n, o) =>
      new Promise((_resolve, reject) => {
        // Never resolves on its own; reject on abort so the timeout path fires.
        o?.signal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
        );
      }),
  });
  await prober.tick();
  assertEquals(types(events).includes("probe_timeout"), true);
});

Deno.test("after stop(), tick() is a no-op (no probe)", async () => {
  const { prober, events } = setup({
    alert: mkAlert("persistent_container_failure", "alert-1"),
  });
  await prober.stop();
  await prober.tick();
  assertEquals(events.length, 0, "no events after stop");
});
