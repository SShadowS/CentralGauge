import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { decodeHex } from "jsr:@std/encoding@^1.0.5/hex";
import { join } from "@std/path";
import { parse } from "@std/yaml";
import {
  entryHash,
  ledgerProblems,
  loadLedgerAnchors,
  ScreeningSchema,
  type SealEntry,
  SealsSchema,
} from "../../../scripts/harness/screening.ts";
import {
  beaconRound,
  DRAND_CHAIN,
  ledger,
  prepare,
  pushedAt,
  type SealIo,
} from "../../../scripts/harness/seal.ts";
import { sha256Hex } from "../../../src/harness/hash.ts";
import { tempDir } from "./temp-dirs.ts";

const START = "harness-v2-screen-start";
const TAG = "harness-v2-screen-w2r2";
const REPO_ROOT = new URL("../../../", import.meta.url);

async function sh(cwd: string, ...args: string[]): Promise<string> {
  const out = await new Deno.Command("git", {
    args: [
      "-c",
      "core.autocrlf=false",
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.invalid",
      ...args,
    ],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) {
    throw new Error(
      `git ${args.join(" ")}: ${new TextDecoder().decode(out.stderr)}`,
    );
  }
  return new TextDecoder().decode(out.stdout).trim();
}

const realFile = (rel: string) => Deno.readTextFile(new URL(rel, REPO_ROOT));

/** The real ledger's first entry (its refs do not resolve here; seal.ts never checks them). */
async function startEntry(): Promise<SealEntry> {
  const s = SealsSchema.parse(
    parse(await realFile("harness-tasks/v2/seals.yml")),
  );
  return s.seals[0]!;
}

/**
 * Scratch repo + bare origin (nothing leaves the machine): the real
 * screening.yml with its calibration round renamed to the start seal (so a
 * sealed calibration round exists; `unsealedRound` keeps w2r1, a round no
 * seal has), a refapp file, the start seal and its -ledger tag, all pushed.
 */
async function sealRepo(
  o: { eol?: "\n" | "\r\n"; unsealedRound?: boolean } = {},
) {
  const dir = await tempDir({ prefix: "cg-seal-" });
  const origin = join(dir, "origin.git");
  const repo = join(dir, "repo");
  await Deno.mkdir(join(repo, "harness-tasks", "v2"), { recursive: true });
  await Deno.mkdir(join(repo, "harness-tasks", "refapp"), { recursive: true });
  await sh(dir, "init", "-q", "--bare", origin);
  await sh(repo, "init", "-q", "-b", "master");
  await sh(repo, "config", "user.name", "t");
  await sh(repo, "config", "user.email", "t@example.invalid");
  await sh(repo, "remote", "add", "origin", origin);
  const eol = o.eol ?? "\n";
  const lf = (await realFile("harness-tasks/v2/screening.yml")).replace(
    /\r\n/g,
    "\n",
  );
  await Deno.writeTextFile(
    join(repo, "harness-tasks", "v2", "screening.yml"),
    (o.unsealedRound ? lf : lf.replace("harness-v2-screen-w2r1", START))
      .replace(/\n/g, eol),
  );
  await Deno.writeTextFile(join(repo, "harness-tasks", "refapp", "a.al"), "x");
  await sh(repo, "add", "-A");
  await sh(repo, "commit", "-q", "-m", "base");
  await sh(repo, "tag", "-a", "-m", "s", START);
  await sh(repo, "push", "-q", "origin", "master", START);
  const e: SealEntry = {
    ...await startEntry(),
    tag_object: await sh(repo, "rev-parse", `refs/tags/${START}`),
    commit: await sh(repo, "rev-parse", `${START}^{commit}`),
  };
  const seals = [
    "# ledger",
    "v: 2",
    "seals:",
    `  - tag: ${e.tag}`,
    `    tag_object: "${e.tag_object}"`,
    `    commit: "${e.commit}"`,
    `    pushed_at: "${e.pushed_at}"`,
    `    drand_chain: "${e.drand_chain}"`,
    `    drand_round: ${e.drand_round}`,
    `    round_time: "${e.round_time}"`,
    `    randomness: "${e.randomness}"`,
    `    prev: genesis`,
    "",
  ].join(eol);
  await Deno.writeTextFile(
    join(repo, "harness-tasks", "v2", "seals.yml"),
    seals,
  );
  await sh(repo, "add", "-A");
  await sh(repo, "commit", "-q", "-m", "ledger");
  await sh(repo, "tag", "-a", "-m", "l", `${START}-ledger`);
  await sh(repo, "push", "-q", "origin", "master", `${START}-ledger`);
  return { repo, origin, start: e };
}

const SIG = "ab".repeat(48);

/** A fake clock, sleep, drand fetch and status runner. */
async function fakeIo(
  root: string,
  o: {
    now?: number;
    beacon?: (url: string, round: number) => unknown;
    status?: number;
  } = {},
) {
  const randomness = await sha256Hex(decodeHex(SIG));
  const lines: string[] = [];
  const urls: string[] = [];
  const statusRuns: string[][] = [];
  let clock = o.now ?? Date.now();
  const io: SealIo = {
    root,
    now: () => clock,
    sleep: (ms) => {
      clock += ms;
      return Promise.resolve();
    },
    fetchJson: (url) => {
      urls.push(url);
      const round = Number(url.split("/").at(-1));
      return Promise.resolve(
        o.beacon ? o.beacon(url, round) : { round, randomness, signature: SIG },
      );
    },
    status: (args) => {
      statusRuns.push(args);
      return Promise.resolve(o.status ?? 0);
    },
    log: (l) => lines.push(l),
  };
  return { io, lines, urls, statusRuns, randomness, clock: () => clock };
}

const head = (repo: string) => sh(repo, "rev-parse", "HEAD");
const tagsOf = async (repo: string) =>
  (await sh(repo, "tag", "-l")).split("\n").filter(Boolean).sort();

// ---- beacon arithmetic ----

Deno.test("H-72 beaconRound reproduces every entry of the real ledger from its pushed_at", async () => {
  const s = SealsSchema.parse(
    parse(await realFile("harness-tasks/v2/seals.yml")),
  );
  assert(s.seals.length >= 3);
  for (const e of s.seals) {
    assertEquals(beaconRound(Date.parse(e.pushed_at)), {
      round: e.drand_round,
      round_time: e.round_time,
    }, e.tag);
    assertEquals(e.drand_chain, DRAND_CHAIN);
  }
});

Deno.test("H-72 pushedAt is the next whole minute after the tagger date", () => {
  assertEquals(
    pushedAt(Date.parse("2026-11-08T00:41:00Z")),
    "2026-11-08T00:42:00Z",
  );
  assertEquals(
    pushedAt(Date.parse("2026-11-08T00:41:03Z")),
    "2026-11-08T00:42:00Z",
  );
  assertEquals(
    pushedAt(Date.parse("2026-11-08T23:59:59Z")),
    "2026-11-09T00:00:00Z",
  );
});

// ---- prepare ----

for (const eol of ["\n", "\r\n"] as const) {
  Deno.test(`H-72 prepare appends the round entry (${JSON.stringify(eol)}), commits it alone, tags the commit annotated, and pushes nothing`, async () => {
    const { repo, origin } = await sealRepo({ eol });
    const before = await Deno.readTextFile(
      join(repo, "harness-tasks/v2/screening.yml"),
    );
    const f = await fakeIo(repo);
    assertEquals(await prepare(f.io, TAG, "filter"), 0);
    const after = await Deno.readTextFile(
      join(repo, "harness-tasks/v2/screening.yml"),
    );
    assertEquals(
      after,
      before + `      - { seal: ${TAG}, mode: filter }${eol}`,
    );
    const s = ScreeningSchema.parse(parse(after));
    assertEquals(s.amendments[0]!.rounds.at(-1), { seal: TAG, mode: "filter" });
    // One new commit touching only screening.yml; the tag is annotated on it.
    assertEquals(
      await sh(repo, "diff", "--name-only", "HEAD~1", "HEAD"),
      "harness-tasks/v2/screening.yml",
    );
    assertEquals(await sh(repo, "cat-file", "-t", `refs/tags/${TAG}`), "tag");
    assertEquals(
      await sh(repo, "rev-parse", `${TAG}^{commit}`),
      await head(repo),
    );
    assertEquals(await sh(repo, "status", "--porcelain"), "");
    // Nothing pushed.
    assertEquals(await sh(origin, "tag", "-l", TAG), "");
    assertEquals(
      await sh(origin, "rev-parse", "master"),
      await sh(repo, "rev-parse", "HEAD~1"),
    );
    assertStringIncludes(f.lines.join("\n"), `git push origin master ${TAG}`);
  });
}

Deno.test("H-72 prepare without --round tags HEAD and commits nothing, with a WARN", async () => {
  const { repo } = await sealRepo();
  const base = await head(repo);
  const f = await fakeIo(repo);
  assertEquals(await prepare(f.io, TAG), 0);
  assertEquals(await head(repo), base);
  assertEquals(await sh(repo, "rev-parse", `${TAG}^{commit}`), base);
  assertStringIncludes(f.lines.join("\n"), "[WARN]");
});

/** Each case breaks one precondition; prepare refuses with `why` and leaves no commit or tag. */
const refusals: [
  string,
  (r: { repo: string; origin: string }) => Promise<unknown>,
  string,
  string,
  "calibration" | "filter" | undefined,
][] = [
  [
    "dirty harness-tasks",
    ({ repo }) => Deno.writeTextFile(join(repo, "harness-tasks/v2/x.txt"), "x"),
    TAG,
    "harness-tasks is not clean",
    "filter",
  ],
  [
    "refapp differs from the start seal",
    async ({ repo }) => {
      await Deno.writeTextFile(join(repo, "harness-tasks/refapp/a.al"), "y");
      await sh(repo, "commit", "-q", "-am", "refapp");
    },
    TAG,
    `harness-tasks/refapp differs from ${START}`,
    "filter",
  ],
  [
    "tag exists locally",
    ({ repo }) => sh(repo, "tag", "-a", "-m", "x", TAG),
    TAG,
    `tag ${TAG} already exists`,
    "filter",
  ],
  [
    "tag exists on origin only",
    async ({ repo }) => {
      await sh(repo, "tag", "-a", "-m", "x", TAG);
      await sh(repo, "push", "-q", "origin", TAG);
      await sh(repo, "tag", "-d", TAG);
    },
    TAG,
    `tag ${TAG} already exists on origin`,
    "filter",
  ],
  [
    "a calibration round after a filter round (H-69)",
    async (r) => {
      // A sealed, ledgered filter round first.
      const w = "harness-v2-screen-w2r9";
      const f = await fakeIo(r.repo);
      assertEquals(await prepare(f.io, w, "filter"), 0);
      await sh(r.repo, "push", "-q", "origin", "master", w);
      const g = await fakeIo(r.repo, { now: Date.now() });
      assertEquals(await ledger(g.io, w), 0);
    },
    TAG,
    "a calibration round may not follow a filter round",
    "calibration",
  ],
  [
    "a bad tag name",
    () => Promise.resolve(),
    "v2-w2r2",
    "not a seal tag",
    "filter",
  ],
  [
    "a -ledger tag",
    () => Promise.resolve(),
    `${TAG}-ledger`,
    "not a seal tag",
    "filter",
  ],
  ["the start tag", () => Promise.resolve(), START, "already exists", "filter"],
  [
    "an earlier seal without a ledger entry (Sol r1)",
    ({ repo }) => sh(repo, "tag", "-a", "-m", "x", "harness-v2-screen-w2r8"),
    TAG,
    "seal harness-v2-screen-w2r8 has no ledger entry yet",
    "filter",
  ],
  [
    "a filter round whose only calibration round was declared after its seal (sealRound, Sol r1)",
    async ({ repo }) => {
      const p = join(repo, "harness-tasks/v2/screening.yml");
      const t = await Deno.readTextFile(p);
      await Deno.writeTextFile(p, t.replace("harness-v2-screen-w2r1", START));
      await sh(repo, "commit", "-q", "-am", "late round");
    },
    TAG,
    "a filter round needs an earlier calibration round on a sealed seal",
    "filter",
  ],
];

for (const [name, arrange, tag, why, mode] of refusals) {
  Deno.test(`H-72 prepare refuses: ${name}`, async () => {
    // The sealRound case needs a start seal whose own registry has no round.
    const r = await sealRepo({ unsealedRound: name.includes("sealRound") });
    await arrange(r);
    const base = await head(r.repo);
    const tags = await tagsOf(r.repo);
    const f = await fakeIo(r.repo);
    assertEquals(await prepare(f.io, tag, mode), 1);
    assertStringIncludes(f.lines.join("\n"), why);
    assertEquals(await head(r.repo), base);
    assertEquals(await tagsOf(r.repo), tags);
  });
}

// ---- ledger ----

/** prepare, then push the seal tag (the operator's step); the clock starts at the tagger date. */
async function prepared(o: { eol?: "\n" | "\r\n"; push?: boolean } = {}) {
  const r = await sealRepo(o);
  const f0 = await fakeIo(r.repo);
  assertEquals(await prepare(f0.io, TAG, "filter"), 0);
  if (o.push !== false) await sh(r.repo, "push", "-q", "origin", "master", TAG);
  const tagger = Date.parse(
    await sh(
      r.repo,
      "for-each-ref",
      "--format=%(taggerdate:iso-strict)",
      `refs/tags/${TAG}`,
    ),
  );
  return { ...r, tagger };
}

for (const eol of ["\n", "\r\n"] as const) {
  Deno.test(`H-72 ledger (${JSON.stringify(eol)}): waits for the round, cross-checks both endpoints, appends the chained entry, commits, tags -ledger, runs both status checks, pushes nothing`, async () => {
    const r = await prepared({ eol });
    const f = await fakeIo(r.repo, { now: r.tagger + 5_000 });
    const sealsPath = join(r.repo, "harness-tasks/v2/seals.yml");
    const before = await Deno.readTextFile(sealsPath);
    assertEquals(await ledger(f.io, TAG, "R:/results"), 0);

    const pushed = pushedAt(r.tagger);
    const b = beaconRound(Date.parse(pushed));
    const want: SealEntry = {
      tag: TAG,
      tag_object: await sh(r.repo, "rev-parse", `refs/tags/${TAG}`),
      commit: await sh(r.repo, "rev-parse", `${TAG}^{commit}`),
      pushed_at: pushed,
      drand_chain: DRAND_CHAIN,
      drand_round: b.round,
      round_time: b.round_time,
      randomness: f.randomness,
      prev: await entryHash(r.start),
    };
    const after = await Deno.readTextFile(sealsPath);
    assert(after.startsWith(before));
    assert(
      !after.slice(before.length).replace(/\r\n/g, "").includes("\n") ||
        eol === "\n",
    );
    assertEquals(SealsSchema.parse(parse(after)).seals, [r.start, want]);
    // Waited until the round's time before fetching.
    assert(f.clock() >= Date.parse(b.round_time));
    assertEquals(f.urls.sort(), [
      `https://api.drand.sh/${DRAND_CHAIN}/public/${b.round}`,
      `https://api.drand.sh/public/${b.round}`,
    ]);
    // One commit with seals.yml only, tagged <tag>-ledger (annotated).
    assertEquals(
      await sh(r.repo, "diff", "--name-only", "HEAD~1", "HEAD"),
      "harness-tasks/v2/seals.yml",
    );
    assertEquals(
      await sh(r.repo, "rev-parse", `${TAG}-ledger^{commit}`),
      await head(r.repo),
    );
    assertEquals(
      await sh(r.repo, "cat-file", "-t", `refs/tags/${TAG}-ledger`),
      "tag",
    );
    assertEquals(f.statusRuns, [
      [
        "scripts/harness/screening.ts",
        "status",
        "--stratify-env",
        "--results-dir",
        "R:/results",
      ],
      [
        "scripts/harness/prescreen.ts",
        "status",
        "--stratify-env",
        "--results-dir",
        "R:/results",
      ],
    ]);
    assertEquals(await sh(r.origin, "tag", "-l", `${TAG}-ledger`), "");
    const out = f.lines.join("\n");
    assertStringIncludes(out, `git push origin master ${TAG}-ledger`);
    assertStringIncludes(out, `${want.commit}:${want.randomness}`);
    // After the operator's push, screening.ts's own ledger check is clean.
    await sh(r.repo, "push", "-q", "origin", "master", `${TAG}-ledger`);
    const ledgerNow = SealsSchema.parse(parse(after)).seals;
    assertEquals(
      await ledgerProblems(
        ledgerNow,
        await loadLedgerAnchors(r.repo, ledgerNow),
      ),
      [],
    );
  });
}

Deno.test("H-72 ledger (Sol r2): a failing fetch is retried within the run, on the same round", async () => {
  const r = await prepared();
  const round = String(beaconRound(Date.parse(pushedAt(r.tagger))).round);
  let calls = 0;
  const randomness = await sha256Hex(decodeHex(SIG));
  const f = await fakeIo(r.repo, {
    now: r.tagger + 1_000,
    beacon: (_u, n) => {
      if (++calls <= 3) throw new Error("offline");
      return { round: n, randomness, signature: SIG };
    },
  });
  assertEquals(await ledger(f.io, TAG), 0);
  assertEquals(f.urls.length, 5);
  assert(f.urls.every((u) => u.endsWith(`/${round}`)));
  assertEquals(f.lines.filter((l) => l.includes("retry in 30 s")).length, 3);
});

Deno.test("H-72 ledger (Sol r2): a fetch that keeps failing is refused after 10 tries, and a rerun past the round time is refused (nothing persisted)", async () => {
  const r = await prepared();
  const fail = await fakeIo(r.repo, {
    now: r.tagger + 1_000,
    beacon: () => {
      throw new Error("offline");
    },
  });
  const base = await head(r.repo);
  assertEquals(await ledger(fail.io, TAG), 1);
  assertEquals(fail.urls.length, 10);
  assertStringIncludes(fail.lines.join("\n"), "offline (10 tries)");
  assertEquals(await head(r.repo), base);
  const late = await fakeIo(r.repo, { now: fail.clock() });
  assertEquals(await ledger(late.io, TAG), 1);
  assertStringIncludes(late.lines.join("\n"), "after the beacon round");
  assertEquals(late.urls, []);
});

/** Tagging fails: signing is on and the signing program does not exist. */
const breakTagging = async (repo: string) => {
  await sh(repo, "config", "tag.gpgSign", "true");
  await sh(repo, "config", "gpg.program", "cg-no-such-gpg-program");
};

Deno.test("H-72 prepare (Sol r2): a failing tag rolls the round commit back; nothing is left", async () => {
  const { repo } = await sealRepo();
  await breakTagging(repo);
  const base = await head(repo);
  const p = join(repo, "harness-tasks/v2/screening.yml");
  const before = await Deno.readTextFile(p);
  const f = await fakeIo(repo);
  assertEquals(await prepare(f.io, TAG, "filter"), 1);
  assertEquals(await head(repo), base);
  assertEquals(await Deno.readTextFile(p), before);
  assertEquals(await sh(repo, "status", "--porcelain"), "");
  assertEquals(await sh(repo, "tag", "-l", TAG), "");
});

Deno.test("H-72 ledger (Sol r2): a failing -ledger tag rolls the entry commit back; a rerun (now past the round time) is refused", async () => {
  const r = await prepared();
  await breakTagging(r.repo);
  const base = await head(r.repo);
  const p = join(r.repo, "harness-tasks/v2/seals.yml");
  const before = await Deno.readTextFile(p);
  const f = await fakeIo(r.repo, { now: r.tagger });
  assertEquals(await ledger(f.io, TAG), 1);
  assertEquals(await head(r.repo), base);
  assertEquals(await Deno.readTextFile(p), before);
  assertEquals(await sh(r.repo, "status", "--porcelain"), "");
  // Sol r3 LOW: time does not rewind; the retry comes after the beacon.
  await sh(r.repo, "config", "tag.gpgSign", "false");
  const g = await fakeIo(r.repo, { now: f.clock() });
  assertEquals(await ledger(g.io, TAG), 1);
  assertStringIncludes(g.lines.join("\n"), "after the beacon round");
});

Deno.test("H-72 ledger (Sol r4): when another process switches branch while the -ledger tag fails, the original branch is rolled back, the other branch and the working tree are left alone", async () => {
  const r = await prepared();
  const base = await head(r.repo);
  // The "signing program" switches to a new branch at the entry commit, then fails.
  const script = join(r.repo, "..", "switch-then-fail.sh");
  await Deno.writeTextFile(
    script,
    "#!/bin/sh\ngit switch -q -c rescue\nexit 1\n",
  );
  await Deno.chmod(script, 0o755).catch(() => {});
  await sh(r.repo, "config", "tag.gpgSign", "true");
  await sh(r.repo, "config", "gpg.program", script.replaceAll("\\", "/"));
  const f = await fakeIo(r.repo, { now: r.tagger });
  assertEquals(await ledger(f.io, TAG), 1);
  assertStringIncludes(
    f.lines.join("\n"),
    "but HEAD is no longer refs/heads/master",
  );
  assertEquals(await sh(r.repo, "rev-parse", "refs/heads/master"), base);
  const rescue = await sh(r.repo, "rev-parse", "refs/heads/rescue");
  assertEquals(await sh(r.repo, "rev-parse", `${rescue}^`), base);
  assertEquals(await sh(r.repo, "status", "--porcelain"), "");
  assertEquals(await sh(r.repo, "tag", "-l", `${TAG}-ledger`), "");
});

Deno.test("H-72 ledger: a failing status check is exit 1 after the entry and tag are written", async () => {
  const r = await prepared();
  const f = await fakeIo(r.repo, { now: r.tagger, status: 1 });
  assertEquals(await ledger(f.io, TAG), 1);
  assertEquals(
    await sh(r.repo, "cat-file", "-t", `refs/tags/${TAG}-ledger`),
    "tag",
  );
});

const ledgerRefusals: [
  string,
  (r: Awaited<ReturnType<typeof prepared>>) => Promise<unknown>,
  | Parameters<typeof fakeIo>[1]
  | ((tagger: number) => Parameters<typeof fakeIo>[1]),
  string,
][] = [
  [
    "the seal tag is not on origin",
    (r) => sh(r.origin, "tag", "-d", TAG),
    {},
    `tag ${TAG} is not on origin`,
  ],
  [
    "origin's tag object differs",
    async (r) => {
      await sh(r.origin, "tag", "-d", TAG);
      await sh(r.origin, "tag", "-a", "-m", "other", TAG, "master");
    },
    {},
    `differs from origin`,
  ],
  [
    "the endpoints disagree",
    () => Promise.resolve(),
    {
      // Each endpoint self-consistent (randomness = sha256(signature)), but different.
      beacon: async (url: string, round: number) => {
        const signature = url.includes(DRAND_CHAIN) ? SIG : "cd".repeat(48);
        return {
          round,
          randomness: await sha256Hex(decodeHex(signature)),
          signature,
        };
      },
    },
    "drand endpoints disagree",
  ],
  [
    "the randomness is not the signature's hash",
    () => Promise.resolve(),
    {
      beacon: (_u: string, round: number) => ({
        round,
        randomness: "00".repeat(32),
        signature: SIG,
      }),
    },
    "randomness is not sha256(signature)",
  ],
  [
    "an endpoint answers another round",
    () => Promise.resolve(),
    {
      beacon: async (_u: string, round: number) => ({
        round: round + 1,
        randomness: await sha256Hex(decodeHex(SIG)),
        signature: SIG,
      }),
    },
    "answered round",
  ],
  [
    "it runs after the round time (the beacon may predate the push)",
    () => Promise.resolve(),
    (tagger: number) => ({ now: tagger + 3_600_000 }),
    "after the beacon round",
  ],
  [
    "a lightweight seal tag",
    async (r) => {
      const c = await sh(r.repo, "rev-parse", `${TAG}^{commit}`);
      await sh(r.repo, "tag", "-d", TAG);
      await sh(r.repo, "tag", TAG, c);
      await sh(r.repo, "push", "-q", "-f", "origin", TAG);
    },
    {},
    "not an annotated tag",
  ],
  [
    "harness-tasks is not clean",
    (r) => Deno.writeTextFile(join(r.repo, "harness-tasks/v2/x.txt"), "x"),
    {},
    "harness-tasks is not clean",
  ],
  [
    "its -ledger tag already exists (Sol r1: refused before any write)",
    (r) => sh(r.repo, "tag", "-a", "-m", "x", `${TAG}-ledger`),
    {},
    `tag ${TAG}-ledger already exists`,
  ],
];

for (const [name, arrange, opts, why] of ledgerRefusals) {
  Deno.test(`H-72 ledger refuses and writes nothing: ${name}`, async () => {
    const r = await prepared();
    await arrange(r);
    const base = await head(r.repo);
    const tags = await tagsOf(r.repo);
    const sealsPath = join(r.repo, "harness-tasks/v2/seals.yml");
    const before = await Deno.readTextFile(sealsPath);
    const f = await fakeIo(r.repo, {
      now: r.tagger,
      ...(typeof opts === "function" ? opts(r.tagger) : opts),
    });
    assertEquals(await ledger(f.io, TAG), 1);
    assertStringIncludes(f.lines.join("\n"), why);
    assertEquals(await head(r.repo), base);
    assertEquals(await tagsOf(r.repo), tags);
    assertEquals(await Deno.readTextFile(sealsPath), before);
    assertEquals(f.statusRuns, []);
  });
}

Deno.test("H-72 ledger (Sol r1): a seal tagged before an earlier seal was ledgered is refused, before any write", async () => {
  const r = await prepared();
  // B tagged by hand while A (TAG) has no ledger entry: B's commit holds the
  // ledger without A.
  const b = "harness-v2-screen-w2r3";
  await sh(r.repo, "tag", "-a", "-m", "b", b);
  await sh(r.repo, "push", "-q", "origin", b);
  const f = await fakeIo(r.repo, { now: r.tagger });
  assertEquals(await ledger(f.io, TAG), 0);
  const base = await head(r.repo);
  const g = await fakeIo(r.repo, { now: r.tagger });
  assertEquals(await ledger(g.io, b), 1);
  assertStringIncludes(
    g.lines.join("\n"),
    `the ledger committed at ${b} differs from HEAD's`,
  );
  assertEquals(await head(r.repo), base);
  assertEquals(g.urls, []);
});

Deno.test("H-72 ledger refuses a seal already in the ledger", async () => {
  const r = await prepared();
  const f = await fakeIo(r.repo, { now: r.tagger });
  assertEquals(await ledger(f.io, TAG), 0);
  const g = await fakeIo(r.repo, { now: r.tagger });
  assertEquals(await ledger(g.io, TAG), 1);
  assertStringIncludes(g.lines.join("\n"), "already in the ledger");
});
