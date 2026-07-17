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
  const recoveryStates: Array<
    { name: string; attempts: number; max: number; exhausted: boolean }
  > = [];
  return {
    setAlert(a: HealthAlert | undefined) {
      alert = a;
    },
    current() {
      return alert;
    },
    recoveryStates,
    setRecoveryState(
      name: string,
      s: { attempts: number; max: number; exhausted: boolean },
    ) {
      recoveryStates.push({ name, ...s });
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

Deno.test("setRecoveryState pushed on recovery (attempts, exhausted=false)", async () => {
  const { prober, monitor } = setup({
    alert: mkAlert("persistent_container_failure", "alert-1"),
    cfg: { successesRequired: 1 },
  });
  await prober.tick();
  const states = monitor.recoveryStates;
  assertEquals(states.length >= 1, true);
  const last = states[states.length - 1]!;
  assertEquals(last.name, "Cronus28");
  assertEquals(last.attempts, 1);
  assertEquals(last.exhausted, false);
});

Deno.test("flap cap is LIFETIME: no recovery past maxRecoveriesPerContainer across episodes", async () => {
  // P3: the cap must survive alert-episode transitions. The old per-episode
  // state reset on every new alertId, so the cap could never trip and a
  // flapping container recovered/re-died forever — contradicting the rule
  // doc ("left excluded (flap_cap_reached)").
  const { prober, monitor, events } = setup({
    alert: mkAlert("persistent_container_failure", "alert-1"),
    cfg: { successesRequired: 1, maxRecoveriesPerContainer: 1 },
  });
  await prober.tick(); // recovery #1 — allowed (lifetime count 0 -> 1)
  assertEquals(monitor.current(), undefined);
  // Container dies again with a NEW alert episode.
  monitor.setAlert(mkAlert("persistent_container_failure", "alert-2"));
  await prober.tick();
  // Lifetime cap (1) already consumed — NO second recovery; the container
  // stays excluded for the rest of the run.
  assertEquals(
    monitor.current() !== undefined,
    true,
    "container must stay alerted/excluded past the lifetime cap",
  );
  assertEquals(types(events).filter((t) => t === "recovered").length, 1);
  assertEquals(types(events).includes("flap_cap_reached"), true);
  // Dashboard badge shows exhausted.
  const last = monitor.recoveryStates[monitor.recoveryStates.length - 1]!;
  assertEquals(last.exhausted, true);
  assertEquals(last.attempts, 1);
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

Deno.test("late probe result after timeout is probe_timeout, NOT probe_success (P8)", async () => {
  // isHealthy IGNORES the abort signal and resolves true AFTER the
  // per-probe timeout fired. The probe must still be recorded as a
  // timeout — a wedged-then-late Test-BcContainer is not proof of health.
  const { prober, monitor, events } = setup({
    alert: mkAlert("persistent_container_failure", "alert-1"),
    cfg: { probeTimeoutMs: 20, successesRequired: 1 },
    isHealthy: () =>
      new Promise((resolve) => setTimeout(() => resolve(true), 100)),
  });
  await prober.tick();
  assertEquals(types(events).includes("probe_timeout"), true);
  assertEquals(
    types(events).includes("probe_success"),
    false,
    "late true must not count as success",
  );
  assertEquals(
    monitor.current() !== undefined,
    true,
    "alert must not clear off a timed-out probe",
  );
});

Deno.test({
  name: "stop() returns bounded even with a wedged probe (P8)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // isHealthy never settles and ignores the abort signal entirely.
    const wedged = setup({
      alert: mkAlert("persistent_container_failure", "alert-1"),
      cfg: { probeIntervalMs: 10, probeTimeoutMs: 50, successesRequired: 1 },
      isHealthy: () => new Promise<boolean>(() => {}),
    });
    wedged.prober.start();
    // Let the interval fire and the tick enter the wedged probe.
    await new Promise((r) => setTimeout(r, 40));
    const t0 = Date.now();
    const stopped = await Promise.race([
      wedged.prober.stop().then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 2000)),
    ]);
    assertEquals(
      stopped,
      true,
      `stop() must return within ~2x probeTimeout, still hanging after ${
        Date.now() - t0
      }ms`,
    );
  },
});

Deno.test("after stop(), tick() is a no-op (no probe)", async () => {
  const { prober, events } = setup({
    alert: mkAlert("persistent_container_failure", "alert-1"),
  });
  await prober.stop();
  await prober.tick();
  assertEquals(events.length, 0, "no events after stop");
});
