import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertGreater } from "@std/assert";
import { expandGlob } from "@std/fs";
import { fromFileUrl } from "@std/path";
import { Parser } from "web-tree-sitter";

import { parseAlObjects } from "../../../src/al/object-parser.ts";

/**
 * Temporarily replaces `Parser.prototype.parse` so a test can force the
 * two failure modes `parseAlObjects` guards against (a throw, or a `null`
 * tree — the latter is how a real `parse()` reports an aborted parse, e.g.
 * a `progressCallback` timeout). Always restored, even if the body throws.
 */
async function withPatchedParse(
  patched: typeof Parser.prototype.parse,
  body: () => Promise<void>,
): Promise<void> {
  const original = Parser.prototype.parse;
  Parser.prototype.parse = patched;
  try {
    await body();
  } finally {
    Parser.prototype.parse = original;
  }
}

const CODEUNIT =
  'codeunit 71410 "CG X054 Agent"\n{\n    procedure P() begin end;\n}';
const ENUMOBJ = 'enum 71411 "CG X054 Kind"\n{\n    value(0; Standard) { }\n}';
const IFACE =
  'interface "CG Payment Processor"\n{\n    procedure Pay(): Boolean;\n}';
const TABLEEXT =
  'tableextension 71412 "CG Ext" extends "CG X054 Quote"\n{\n    fields { }\n}';

describe("al/object-parser", () => {
  it("splits two concatenated objects", async () => {
    const p = await parseAlObjects(`${CODEUNIT}\n\n${ENUMOBJ}`);
    assertEquals(p.hasError, false);
    assertEquals(p.objects.length, 2);
    assertEquals(p.objects[0]?.kind, "codeunit");
    assertEquals(p.objects[0]?.id, 71410);
    assertEquals(p.objects[0]?.name, "CG X054 Agent");
    assertEquals(p.objects[1]?.kind, "enum");
    assertEquals(p.objects[1]?.id, 71411);
  });

  it("returns each object's own source text", async () => {
    const p = await parseAlObjects(`${CODEUNIT}\n\n${ENUMOBJ}`);
    assertEquals(p.objects[0]?.source.startsWith("codeunit 71410"), true);
    assertEquals(p.objects[0]?.source.includes("enum 71411"), false);
  });

  it("handles an interface, which has no id", async () => {
    const p = await parseAlObjects(IFACE);
    assertEquals(p.objects.length, 1);
    assertEquals(p.objects[0]?.kind, "interface");
    assertEquals(p.objects[0]?.id, undefined);
    assertEquals(p.objects[0]?.name, "CG Payment Processor");
  });

  it("records the extends target of a tableextension", async () => {
    const p = await parseAlObjects(TABLEEXT);
    assertEquals(p.objects[0]?.kind, "tableextension");
    assertEquals(p.objects[0]?.extendsTarget, "CG X054 Quote");
  });

  it("flags prose as unparseable and returns no objects", async () => {
    const p = await parseAlObjects("I'm sorry, I can't help with that.");
    assertEquals(p.hasError, true);
    assertEquals(p.objects.length, 0);
  });

  it("returns no objects for empty input without throwing", async () => {
    const p = await parseAlObjects("");
    assertEquals(p.objects.length, 0);
  });

  it("treats a thrown parse() as unparseable instead of propagating", async () => {
    await withPatchedParse(
      () => {
        throw new Error("simulated parser crash");
      },
      async () => {
        const p = await parseAlObjects('codeunit 1 "X"\n{\n}');
        assertEquals(p, { objects: [], hasError: true });
      },
    );
  });

  it("treats a null tree (e.g. an aborted parse) as unparseable", async () => {
    await withPatchedParse(
      () => null,
      async () => {
        const p = await parseAlObjects('codeunit 1 "X"\n{\n}');
        assertEquals(p, { objects: [], hasError: true });
      },
    );
  });

  it("parses every committed tests/al/hard/*.al file with at least one named object", async () => {
    const hardDir = fromFileUrl(
      new URL("../../../tests/al/hard/", import.meta.url),
    );
    let fileCount = 0;
    const failures: string[] = [];

    for await (const entry of expandGlob("*.al", { root: hardDir })) {
      if (!entry.isFile) continue;
      fileCount++;
      const source = await Deno.readTextFile(entry.path);
      const p = await parseAlObjects(source);
      if (
        p.hasError || p.objects.length === 0 ||
        p.objects.some((o) => o.name === "")
      ) {
        failures.push(entry.name);
      }
    }

    assertEquals(failures, []);
    assertGreater(fileCount, 0);
  });
});
