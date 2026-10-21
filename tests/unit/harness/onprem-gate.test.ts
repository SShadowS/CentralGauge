/**
 * H-38 8.4 gate (orchestrator approval after WIP bad45f54): each oracle is
 * scanned over its compile context, pristine + correct/, so an interface the
 * solution declares resolves; one declared nowhere still falls back.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { loadOnPremIndex } from "../../../src/harness/onprem-symbols.ts";
import {
  oracleContext,
  oracleHits,
} from "../../../scripts/harness/onprem-gate-lib.ts";
import { baseSlicePackage, onPremStore } from "./onprem-fixture.ts";
import { appJson, IDS, write } from "./refapp-fixture.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

const INDEX = await loadOnPremIndex(
  await onPremStore([baseSlicePackage(), {
    app_id: "8874ed3a-0643-4247-9ced-7a7002f7135d",
    name: "System",
    version: "28.0.53667.0",
    json: {
      AppId: "8874ed3a-0643-4247-9ced-7a7002f7135d",
      Name: "System",
      Publisher: "Microsoft",
      Version: "28.0.53667.0",
      Codeunits: [{
        Id: 9,
        Name: "Fallback Names",
        Methods: [{
          Name: "Send",
          Attributes: [{ Name: "Scope", Arguments: [{ Value: "OnPrem" }] }],
        }],
      }],
    },
  }]),
);

const IFACE =
  'interface "CGR Outbox Transport"\n{\n    procedure Send(Payload: Text): Boolean;\n}\n';
const ORACLE =
  'codeunit 85000 "HX Oracle"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure T()\n    var\n        Transport: Interface "CGR Outbox Transport";\n    begin\n        if Transport.Send(\'x\') then;\n    end;\n}\n';

/** A pristine workspace and a task with oracle/ and, optionally, the interface in correct/. */
async function fixture(correctDeclares: boolean) {
  const pristine = await Deno.realPath(await testTempDir());
  await write(
    pristine,
    "Core/app.json",
    appJson(IDS.core, "CGR Core", [70000, 70099], []),
  );
  await write(
    pristine,
    "Core/src/Core.al",
    'codeunit 70000 "CGR Core"\n{\n}\n',
  );
  const task = await Deno.realPath(await testTempDir());
  await write(
    task,
    "correct/Core/src/Core.al",
    'codeunit 70000 "CGR Core"\n{\n    procedure Fixed()\n    begin\n    end;\n}\n',
  );
  if (correctDeclares) {
    await write(task, "correct/Core/src/Transport.Interface.al", IFACE);
  }
  await write(task, "oracle/src/Oracle.Test.al", ORACLE);
  const out = join(await Deno.realPath(await testTempDir()), "ctx");
  return { pristine, task, out };
}

Deno.test("H-38 8.4 gate: the oracle's context is pristine + correct/, so an interface the solution declares resolves", async () => {
  const f = await fixture(true);
  const ctx = await oracleContext(f.task, f.pristine, f.out);
  assertEquals(
    await Deno.readTextFile(join(ctx, "Core", "src", "Transport.Interface.al")),
    IFACE,
  );
  assertEquals(
    await Deno.readTextFile(join(ctx, "Core", "src", "Core.al")),
    await Deno.readTextFile(join(f.task, "correct", "Core", "src", "Core.al")),
  );
  assertEquals(await oracleHits(join(f.task, "oracle"), ctx, INDEX), []);
});

Deno.test("H-38 8.4 gate: an oracle using an interface declared in neither pristine nor correct/ still falls back", async () => {
  const f = await fixture(false);
  const ctx = await oracleContext(f.task, f.pristine, f.out);
  const hits = await oracleHits(join(f.task, "oracle"), ctx, INDEX);
  assertEquals(hits.length, 1, hits.join("; "));
  assert(
    hits[0]!.includes("Transport.Send (unresolved, OnPrem name Send)"),
    hits[0],
  );
});
