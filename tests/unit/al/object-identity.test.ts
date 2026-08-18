import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

import type { AlObject } from "../../../src/al/object-parser.ts";
import {
  assignObjectsToRows,
  buildRowUniverse,
  normalizeName,
  objectKey,
} from "../../../src/al/object-identity.ts";

function obj(p: Partial<AlObject> & { name: string; kind: string }): AlObject {
  return {
    kind: p.kind,
    name: p.name,
    startIndex: 0,
    endIndex: 0,
    source: "",
    ...(p.id !== undefined ? { id: p.id } : {}),
    ...(p.extendsTarget !== undefined
      ? { extendsTarget: p.extendsTarget }
      : {}),
  };
}

describe("al/object-identity", () => {
  it("normalizes quotes, case and internal whitespace", () => {
    assertEquals(normalizeName('"CG  X054   Agent"'), "cg x054 agent");
    assertEquals(normalizeName("CG X054 Agent"), "cg x054 agent");
  });

  it("keys by id when present", () => {
    const a = obj({ kind: "codeunit", id: 71410, name: "Agent" });
    const b = obj({ kind: "codeunit", id: 71410, name: "Different" });
    assertEquals(objectKey(a), objectKey(b));
  });

  it("keys by name when there is no id", () => {
    const a = obj({ kind: "interface", name: "CG Payment Processor" });
    const b = obj({ kind: "interface", name: '"CG Payment Processor"' });
    assertEquals(objectKey(a), objectKey(b));
  });

  it("separates objects of different kinds sharing an id", () => {
    const a = obj({ kind: "codeunit", id: 71410, name: "X" });
    const b = obj({ kind: "table", id: 71410, name: "X" });
    assertEquals(objectKey(a) === objectKey(b), false);
  });

  it("includes the extends target in the key", () => {
    const a = obj({
      kind: "tableextension",
      id: 1,
      name: "E",
      extendsTarget: "A",
    });
    const b = obj({
      kind: "tableextension",
      id: 1,
      name: "E",
      extendsTarget: "B",
    });
    assertEquals(objectKey(a) === objectKey(b), false);
  });

  it("unions reference objects with every response's extras", () => {
    const ref = [obj({ kind: "codeunit", id: 71410, name: "Agent" })];
    const rows = buildRowUniverse(ref, [
      {
        model: "m1",
        objects: [obj({ kind: "codeunit", id: 71410, name: "Agent" })],
      },
      {
        model: "m2",
        objects: [
          obj({ kind: "codeunit", id: 71410, name: "Agent" }),
          obj({ kind: "enum", id: 71411, name: "Kind" }),
        ],
      },
    ]);
    assertEquals(rows.length, 2);
  });

  it("marks a row from correct/ as inReference even after a response matches it", () => {
    const ref = [obj({ kind: "codeunit", id: 71410, name: "Agent" })];
    const rows = buildRowUniverse(ref, [
      {
        model: "m1",
        objects: [obj({ kind: "codeunit", id: 71410, name: "Agent" })],
      },
    ]);
    assertEquals(rows.length, 1);
    assertEquals(rows[0]?.inReference, true);
  });

  it("marks a row first introduced by a response as not inReference", () => {
    const ref = [obj({ kind: "codeunit", id: 71410, name: "Agent" })];
    const rows = buildRowUniverse(ref, [
      {
        model: "m1",
        objects: [
          obj({ kind: "codeunit", id: 71410, name: "Agent" }),
          obj({ kind: "enum", id: 71411, name: "Kind" }),
        ],
      },
    ]);
    const refRow = rows.find((r) => r.key === "codeunit|71410");
    const extraRow = rows.find((r) => r.key === "enum|71411");
    assertEquals(refRow?.inReference, true);
    assertEquals(extraRow?.inReference, false);
  });

  it("merges two responses' same-named objects with different ids into one row", () => {
    const rows = buildRowUniverse([], [
      {
        model: "m1",
        objects: [obj({ kind: "codeunit", id: 71410, name: "Agent" })],
      },
      {
        model: "m2",
        objects: [obj({ kind: "codeunit", id: 71400, name: "Agent" })],
      },
    ]);
    assertEquals(rows.length, 1);
    assertEquals(rows[0]?.name, "Agent");
    assertEquals(rows[0]?.id, 71410);
  });

  it("keeps extensions of different targets in separate rows", () => {
    const rows = buildRowUniverse([], [
      {
        model: "m1",
        objects: [obj({
          kind: "tableextension",
          id: 71400,
          name: "CG Ext",
          extendsTarget: "Customer",
        })],
      },
      {
        model: "m2",
        objects: [obj({
          kind: "tableextension",
          id: 71401,
          name: "CG Ext",
          extendsTarget: "Vendor",
        })],
      },
    ]);
    assertEquals(rows.length, 2);
  });
});

describe("al/object-identity assignObjectsToRows", () => {
  // Cell placement used to be re-derived in src/dashboard/ui/app.js from a
  // hand-copied normalizeName/objectKey, with nothing able to notice when the
  // copy drifted from this module. It is computed here instead.
  const rows = buildRowUniverse(
    [
      obj({ kind: "codeunit", id: 71410, name: "CG Poster" }),
      obj({ kind: "table", id: 71411, name: "CG Line" }),
    ],
    [],
  );

  it("places an object on the row its exact key names", () => {
    const assignments = assignObjectsToRows(rows, [
      obj({ kind: "table", id: 71411, name: "CG Line" }),
      obj({ kind: "codeunit", id: 71410, name: "CG Poster" }),
    ]);
    assertEquals(assignments["codeunit|71410"], 1);
    assertEquals(assignments["table|71411"], 0);
  });

  it("falls back to the name when the id does not line up", () => {
    // Writing the right object under the wrong id is a classic model error;
    // splitting it into a missing row plus an extra row would misread it.
    const assignments = assignObjectsToRows(rows, [
      obj({ kind: "codeunit", id: 99999, name: '"CG   poster"' }),
    ]);
    assertEquals(assignments["codeunit|71410"], 0);
  });

  it("prefers an exact key match over a name-only one, whatever the order", () => {
    const assignments = assignObjectsToRows(rows, [
      obj({ kind: "codeunit", id: 99999, name: "CG Poster" }),
      obj({ kind: "codeunit", id: 71410, name: "Something Else" }),
    ]);
    assertEquals(assignments["codeunit|71410"], 1);
  });

  it("omits a row no object fills", () => {
    const assignments = assignObjectsToRows(rows, [
      obj({ kind: "codeunit", id: 71410, name: "CG Poster" }),
    ]);
    assertEquals("table|71411" in assignments, false);
  });

  it("returns an empty map for a response with no objects", () => {
    assertEquals(assignObjectsToRows(rows, []), {});
  });
});
