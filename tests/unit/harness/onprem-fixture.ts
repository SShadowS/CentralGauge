/**
 * H-38: symbol package fixtures for the OnPrem index. A NAVX package is a
 * 40-byte header ("NAVX", the zip offset) followed by a zip; entries are
 * stored or deflated (no CRC: the reader never checks one). The Base App
 * slice copies the real entries' JSON (codeunit 1293 Get/Contains, table 77,
 * table 81 events, pages 21 and 306, report 1496) from Base Application
 * 28.4.53241.53758 (lock sha256 86ddeb07...227e).
 */

import { fromFileUrl, join } from "@std/path";
import type { LockedSymbols } from "../../../src/harness/bc-lane.ts";
import type { SymbolPackage } from "../../../src/harness/identity.ts";
import { lockDigestOf } from "../../../src/harness/bc-lane.ts";
import { sha256Hex } from "../../../src/harness/hash.ts";
import {
  buildOnPremIndex,
  type OnPremIndex,
} from "../../../src/harness/onprem-symbols.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

export const BASE_APP_ID = "437dbf0e-84ff-417a-965d-ed2bb9650972";
export const BASE_VERSION = "28.4.53241.53758";

export const BASE_SLICE: Record<string, unknown> = JSON.parse(
  await Deno.readTextFile(
    fromFileUrl(
      new URL(
        "../../fixtures/harness/onprem/base-app-slice.json",
        import.meta.url,
      ),
    ),
  ),
);

async function deflate(b: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([b.slice()]).stream().pipeThrough(
    new CompressionStream("deflate-raw"),
  );
  return new Uint8Array(await new Response(s).arrayBuffer());
}

const le = (n: number, bytes: number) => {
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) out[i] = (n >>> (8 * i)) & 0xff;
  return out;
};
const cat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** A NAVX package of these entries (deflated unless `stored`). */
export async function navx(
  entries: readonly (readonly [string, Uint8Array])[],
  o: { stored?: boolean } = {},
): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let off = 0;
  for (const [name, raw] of entries) {
    const n = enc.encode(name);
    const method = o.stored ? 0 : 8;
    const data = o.stored ? raw : await deflate(raw);
    const local = cat([
      le(0x04034b50, 4),
      le(20, 2),
      le(0, 2),
      le(method, 2),
      le(0, 4),
      le(0, 4),
      le(data.length, 4),
      le(raw.length, 4),
      le(n.length, 2),
      le(0, 2),
      n,
      data,
    ]);
    central.push(cat([
      le(0x02014b50, 4),
      le(20, 2),
      le(20, 2),
      le(0, 2),
      le(method, 2),
      le(0, 4),
      le(0, 4),
      le(data.length, 4),
      le(raw.length, 4),
      le(n.length, 2),
      le(0, 2),
      le(0, 2),
      le(0, 2),
      le(0, 2),
      le(0, 4),
      le(off, 4),
      n,
    ]));
    locals.push(local);
    off += local.length;
  }
  const cd = cat(central);
  const eocd = cat([
    le(0x06054b50, 4),
    le(0, 4),
    le(entries.length, 2),
    le(entries.length, 2),
    le(cd.length, 4),
    le(off, 4),
    le(0, 2),
  ]);
  const header = new Uint8Array(40);
  header.set(enc.encode("NAVX"), 0);
  header.set(le(40, 4), 4);
  return cat([header, ...locals, cd, eocd]);
}

/** SymbolReference.json bytes as Microsoft ships them: UTF-8 with a BOM. */
export const symbolJson = (j: unknown) =>
  new TextEncoder().encode("﻿" + JSON.stringify(j));

export interface FixturePackage {
  app_id: string;
  name: string;
  publisher?: string;
  version: string;
  /** The package bytes; default: a plain package of `json`. */
  bytes?: Uint8Array;
  json?: unknown;
  /** ReadyToRun: the SymbolReference sits in one inner `<id>_<version>_*.app`. */
  r2r?: boolean;
}

/** The ReadyToRun wrapper shape around one inner package. */
export async function r2rPackage(
  appId: string,
  version: string,
  json: unknown,
): Promise<Uint8Array> {
  const inner = await navx([
    ["NavxManifest.xml", new TextEncoder().encode("<Package/>")],
    ["SymbolReference.json", symbolJson(json)],
  ]);
  return await navx([
    ["readytorunappmanifest.json", new TextEncoder().encode("{}")],
    [
      `${appId.replaceAll("-", "").toLowerCase()}_${version}_28_28014.app`,
      inner,
    ],
    ["publishedartifacts/x.dll", new Uint8Array([1, 2, 3])],
  ]);
}

/** A symbol store and its lock (packages in the given order). */
export async function onPremStore(
  pkgs: readonly FixturePackage[],
): Promise<LockedSymbols> {
  const store = await Deno.realPath(
    await testTempDir({ prefix: "cg-onprem-" }),
  );
  const packages: SymbolPackage[] = [];
  for (const p of pkgs) {
    const json = p.json ??
      {
        AppId: p.app_id,
        Name: p.name,
        Publisher: p.publisher ?? "Microsoft",
        Version: p.version,
      };
    const bytes = p.bytes ??
      (p.r2r ? await r2rPackage(p.app_id, p.version, json) : await navx([
        ["NavxManifest.xml", new TextEncoder().encode("<Package/>")],
        ["SymbolReference.json", symbolJson(json)],
      ]));
    const sha256 = await sha256Hex(bytes.slice());
    await Deno.writeFile(join(store, `${sha256}.app`), bytes);
    packages.push({
      app_id: p.app_id,
      name: p.name,
      publisher: p.publisher ?? "Microsoft",
      version: p.version,
      file: `Microsoft_${p.name}_${p.version}.app`,
      sha256,
    });
  }
  return { store, packages };
}

/** The Base App slice as one locked package. */
export const baseSlicePackage = (r2r = false): FixturePackage => ({
  app_id: BASE_APP_ID,
  name: "Base Application",
  version: BASE_VERSION,
  json: BASE_SLICE,
  r2r,
});

/** An index with no OnPrem member, for scans that do not judge. */
export const NO_ONPREM: OnPremIndex = buildOnPremIndex("none", []);

/** An index with no OnPrem member whose digest matches `lock` (judge preflight passes). */
export async function noOnPrem(lock: LockedSymbols): Promise<OnPremIndex> {
  return buildOnPremIndex(await lockDigestOf(lock), []);
}
