/**
 * H-38 (design 4, 8.1 reader, 8.2 provenance): the OnPrem index is read from
 * the locked symbol packages, plain or ReadyToRun-wrapped, and any lock
 * mismatch or unsupported shape fails closed with an OnPremIndexError.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { lockDigestOf } from "../../../src/harness/bc-lane.ts";
import {
  loadOnPremIndex,
  OnPremIndexError,
} from "../../../src/harness/onprem-symbols.ts";
import { testPolicyViolations } from "../../../src/harness/verdict-workspace.ts";
import {
  BASE_APP_ID,
  BASE_SLICE,
  BASE_VERSION,
  baseSlicePackage,
  navx,
  onPremStore,
  r2rPackage,
  symbolJson,
} from "./onprem-fixture.ts";

const SYSTEM = {
  app_id: "8874ed3a-0643-4247-9ced-7a7002f7135d",
  name: "System",
  version: "28.0.53667.0",
};

const member = (
  i: Awaited<ReturnType<typeof loadOnPremIndex>>,
  kind: string,
  name: string,
) => i.objects.get(kind)?.get(name);

for (const r2r of [false, true]) {
  Deno.test(`H-38 (8.1): a ${r2r ? "ReadyToRun-wrapped" : "plain"} package with a BOM is read; members, events, ids, SourceTable and dataitems are indexed; the digest is the lock's`, async () => {
    const lock = await onPremStore([baseSlicePackage(r2r), SYSTEM]);
    const i = await loadOnPremIndex(lock);
    assertEquals(i.lockDigest, await lockDigestOf(lock));
    const ism = member(i, "codeunit", "isolated storage management")!;
    assertEquals([...ism.ids], [1293]);
    assert(ism.members.has("get") && ism.members.has("contains"));
    const rs = member(i, "table", "report selections")!;
    assert(rs.members.has("gethtmlreportforcust"));
    // Q7: an overload-mixed name is banned when any overload is OnPrem.
    assert(rs.members.has("getpdfreportforcust"));
    const gjl = member(i, "table", "gen. journal line")!;
    assert(gjl.events.has("oncheckgenjournallinepostrestrictions"));
    assert(!gjl.events.has("onaftersetupnewline"));
    assertEquals(i.byId.get("table:77"), "report selections");
    assertEquals([
      ...member(i, "page", "report selection - sales")!.sourceTables,
    ], ["77"]);
    assertEquals([
      ...member(i, "report", "suggest bank acc. recon. lines")!.dataItems,
    ], ["Bank Account"]);
    assert(
      i.names.has("get") &&
        i.names.has("oncheckgenjournallinepostrestrictions"),
    );
  });
}

Deno.test("H-38 (8.1): a table extension's OnPrem method folds into its target table (module prefix stripped)", async () => {
  const lock = await onPremStore([baseSlicePackage(), {
    ...SYSTEM,
    json: {
      AppId: SYSTEM.app_id,
      Name: SYSTEM.name,
      Publisher: "Microsoft",
      Version: SYSTEM.version,
      TableExtensions: [{
        Id: 5,
        Name: "Ext",
        TargetObject: "#437dbf0e84ff417a965ded2bb9650972#Customer",
        Methods: [{
          Name: "ExtOnPrem",
          Attributes: [{ Name: "Scope", Arguments: [{ Value: "Onprem" }] }],
        }],
      }],
    },
  }]);
  const i = await loadOnPremIndex(lock);
  assert(member(i, "table", "customer")!.members.has("extonprem"));
});

Deno.test("H-38 (8.4 finding): an XmlPort's OnPrem method (the real lock's TestRunner-Internal has two) is indexed, and a call through an XmlPort variable is onprem_ref", async () => {
  const onPrem = [{ Name: "Scope", Arguments: [{ Value: "OnPrem" }] }];
  const lock = await onPremStore([baseSlicePackage(), {
    ...SYSTEM,
    json: {
      AppId: SYSTEM.app_id,
      Name: SYSTEM.name,
      Publisher: "Microsoft",
      Version: SYSTEM.version,
      XmlPorts: [{
        Id: 130400,
        Name: "CAL Test Results",
        Methods: [{ Name: "SetCheckinID", Attributes: onPrem }],
      }],
    },
  }]);
  const i = await loadOnPremIndex(lock);
  assert(member(i, "xmlport", "cal test results")!.members.has("setcheckinid"));
  const file =
    `codeunit 80160 "Agent T"\n{\n    procedure P()\n    var\n        XP: XmlPort "CAL Test Results";\n    begin\n        XP.SetCheckinID(1);\n    end;\n}\n`;
  const vs = testPolicyViolations([["src/A.al", file]], i);
  assert(
    vs.some((v) => v.includes("XP.SetCheckinID (xmlport 130400 SetCheckinID)")),
    vs.join("; "),
  );
});

/** Each case: [what, the store's packages, the error substring]. */
Deno.test("H-38 (8.2): a missing store file, a changed byte, an identity mismatch, a missing SymbolReference, an ambiguous inner app and an unsupported OnPrem kind each throw OnPremIndexError", async () => {
  const fails = async (
    what: string,
    lock: Parameters<typeof loadOnPremIndex>[0],
    text: string,
  ) => {
    const err = await assertRejects(
      () => loadOnPremIndex(lock),
      OnPremIndexError,
      undefined,
      what,
    );
    assert(err.message.includes(text), `${what}: ${err.message}`);
  };
  const ok = await onPremStore([baseSlicePackage()]);
  await Deno.remove(join(ok.store, `${ok.packages[0]!.sha256}.app`));
  await fails("missing file", ok, "missing");

  const changed = await onPremStore([baseSlicePackage()]);
  const path = join(changed.store, `${changed.packages[0]!.sha256}.app`);
  const bytes = await Deno.readFile(path);
  bytes[bytes.length - 30] = bytes[bytes.length - 30]! ^ 1;
  await Deno.writeFile(path, bytes);
  await fails("one byte changed", changed, "sha256");

  for (
    const [field, value] of [
      ["AppId", "00000000-0000-0000-0000-000000000000"],
      ["Name", "Base App"],
      ["Publisher", "Contoso"],
      ["Version", "28.4.0.0"],
    ] as const
  ) {
    await fails(
      `${field} differs`,
      await onPremStore([{
        ...baseSlicePackage(),
        json: { ...BASE_SLICE, [field]: value },
      }]),
      field,
    );
  }

  const enc = new TextEncoder();
  const manifest = ["NavxManifest.xml", enc.encode("<Package/>")] as const;
  await fails(
    "no SymbolReference",
    await onPremStore([{
      ...baseSlicePackage(),
      bytes: await navx([manifest]),
    }]),
    "SymbolReference.json",
  );
  const inner = await r2rPackage(BASE_APP_ID, BASE_VERSION, BASE_SLICE);
  const innerName = `${
    BASE_APP_ID.replaceAll("-", "")
  }_${BASE_VERSION}_28_1.app`;
  await fails(
    "two inner candidates",
    await onPremStore([{
      ...baseSlicePackage(),
      bytes: await navx([[innerName, inner], [
        innerName.replace("_1.app", "_2.app"),
        inner,
      ]]),
    }]),
    "inner",
  );
  await fails(
    "zero inner candidates",
    await onPremStore([{
      ...baseSlicePackage(),
      bytes: await navx([["other_28.app", inner]]),
    }]),
    "inner",
  );
  await fails(
    "root SymbolReference plus an inner app",
    await onPremStore([{
      ...baseSlicePackage(),
      bytes: await navx([["SymbolReference.json", symbolJson(BASE_SLICE)], [
        innerName,
        inner,
      ]]),
    }]),
    "both",
  );
  await fails(
    "not NAVX",
    await onPremStore([{
      ...baseSlicePackage(),
      bytes: enc.encode("assert-symbols"),
    }]),
    "NAVX",
  );
  const onPrem = [{ Name: "Scope", Arguments: [{ Value: "OnPrem" }] }];
  for (
    const [what, extra] of [
      ["a PageExtension method", {
        PageExtensions: [{
          Id: 1,
          Name: "PX",
          TargetObject: "Customer Card",
          Methods: [{ Name: "M", Attributes: onPrem }],
        }],
      }],
      ["a Query method", {
        Queries: [{
          Id: 1,
          Name: "Q",
          Methods: [{ Name: "M", Attributes: onPrem }],
        }],
      }],
      ["an object-level attribute", {
        Codeunits: [{ Id: 9, Name: "C", Attributes: onPrem }],
      }],
    ] as const
  ) {
    await fails(
      what,
      await onPremStore([{
        ...baseSlicePackage(),
        json: { ...BASE_SLICE, ...extra },
      }]),
      "unsupported OnPrem-bearing symbol kind",
    );
  }
});

Deno.test("H-38 (4.7): an index whose Base Application has no OnPrem member fails the sanity check", async () => {
  const lock = await onPremStore([{
    ...baseSlicePackage(),
    json: {
      AppId: BASE_APP_ID,
      Name: "Base Application",
      Publisher: "Microsoft",
      Version: BASE_VERSION,
    },
  }]);
  await assertRejects(
    () => loadOnPremIndex(lock),
    OnPremIndexError,
    "Base Application",
  );
});
