/**
 * H-72: a screening seal in two steps, each ending with the push command it
 * does not run (pushing stays a separate, explicit step).
 *
 *   seal.ts prepare <tag> [--round calibration|filter]
 *   seal.ts ledger <tag> [--results-dir DIR]
 *
 * prepare: preconditions (clean harness-tasks, refapp unchanged since the
 * start seal, tag free locally and on origin, the round valid under the H-69
 * rules), commits the round entry to screening.yml, tags it annotated.
 * ledger: after the push, the drand round fixed by the tagger date (pushed_at
 * = the next whole minute, beacon at least 10 minutes later), refused when the
 * tag reached origin only after that round; waits for it, cross-checks both
 * drand endpoints, appends the chained seals.yml entry, commits, tags
 * <tag>-ledger, runs screening.ts status and prescreen.ts status --stratify-env.
 * Worked example: H:\Temp3\harness-spike\M8\seal-w2r1\seal.md.
 */

import { decodeHex } from "jsr:@std/encoding@^1.0.5/hex";
import { parseArgs } from "@std/cli/parse-args";
import * as colors from "@std/fmt/colors";
import { join } from "@std/path";
import { parse } from "@std/yaml";
import { z } from "zod";
import { sha256Hex } from "../../src/harness/hash.ts";
import {
  entryHash,
  REGISTRY_PATH,
  ScreeningSchema,
  type SealEntry,
  SEALS_PATH,
  SealsSchema,
  START_TAG,
} from "./screening.ts";

/** League of Entropy mainnet (the chain of every ledger entry so far). */
export const DRAND_CHAIN =
  "8990e7a9aaed2ffed73dbd7092123d6f289930540d7651336225dc172e51b2ce";
const DRAND_GENESIS = 1595431050;
const DRAND_PERIOD = 30;
const DELAY_S = 600;
const DRAND_URLS = (round: number) => [
  `https://api.drand.sh/public/${round}`,
  `https://api.drand.sh/${DRAND_CHAIN}/public/${round}`,
];

export type Mode = "calibration" | "filter";

export interface SealIo {
  root: string;
  fetchJson: (url: string) => Promise<unknown>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** `deno run --allow-all <args>` in root; the exit code. */
  status: (args: string[]) => Promise<number>;
  log: (line: string) => void;
}

const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

/** The next whole minute after `ms` (the tagger date). */
export const pushedAt = (ms: number): string =>
  iso((Math.floor(ms / 60_000) + 1) * 60_000);

/** The first drand round at least 10 minutes after `pushedMs` (seal plan S3). */
export function beaconRound(
  pushedMs: number,
): { round: number; round_time: string } {
  const round =
    Math.ceil((pushedMs / 1000 + DELAY_S - DRAND_GENESIS) / DRAND_PERIOD) + 1;
  return {
    round,
    round_time: iso((DRAND_GENESIS + (round - 1) * DRAND_PERIOD) * 1000),
  };
}

const SEAL_TAG = /^harness-v2-screen-[a-z0-9-]+$/;
const Beacon = z.object({
  round: z.number().int(),
  randomness: z.string().regex(/^[0-9a-f]{64}$/),
  signature: z.string().regex(/^(?:[0-9a-f]{2})+$/),
});

class Refusal extends Error {}
const refuse = (msg: string): never => {
  throw new Refusal(msg);
};

async function git(root: string, args: string[]): Promise<string> {
  const out = await new Deno.Command("git", {
    args,
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) {
    refuse(
      `git ${args.join(" ")}: ${new TextDecoder().decode(out.stderr).trim()}`,
    );
  }
  return new TextDecoder().decode(out.stdout).trim();
}

const tryGit = (root: string, args: string[]) =>
  git(root, args).catch((e) => e instanceof Refusal ? null : Promise.reject(e));

async function cleanTasks(root: string) {
  if (await git(root, ["status", "--porcelain", "--", "harness-tasks"])) {
    refuse("harness-tasks is not clean");
  }
}

async function originTag(root: string, tag: string): Promise<string | null> {
  const out = await git(root, [
    "ls-remote",
    "--tags",
    "origin",
    `refs/tags/${tag}`,
  ]);
  const m = out.split("\n").map((l) => l.trim().split("\t"))
    .find(([, ref]) => ref === `refs/tags/${tag}`);
  return m ? m[0]! : null;
}

const branchOf = (root: string) =>
  git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);

const eolOf = (text: string) => text.includes("\r\n") ? "\r\n" : "\n";

/**
 * screening.yml with `{ seal, mode }` appended to the prescreen rounds, as
 * text (comments and line endings kept); refused unless it parses to exactly
 * the old registry plus that round, valid under ScreeningSchema (H-69).
 */
function withRound(text: string, tag: string, mode: Mode): string {
  const raw = parse(text) as {
    amendments?: { id: string; rounds: unknown[] }[];
  };
  const a = raw.amendments?.find((x) => x.id === "prescreen");
  if (!a) refuse(`${REGISTRY_PATH} has no prescreen amendment`);
  if (a!.rounds.some((r) => (r as { seal: string }).seal === tag)) {
    refuse(`${tag} already exists in ${REGISTRY_PATH} rounds`);
  }
  const want = structuredClone(raw);
  want.amendments!.find((x) => x.id === "prescreen")!.rounds.push({
    seal: tag,
    mode,
  });
  const v = ScreeningSchema.safeParse(want);
  if (!v.success) refuse(v.error.issues.map((i) => i.message).join("; "));

  const eol = eolOf(text);
  const lines = text.split(eol);
  const indent = (l: string) => l.match(/^ */)![0].length;
  const at = lines.findIndex((l) => /^\s*- id: prescreen\s*$/.test(l));
  const r = lines.findIndex((l, i) => i > at && /^\s*rounds:\s*$/.test(l));
  if (r < 0) refuse(`${REGISTRY_PATH}: prescreen rounds is not a block list`);
  let end = r;
  while (
    end + 1 < lines.length && /^\s*- /.test(lines[end + 1]!) &&
    indent(lines[end + 1]!) > indent(lines[r]!)
  ) end++;
  const pad = " ".repeat(
    end > r ? indent(lines[end]!) : indent(lines[r]!) + 2,
  );
  lines.splice(end + 1, 0, `${pad}- { seal: ${tag}, mode: ${mode} }`);
  const out = lines.join(eol);
  if (JSON.stringify(parse(out)) !== JSON.stringify(want)) {
    refuse(`could not append the round to ${REGISTRY_PATH}; edit it by hand`);
  }
  return out;
}

async function guarded(io: SealIo, body: () => Promise<number>) {
  try {
    return await body();
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    io.log(colors.red(`[FAIL] ${e.message}`));
    return 1;
  }
}

/** Round entry commit and annotated seal tag; nothing pushed. */
export function prepare(io: SealIo, tag: string, mode?: Mode): Promise<number> {
  return guarded(io, async () => {
    const { root } = io;
    if (!SEAL_TAG.test(tag) || tag.endsWith("-ledger")) {
      refuse(`${tag} is not a seal tag (${SEAL_TAG.source}, no -ledger)`);
    }
    await cleanTasks(root);
    const refapp = await git(root, [
      "diff",
      "--name-only",
      START_TAG,
      "HEAD",
      "--",
      "harness-tasks/refapp",
    ]);
    if (refapp) refuse(`harness-tasks/refapp differs from ${START_TAG}`);
    if (
      await tryGit(root, [
        "rev-parse",
        "--verify",
        "--quiet",
        `refs/tags/${tag}`,
      ]) !== null
    ) {
      refuse(`tag ${tag} already exists`);
    }
    if (await originTag(root, tag) !== null) {
      refuse(`tag ${tag} already exists on origin`);
    }
    const path = join(root, REGISTRY_PATH);
    if (mode) {
      await Deno.writeTextFile(
        path,
        withRound(await Deno.readTextFile(path), tag, mode),
      );
      await git(root, ["add", "--", REGISTRY_PATH]);
      await git(root, [
        "commit",
        "-q",
        "-m",
        `chore(harness-tasks): ${tag} pre-screen round (${mode})`,
        "--",
        REGISTRY_PATH,
      ]);
    } else {
      io.log(colors.yellow(
        `[WARN] no --round: ${tag} has no pre-screen round; its candidates can never be pre-screened`,
      ));
    }
    await git(root, ["tag", "-a", "-m", `${tag} seal`, tag, "HEAD"]);
    const commit = await git(root, ["rev-parse", `${tag}^{commit}`]);
    io.log(`[OK] ${tag} -> ${commit}`);
    io.log(`push: git push origin ${await branchOf(root)} ${tag}`);
    io.log(`then: seal.ts ledger ${tag}`);
    return 0;
  });
}

/** The ledger entry, its commit and the <tag>-ledger tag after the push; nothing pushed. */
export function ledger(
  io: SealIo,
  tag: string,
  resultsDir?: string,
): Promise<number> {
  return guarded(io, async () => {
    const { root } = io;
    if (!SEAL_TAG.test(tag) || tag.endsWith("-ledger")) {
      refuse(`${tag} is not a seal tag`);
    }
    await cleanTasks(root);
    const path = join(root, SEALS_PATH);
    const text = await Deno.readTextFile(path);
    const seals = SealsSchema.parse(parse(text)).seals;
    if (seals.some((e) => e.tag === tag)) {
      refuse(`${tag} is already in the ledger`);
    }

    const obj = await tryGit(root, [
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/tags/${tag}`,
    ]);
    if (obj === null) refuse(`no local tag ${tag}`);
    if (await git(root, ["cat-file", "-t", obj!]) !== "tag") {
      refuse(`${tag} is not an annotated tag`);
    }
    const remote = await originTag(root, tag);
    if (remote === null) {
      refuse(
        `tag ${tag} is not on origin (push it first: git push origin ${await branchOf(
          root,
        )} ${tag})`,
      );
    }
    if (remote !== obj) {
      refuse(`local tag object ${obj} differs from origin ${remote}`);
    }
    const seen = io.now();
    const tagger = Date.parse(
      await git(root, [
        "for-each-ref",
        "--format=%(taggerdate:iso-strict)",
        `refs/tags/${tag}`,
      ]),
    );
    const pushed_at = pushedAt(tagger);
    const { round, round_time } = beaconRound(Date.parse(pushed_at));
    if (seen >= Date.parse(round_time)) {
      refuse(
        `${tag} was first seen on origin at ${
          iso(seen)
        }, after the beacon round ${round} (${round_time}): the beacon may predate the push`,
      );
    }
    io.log(`[WAIT] drand round ${round} at ${round_time}`);
    while (io.now() < Date.parse(round_time) + 1000) {
      await io.sleep(Date.parse(round_time) + 1000 - io.now());
    }
    const beacons = [];
    for (const url of DRAND_URLS(round)) {
      let b;
      try {
        b = Beacon.parse(await io.fetchJson(url));
      } catch (e) {
        refuse(`${url}: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (b!.round !== round) refuse(`${url} answered round ${b!.round}`);
      if (await sha256Hex(decodeHex(b!.signature)) !== b!.randomness) {
        refuse(`${url}: randomness is not sha256(signature)`);
      }
      beacons.push(b!);
    }
    if (beacons[0]!.randomness !== beacons[1]!.randomness) {
      refuse("drand endpoints disagree");
    }
    const entry: SealEntry = {
      tag,
      tag_object: obj!,
      commit: await git(root, ["rev-parse", `${tag}^{commit}`]),
      pushed_at,
      drand_chain: DRAND_CHAIN,
      drand_round: round,
      round_time,
      randomness: beacons[0]!.randomness,
      prev: await entryHash(seals.at(-1)!),
    };
    const want = SealsSchema.parse({ v: 2, seals: [...seals, entry] }).seals;
    const eol = eolOf(text);
    const out = (text.endsWith(eol) ? text : text + eol) + [
      `  - tag: ${tag}`,
      `    tag_object: "${entry.tag_object}"`,
      `    commit: "${entry.commit}"`,
      `    pushed_at: "${pushed_at}"`,
      `    drand_chain: "${DRAND_CHAIN}"`,
      `    drand_round: ${round}`,
      `    round_time: "${round_time}"`,
      `    randomness: "${entry.randomness}"`,
      `    prev: "${entry.prev}"`,
      "",
    ].join(eol);
    if (
      JSON.stringify(SealsSchema.parse(parse(out)).seals) !==
        JSON.stringify(want)
    ) refuse(`could not append to ${SEALS_PATH}`);
    await Deno.writeTextFile(path, out);
    await git(root, ["add", "--", SEALS_PATH]);
    await git(root, [
      "commit",
      "-q",
      "-m",
      `chore(harness-tasks): ${tag} seal ledger entry`,
      "--",
      SEALS_PATH,
    ]);
    await git(root, [
      "tag",
      "-a",
      "-m",
      `${tag} ledger`,
      `${tag}-ledger`,
      "HEAD",
    ]);
    io.log(`[OK] ${tag}-ledger -> ${await git(root, ["rev-parse", "HEAD"])}`);

    const rd = resultsDir ? ["--results-dir", resultsDir] : [];
    const codes = [
      await io.status(["scripts/harness/screening.ts", "status", ...rd]),
      await io.status([
        "scripts/harness/prescreen.ts",
        "status",
        "--stratify-env",
        ...rd,
      ]),
    ];
    if (codes.some((c) => c !== 0)) {
      io.log(colors.red(
        `[FAIL] status checks exited ${
          codes.join(", ")
        }; the entry and ${tag}-ledger are committed locally, not pushed`,
      ));
    }
    io.log(`seed: ${entry.commit}:${entry.randomness}`);
    io.log(`campaigns may be created only after ${round_time}`);
    io.log(`push: git push origin ${await branchOf(root)} ${tag}-ledger`);
    return codes.some((c) => c !== 0) ? 1 : 0;
  });
}

if (import.meta.main) {
  const a = parseArgs(Deno.args, { string: ["round", "results-dir"] });
  const [cmd, tag] = a._.map(String);
  const mode = a.round;
  const io: SealIo = {
    root: Deno.cwd(),
    fetchJson: async (url) => {
      const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    status: async (args) =>
      (await new Deno.Command(Deno.execPath(), {
        args: ["run", "--allow-all", ...args],
        cwd: Deno.cwd(),
        stdout: "inherit",
        stderr: "inherit",
      }).output()).code,
    log: (l) => console.log(l),
  };
  let code = 1;
  if (
    cmd === "prepare" && tag &&
    (mode === undefined || mode === "calibration" || mode === "filter")
  ) {
    code = await prepare(io, tag, mode);
  } else if (cmd === "ledger" && tag) {
    code = await ledger(io, tag, a["results-dir"]);
  } else {
    console.error(
      "usage: seal.ts prepare <tag> [--round calibration|filter] | ledger <tag> [--results-dir DIR]",
    );
  }
  Deno.exit(code);
}
