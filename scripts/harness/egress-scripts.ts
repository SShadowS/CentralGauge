/**
 * Generate the elevated firewall scripts ops run in M1-34 (M1-33). This
 * script writes files; it never runs PowerShell or changes the host. The
 * apply only reads the Docker context once (`docker context ls`, the same
 * resolution verify uses, H-119): the apply's `docker network inspect` runs
 * under that context, or the machine's when none resolves.
 * CENTRALGAUGE_DOCKER_CONTEXT=<name> pins one, and set empty pins none.
 * The context is fixed when the script is generated: regenerate after the
 * machine's Docker context changes (a later $env:DOCKER_CONTEXT is ignored).
 * Usage:
 *   deno run --allow-all scripts/harness/egress-scripts.ts apply --invocation <id> --dir <dir> --interface-index <n> --interface-alias <alias> --hns-id <id> --out <apply.ps1> [--keep-inbound] [--acknowledge-blocks <fw-block-inventory.json>]
 *   deno run --allow-all scripts/harness/egress-scripts.ts revert --dir <dir> --out <revert.ps1> [--restore-profiles]
 * Without --keep-inbound the apply sets every profile's inbound default to
 * Allow (the inbound-Allow host). On a host whose inbound default is Block
 * (the Windows default) pass --keep-inbound (H-90, GH #33): the default stays
 * Block and the apply adds scoped allows for 3128 and 3210 on the gateway; it
 * refuses before any change unless the effective state is such a host.
 * An apply refuses before any change when block rules outside
 * cg-harness-egress are effective, and writes them to
 * fw-block-inventory-<invocation>.json. After the owner decides they may stay,
 * pass that file (trimmed by the owner to the accepted rules) as
 * --acknowledge-blocks (H-119): the apply then runs only while every effective
 * foreign block rule is acknowledged with the same identity (an acknowledged
 * rule that is gone is clean) and records them in its apply record, which
 * `harness egress verify --apply-record` reads. A missing or malformed file
 * refuses.
 * The revert removes only the cg-harness-egress rules and archives the
 * records; it never changes the firewall profiles unless --restore-profiles
 * is given, and then refuses if the profiles changed since the apply (C-04).
 * The interface index and alias are the adapter that owns 172.30.60.1
 * (`harness egress verify` prints problems naming it). The same inputs always
 * give the same script. Files are written with a UTF-8 BOM (Windows
 * PowerShell 5.1 reads BOM-less files as ANSI).
 */

import { parseArgs } from "@std/cli/parse-args";
import { resolveDockerContext } from "../../src/container/docker-context.ts";
import {
  type AcknowledgedBlock,
  applyScript,
  firewallPlan,
  parseAcknowledgedBlocks,
  revertScript,
} from "../../src/harness/egress.ts";

/** Generate one script from the arguments and write it; throws on any problem, writing nothing. */
export async function main(argv: string[]): Promise<void> {
  // A mistyped flag (say --keep-inbond) must refuse, never yield the inbound-Allow apply.
  const unknown: string[] = [];
  const a = parseArgs(argv, {
    unknown: (arg) => {
      if (!arg.startsWith("-")) return true;
      unknown.push(arg);
      return false;
    },
    string: [
      "invocation",
      "dir",
      "interface-index",
      "interface-alias",
      "hns-id",
      "out",
      "acknowledge-blocks",
    ],
    boolean: ["restore-profiles", "keep-inbound"],
  });
  const [verb] = a._;
  if (unknown.length > 0) throw new Error(`unknown option ${unknown[0]}`);
  if (!a.dir || !a.out) throw new Error("--dir and --out are required");
  const ackPath = a["acknowledge-blocks"];
  if (ackPath !== undefined && verb !== "apply") {
    throw new Error("--acknowledge-blocks belongs to apply");
  }
  let text: string;
  if (verb === "apply") {
    const index = Number(a["interface-index"]);
    if (!a.invocation || !a["interface-alias"] || !a["hns-id"]) {
      throw new Error(
        "apply needs --invocation, --interface-alias and --hns-id",
      );
    }
    let acknowledgedBlocks: AcknowledgedBlock[] | undefined;
    if (ackPath !== undefined) {
      let ack: string;
      try {
        ack = await Deno.readTextFile(ackPath);
      } catch (err) {
        throw new Error(
          `cannot read --acknowledge-blocks ${ackPath}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
      acknowledgedBlocks = parseAcknowledgedBlocks(
        ack,
        `--acknowledge-blocks ${ackPath}`,
      );
    }
    text = applyScript(firewallPlan(index), {
      invocation: a.invocation,
      dir: a.dir,
      interfaceAlias: a["interface-alias"],
      hnsId: a["hns-id"],
      keepInbound: a["keep-inbound"],
      dockerContext: resolveDockerContext().context,
      acknowledgedBlocks,
    });
  } else if (verb === "revert") {
    text = revertScript(a.dir, { restoreProfiles: a["restore-profiles"] });
  } else {
    throw new Error(`unknown verb ${verb ?? "(none)"}: apply or revert`);
  }
  await Deno.writeTextFile(a.out, "﻿" + text, { createNew: true });
  console.log(`[OK] wrote ${a.out}`);
}

if (import.meta.main) {
  try {
    await main(Deno.args);
  } catch (err) {
    console.error(`[FAIL] ${err instanceof Error ? err.message : err}`);
    Deno.exit(1);
  }
}
