import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ConfigurationError } from "../../../src/errors.ts";
import { reserveCredentialRun } from "../../../src/harness/credential-budget.ts";

const r = {
  lane: "lane-ops",
  task: "HX-001",
  config: "cc-sonnet-plain",
  purpose: "M1-29 gate",
};

Deno.test("reserveCredentialRun: five across all lanes, then refused; concurrent callers serialize", async () => {
  const ledger = join(
    await Deno.realPath(await Deno.makeTempDir()),
    "credential-runs.jsonl",
  );
  const results = await Promise.allSettled(
    Array.from(
      { length: 7 },
      (_, i) =>
        reserveCredentialRun(ledger, {
          ...r,
          lane: i % 2 ? "lane-ops" : "M4-17",
        }),
    ),
  );
  assertEquals(
    results.filter((x) => x.status === "fulfilled").map((x) =>
      (x as PromiseFulfilledResult<number>).value
    ).sort(),
    [1, 2, 3, 4, 5],
  );
  assertEquals((await Deno.readTextFile(ledger)).trim().split("\n").length, 5);
  await assertRejects(
    () => reserveCredentialRun(ledger, r),
    ConfigurationError,
    "5 supervised",
  );
});

Deno.test("reserveCredentialRun: no shared ledger configured is refused (fail closed)", async () => {
  await assertRejects(
    () => reserveCredentialRun(null, r),
    ConfigurationError,
    "ledger",
  );
});

Deno.test("reserveCredentialRun: an unreadable ledger refuses; partial lines still count", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  const asDir = join(dir, "ledger-is-a-directory");
  await Deno.mkdir(asDir);
  await assertRejects(
    () => reserveCredentialRun(asDir, r),
    ConfigurationError,
    "cannot read",
  );
  const partial = join(dir, "partial.jsonl");
  await Deno.writeTextFile(partial, '{"v":1}\n{"trunc\nx\nx\nx\n');
  await assertRejects(
    () => reserveCredentialRun(partial, r),
    ConfigurationError,
    "5 supervised",
  );
});

Deno.test("reserveCredentialRun: a crash-truncated last line is never merged with the next reservation", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  const ledger = join(dir, "credential-runs.jsonl");
  // A writer died mid-line: no trailing newline.
  await Deno.writeTextFile(ledger, '{"v":1}\n{"v":1,"ordi');
  assertEquals(await reserveCredentialRun(ledger, r), 3);
  const lines = (await Deno.readTextFile(ledger)).split("\n").filter(Boolean);
  assertEquals(lines.length, 3);
  assertEquals(JSON.parse(lines[2]!).ordinal, 3);
  assertEquals(await reserveCredentialRun(ledger, r), 4);
});

Deno.test("reserveCredentialRun: a missing ledger folder or an empty field is refused", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  await assertRejects(
    () => reserveCredentialRun(join(dir, "no-such-dir", "l.jsonl"), r),
    ConfigurationError,
    "no-such-dir",
  );
  await assertRejects(
    () => reserveCredentialRun(join(dir, "l.jsonl"), { ...r, task: "" }),
    ConfigurationError,
    "task",
  );
});

Deno.test("reserveCredentialRun: a lock file left by a crashed holder never blocks or double-spends", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  const ledger = join(dir, "credential-runs.jsonl");
  // A crashed holder left its lock file behind (fresh, not stale by age).
  await Deno.writeTextFile(`${ledger}.lock`, "");
  const t0 = performance.now();
  const got = await Promise.all([
    reserveCredentialRun(ledger, r),
    reserveCredentialRun(ledger, r),
  ]);
  assertEquals(got.sort(), [1, 2]);
  assertEquals(performance.now() - t0 < 5_000, true, "no stale-age wait");
});

Deno.test("reserveCredentialRun: a held lock refuses after the bounded wait and leaves nothing pending", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  const ledger = join(dir, "credential-runs.jsonl");
  const holder = await Deno.open(`${ledger}.lock`, {
    read: true,
    write: true,
    create: true,
  });
  await holder.lock(true);
  try {
    await assertRejects(
      () => reserveCredentialRun(ledger, r, 5, { waitMs: 150 }),
      ConfigurationError,
      "stayed locked",
    );
  } finally {
    holder.close();
  }
  // The op sanitizer fails this test if a lock request is still pending.
  assertEquals(await reserveCredentialRun(ledger, r), 1);
});

Deno.test("reserveCredentialRun: the stop signal aborts the wait; an aborted signal reserves nothing", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  const ledger = join(dir, "credential-runs.jsonl");
  const stop = new AbortController();
  stop.abort();
  await assertRejects(
    () => reserveCredentialRun(ledger, r, 5, { signal: stop.signal }),
    ConfigurationError,
    "stopped",
  );
  const holder = await Deno.open(`${ledger}.lock`, {
    read: true,
    write: true,
    create: true,
  });
  await holder.lock(true);
  const live = new AbortController();
  const t0 = performance.now();
  setTimeout(() => live.abort(), 100);
  try {
    await assertRejects(
      () => reserveCredentialRun(ledger, r, 5, { signal: live.signal }),
      ConfigurationError,
      "stopped",
    );
  } finally {
    holder.close();
  }
  assertEquals(performance.now() - t0 < 5_000, true);
  assertEquals(
    await Deno.stat(ledger).then(() => true, () => false),
    false,
    "nothing written",
  );
});

Deno.test("reserveCredentialRun: an unknown or placeholder lane is refused and nothing is recorded", async () => {
  const ledger = join(
    await Deno.realPath(await Deno.makeTempDir()),
    "credential-runs.jsonl",
  );
  for (const lane of ["unknown-lane", "unknown", "Unknown", " "]) {
    await assertRejects(
      () => reserveCredentialRun(ledger, { ...r, lane }),
      ConfigurationError,
      "lane",
    );
  }
  await assertRejects(
    () => reserveCredentialRun(ledger, { ...r, lane: "" }),
    ConfigurationError,
    "CG_LANE",
  );
  await assertRejects(() => Deno.stat(ledger), Deno.errors.NotFound);
  assertEquals(await reserveCredentialRun(ledger, r), 1);
  assertEquals(JSON.parse(await Deno.readTextFile(ledger)).lane, "lane-ops");
});
