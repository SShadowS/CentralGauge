/**
 * H-38 (design 4): the OnPrem index, read from the locked Microsoft symbol
 * packages (SymbolReference.json). L3 bans calls by name to the members and
 * event subscriptions it lists (verdict-workspace onPremRefs, rule
 * `onprem_ref`). Every package of the lock is read, hashed as read, its
 * identity checked against the lock; anything unexpected is an
 * OnPremIndexError, so a run never judges with a partial index (Q1, Q4).
 */

import { join } from "@std/path";
import { navxEntries, navxEntryBytes } from "../container/app-package.ts";
import { ValidationError } from "../errors.ts";
import { lockDigestOf, type LockedSymbols } from "./bc-lane.ts";
import { sha256Hex } from "./hash.ts";

/** Any failure to build the index (fail closed: the run refuses to start). */
export class OnPremIndexError extends ValidationError {
  constructor(message: string) {
    super(`onprem index: ${message}`, [message]);
    this.name = "OnPremIndexError";
  }
}

/** One indexed object name (a union over namespaces and packages). */
export interface OnPremObject {
  ids: Set<number>;
  /** Lowercase method names with any OnPrem overload (Q7). */
  members: Set<string>;
  /** Lowercase OnPrem event publisher names. */
  events: Set<string>;
  /** A page's SourceTable values as recorded (an id or a name). */
  sourceTables: Set<string>;
  /** A report's dataitem tables (names as recorded), nested ones included. */
  dataItems: Set<string>;
}

export interface OnPremIndex {
  /** lockDigestOf(the lock this index was read from). */
  lockDigest: string;
  /** kind (table, codeunit, page, report, xmlport) -> lowercase unquoted name -> object. */
  objects: Map<string, Map<string, OnPremObject>>;
  /** "kind:id" -> lowercase name. */
  byId: Map<string, string>;
  /** Every OnPrem member and event name, lowercase (the Q2 fallback). */
  names: Set<string>;
  /** Every OnPrem event name, lowercase (the Q2 fallback for a subscriber). */
  events: Set<string>;
  /**
   * Self-check H4: every locked interface name, lowercase unquoted; a
   * workspace interface of the same name is ambiguous unless qualified.
   */
  interfaces: Set<string>;
}

const BASE_APP = "437dbf0e-84ff-417a-965d-ed2bb9650972";
/** Symbol array -> indexed kind. TableExtensions fold into their target table. */
const KINDS: Record<string, string> = {
  Tables: "table",
  Codeunits: "codeunit",
  Pages: "page",
  Reports: "report",
  // Gate 8.4 finding: the real lock's TestRunner-Internal has OnPrem XmlPort methods.
  XmlPorts: "xmlport",
  TableExtensions: "table",
};
/** Where a Scope attribute may say OnPrem: a method of an indexed kind, at any namespace depth. */
const SUPPORTED =
  /^(?:Namespaces\/)*(?:Tables|Codeunits|Pages|Reports|XmlPorts|TableExtensions)\/Methods\/Attributes$/;

type Json = Record<string, unknown>;
const arr = (v: unknown): Json[] =>
  Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : [];
const str = (v: unknown) => typeof v === "string" ? v : "";
/** A symbol name without its `#<module id>#` prefix, lowercase. */
export const symbolName = (n: string) =>
  n.replace(/^#[0-9a-f]*#/i, "").toLowerCase();

const isOnPremScope = (a: Json) =>
  str(a["Name"]).toLowerCase() === "scope" &&
  /^onprem$/i.test(str(arr(a["Arguments"])[0]?.["Value"]));

/** Every OnPrem Scope attribute outside a supported position, as a path. */
function unsupported(v: unknown, path: string[], out: string[]): void {
  if (Array.isArray(v)) {
    for (const x of v) unsupported(x, path, out);
    return;
  }
  if (!v || typeof v !== "object") return;
  const o = v as Json;
  for (const [k, x] of Object.entries(o)) {
    if (!Array.isArray(x)) {
      if (x && typeof x === "object") unsupported(x, path, out);
      continue;
    }
    const p = [...path, k];
    if (k === "Attributes" && arr(x).some(isOnPremScope)) {
      if (!SUPPORTED.test(p.join("/"))) {
        out.push(`${p.join("/")} (${str(o["Name"])})`);
      }
    }
    unsupported(x, p, out);
  }
}

/**
 * The index of parsed SymbolReference documents (design 4.6). Throws an
 * OnPremIndexError for an OnPrem Scope anywhere but a method of a table,
 * codeunit, page, report, xmlport or table extension.
 */
export function buildOnPremIndex(
  lockDigest: string,
  docs: readonly unknown[],
): OnPremIndex {
  const index: OnPremIndex = {
    lockDigest,
    objects: new Map(),
    byId: new Map(),
    names: new Set(),
    events: new Set(),
    interfaces: new Set(),
  };
  for (const d of docs) addDoc(index, d);
  return index;
}

/** Index one document; the number of OnPrem methods it holds. */
function addDoc(index: OnPremIndex, d: unknown): number {
  let count = 0;
  const entry = (kind: string, name: string) => {
    const byName = index.objects.get(kind) ??
      index.objects.set(kind, new Map()).get(kind)!;
    return byName.get(name) ?? byName.set(name, {
      ids: new Set(),
      members: new Set(),
      events: new Set(),
      sourceTables: new Set(),
      dataItems: new Set(),
    }).get(name)!;
  };
  const dataItems = (items: Json[], into: Set<string>) => {
    for (const d of items) {
      if (str(d["RelatedTable"])) into.add(str(d["RelatedTable"]));
      dataItems(arr(d["DataItems"]), into);
    }
  };
  const walk = (ns: Json) => {
    for (const [array, kind] of Object.entries(KINDS)) {
      for (const o of arr(ns[array])) {
        const ext = array === "TableExtensions";
        const name = symbolName(str(ext ? o["TargetObject"] : o["Name"]));
        if (!name) continue;
        const e = entry(kind, name);
        if (!ext && typeof o["Id"] === "number") {
          e.ids.add(o["Id"]);
          index.byId.set(`${kind}:${o["Id"]}`, name);
        }
        for (const p of arr(o["Properties"])) {
          if (str(p["Name"]) === "SourceTable" && str(p["Value"])) {
            e.sourceTables.add(str(p["Value"]));
          }
        }
        dataItems(arr(o["DataItems"]), e.dataItems);
        for (const m of arr(o["Methods"])) {
          const attrs = arr(m["Attributes"]);
          if (!attrs.some(isOnPremScope)) continue;
          const n = str(m["Name"]).toLowerCase();
          count++;
          e.members.add(n);
          index.names.add(n);
          if (attrs.some((a) => /Event$/i.test(str(a["Name"])))) {
            e.events.add(n);
            index.events.add(n);
          }
        }
      }
    }
    for (const i of arr(ns["Interfaces"])) {
      const n = symbolName(str(i["Name"]));
      if (n) index.interfaces.add(n);
    }
    for (const n of arr(ns["Namespaces"])) walk(n);
  };
  const bad: string[] = [];
  unsupported(d, [], bad);
  if (bad.length > 0) {
    throw new OnPremIndexError(
      `unsupported OnPrem-bearing symbol kind: ${bad.slice(0, 5).join(", ")}`,
    );
  }
  walk(d as Json);
  return count;
}

/** The SymbolReference.json bytes of one package (design 4.2, 4.3). */
async function symbolReference(
  bytes: Uint8Array,
  appId: string,
  version: string,
): Promise<Uint8Array> {
  const nav = navxEntries(bytes);
  if (!nav) {
    throw new Error("not a NAVX package (or its zip directory is truncated)");
  }
  const read = async (
    zip: Uint8Array,
    e: { name: string } & Parameters<typeof navxEntryBytes>[1],
  ) => {
    const b = await navxEntryBytes(zip, e);
    if (!b) {
      throw new Error(
        `entry ${e.name} is truncated or of an unsupported method`,
      );
    }
    return b;
  };
  const root = nav.entries.filter((e) => !e.name.includes("/"));
  const ref = root.find((e) => e.name === "SymbolReference.json");
  const apps = root.filter((e) => e.name.toLowerCase().endsWith(".app"));
  if (ref && apps.length === 0) return await read(nav.zip, ref);
  if (ref) {
    throw new Error("both a root SymbolReference.json and an inner .app");
  }
  const prefix = `${appId.replaceAll("-", "").toLowerCase()}_${version}_`;
  const inner = apps.filter((e) => e.name.toLowerCase().startsWith(prefix));
  if (inner.length !== 1) {
    throw new Error(
      `expected one inner ${prefix}*.app, found ${inner.length} (root .app entries: ${
        apps.map((e) => e.name).join(", ") || "none"
      })`,
    );
  }
  const nested = navxEntries(await read(nav.zip, inner[0]!));
  if (!nested) throw new Error(`inner ${inner[0]!.name} is not a NAVX package`);
  const sr = nested.entries.find((e) => e.name === "SymbolReference.json");
  if (!sr) {
    throw new Error(`inner ${inner[0]!.name} has no SymbolReference.json`);
  }
  return await read(nested.zip, sr);
}

/**
 * Read every locked package from the store, in lock order (design 4): hash
 * the bytes read, parse those bytes, check the identity, index. Base
 * Application must contribute at least one OnPrem member.
 */
export async function loadOnPremIndex(
  lock: LockedSymbols,
): Promise<OnPremIndex> {
  // Indexed as read: one parsed document in memory at a time.
  const index = buildOnPremIndex(await lockDigestOf(lock), []);
  let baseMembers = -1;
  for (const p of lock.packages) {
    const where = `${p.name} ${p.version} (${p.sha256.slice(0, 12)})`;
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = await Deno.readFile(join(lock.store, `${p.sha256}.app`));
    } catch (err) {
      throw new OnPremIndexError(
        `${where}: store file missing or unreadable: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
    const actual = await sha256Hex(bytes);
    if (actual !== p.sha256.toLowerCase()) {
      throw new OnPremIndexError(
        `${where}: sha256 of the store file is ${actual}`,
      );
    }
    let doc: Json;
    try {
      const raw = await symbolReference(bytes, p.app_id, p.version);
      // ignoreBOM keeps it in the text: exactly one leading U+FEFF is stripped here.
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
        .decode(raw);
      doc = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    } catch (err) {
      throw new OnPremIndexError(
        `${where}: SymbolReference.json: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
    const id = [
      ["AppId", str(doc["AppId"]).toLowerCase(), p.app_id.toLowerCase()],
      ["Name", str(doc["Name"]), p.name],
      ["Publisher", str(doc["Publisher"]), p.publisher],
      ["Version", str(doc["Version"]), p.version],
    ].find(([, got, want]) => got !== want);
    if (id) {
      throw new OnPremIndexError(
        `${where}: ${id[0]} is ${id[1]}, the lock says ${id[2]}`,
      );
    }
    const n = addDoc(index, doc);
    if (p.app_id.toLowerCase() === BASE_APP) baseMembers = n;
  }
  if (baseMembers < 1) {
    throw new OnPremIndexError(
      baseMembers < 0
        ? "the lock has no Base Application"
        : "Base Application has no OnPrem member (sanity check)",
    );
  }
  return index;
}
