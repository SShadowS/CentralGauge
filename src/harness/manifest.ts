/**
 * Resolved execution manifest (spec 1a section 4) and `vary` enforcement
 * (section 6, D15). The manifest hash is the config identity; each
 * component has its own hash so a report can show exactly what differs.
 *
 * Two levels: the campaign stores an arm TEMPLATE (config limits); each
 * execution stores the template with task-effective limits (`forTask`), so a
 * stricter task limit never changes arm identity.
 *
 * Runtime facts (native settings as written into the container, image and
 * base image digests, backend version, MCP/LSP versions and tool-schema
 * hashes, provider route per model slot) are inputs; Part 2 collects them.
 */

import { join } from "@std/path";
import { z } from "zod";
import { ConfigurationError, ValidationError } from "../errors.ts";
import type { HarnessConfig, VaryKey } from "./config.ts";
import { effectiveLimits, ImageRevisionSchema, LATEST } from "./config.ts";
import { HASH_RULES_VERSION, hashFile, hashJson, listTree } from "./hash.ts";
import { Sha256Hex } from "./identity.ts";
import type { HarnessTask } from "./task.ts";

const PathComponent = z.strictObject({
  path: z.string(),
  hash: Sha256Hex,
  /** Per-file snapshot, so a diff can name the file (durable content ref). */
  files: z.array(z.strictObject({ path: z.string(), sha256: Sha256Hex })),
});
const Server = z.strictObject({
  name: z.string(),
  version: z.string().min(1),
  tool_schema_hash: z.string().min(1),
});
/** M10-10: an al-lsp-for-agents release tag; the image label and install-lsp.ps1 use the same. */
export const LSP_TAG = /^v\d+\.\d+\.\d+$/;
/** `<asset>.zip sha256:<64 hex>`, as labelled on the image. */
export const LSP_ASSET_LABEL =
  /^[A-Za-z0-9][A-Za-z0-9._-]*\.zip sha256:[0-9a-f]{64}$/;
export const LSP_MODES: readonly string[] = ["embedded", "symbols"];
/** The LSP wrapper release an image was built from (M10-10): all three or none. */
const LspReleaseShape = {
  release: z.string().regex(LSP_TAG),
  asset: z.string().regex(LSP_ASSET_LABEL),
  dependency_source: z.string().refine((s) => LSP_MODES.includes(s)),
};
/** An LSP entry: an image built since M10-10 adds the release; older ones have none. */
const LspServer = z.union([Server.extend(LspReleaseShape), Server]);

/** H-03: a strict semver release (no prerelease, no build metadata). */
export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
/** An npm dist.integrity: sha512, base64 of 64 bytes. */
export const SRI_SHA512 = /^sha512-[A-Za-z0-9+/]{86}==$/;
/** The Claude Code package a tracked image installed (H-03): absent on untracked images. */
export const ClaudePackageSchema = z.strictObject({
  name: z.literal("@anthropic-ai/claude-code"),
  version: z.string().regex(SEMVER),
  track: z.literal("npm-latest"),
  integrity: z.strictObject({
    main: z.string().regex(SRI_SHA512),
    win32_x64: z.string().regex(SRI_SHA512),
  }),
});
export type ClaudePackage = z.output<typeof ClaudePackageSchema>;

export const ResolvedManifestSchema = z.strictObject({
  v: z.literal(1),
  rules: z.string(),
  config_id: z.string(),
  harness: z.string(),
  harness_version: z.string(),
  models: z.record(z.string(), z.string()),
  settings: z.strictObject({
    requested: z.record(z.string(), z.unknown()),
    /** Native harness settings exactly as written into the container. */
    native: z.record(z.string(), z.unknown()),
  }),
  limits: z.strictObject({
    timeout_min: z.number().int().positive(),
    max_budget_usd: z.number().positive(),
  }),
  instructions: PathComponent.nullable(),
  skills: PathComponent.nullable(),
  agents: PathComponent.nullable(),
  hooks: PathComponent.nullable(),
  plugins: z.array(PathComponent),
  mcp: z.array(Server),
  lsp: z.array(LspServer),
  toolchain: z.array(z.string()),
  image: z.strictObject({
    digest: z.string().min(1),
    base_digest: z.string().min(1),
    /**
     * The image's revision label (H-01 run 004). Absent for a frozen image
     * (never null), so manifests resolved before it keep their hashes.
     */
    revision: ImageRevisionSchema.optional(),
    /**
     * What the image has installed, whether or not the arm enables it (M10-10):
     * the LSP release on images with the release labels. Absent otherwise, so
     * older manifests keep their hashes.
     */
    installed: z.strictObject({
      lsp: z.record(z.string(), z.strictObject(LspReleaseShape)),
    }).optional(),
    /**
     * H-03: the Claude Code package a tracked image resolved and installed.
     * Absent otherwise (never null), so older manifests keep their hashes.
     */
    package: ClaudePackageSchema.optional(),
  }),
  backend_version: z.string().min(1),
  /** Provider route per model slot; every slot in `models` has one. */
  provider_routes: z.record(z.string(), z.string().min(1)),
}).refine(
  (m) => {
    const slots = Object.keys(m.models);
    const routes = new Set(Object.keys(m.provider_routes));
    return slots.length === routes.size && slots.every((s) => routes.has(s));
  },
  { message: "provider_routes must cover exactly the model slots" },
).refine(
  (m) => !m.image.package || m.image.package.version === m.harness_version,
  {
    message: "image.package.version must equal harness_version",
    path: ["image", "package"],
  },
);
export type ResolvedManifest = z.output<typeof ResolvedManifestSchema>;

export interface InstalledLsp {
  release: string;
  asset: string;
  dependency_source: string;
}

export interface RuntimeFacts {
  /** H-03: the image's resolved harness version; required when the config says LATEST. */
  harness_version?: string;
  native_settings: Record<string, unknown>;
  image: {
    digest: string;
    base_digest: string;
    revision?: string;
    installed?: { lsp: Record<string, InstalledLsp> };
    package?: ClaudePackage;
  };
  backend_version: string;
  servers: Record<
    string,
    {
      version: string;
      tool_schema_hash: string;
      release?: string;
      asset?: string;
      dependency_source?: string;
    }
  >;
  provider_routes: Record<string, string>;
}

async function pathComponent(harnessRoot: string, rel: string) {
  // hashFile / listTree refuse links only from the path they are given down;
  // a directory component also needs every step from the harness root.
  let abs = harnessRoot;
  let info: Deno.FileInfo | undefined;
  for (const seg of ["", ...rel.split(/[\\/]/).filter((x) => x !== "")]) {
    if (seg === "..") {
      throw new ValidationError(
        `refusing component path outside ${harnessRoot}: ${rel}`,
        [rel],
      );
    }
    abs = join(abs, seg);
    info = await Deno.lstat(abs);
    if (info.isSymlink) {
      throw new ValidationError(`refusing link or reparse point: ${abs}`, [
        abs,
      ]);
    }
  }
  if (info!.isDirectory) {
    // One listing for both, so the hash always matches the file snapshot.
    const files = await listTree(abs, "bundle");
    return {
      path: rel,
      hash: await hashJson({ domain: "bundle", tree: files }),
      files,
    };
  }
  const sha256 = await hashFile(harnessRoot, abs);
  const files = [{ path: rel.split("/").pop()!, sha256 }];
  return { path: rel, hash: await hashJson({ file: sha256 }), files };
}

function servers(names: string[], facts: RuntimeFacts, kind: string) {
  return [...names].sort().map((name) => {
    const f = facts.servers[name];
    if (!f) {
      throw new ConfigurationError(
        `${kind} component ${name} has no runtime facts (version, tool schema)`,
      );
    }
    return { name, ...f };
  });
}

/** Resolve a config plus runtime facts into an arm template. */
export async function resolveManifest(
  harnessRoot: string,
  config: HarnessConfig,
  facts: RuntimeFacts,
): Promise<ResolvedManifest> {
  const missingRoutes = Object.keys(config.models).filter((slot) =>
    !facts.provider_routes[slot]
  );
  if (missingRoutes.length > 0) {
    throw new ConfigurationError(
      `${config.id}: no provider route for model slot(s) ${
        missingRoutes.join(", ")
      }`,
    );
  }
  // H-03: a manifest records the version that runs, never the word "latest".
  const harness_version = facts.harness_version ?? config.harness_version;
  if (harness_version === LATEST) {
    throw new ConfigurationError(
      `${config.id}: harness_version ${LATEST} has no resolved version in the runtime facts`,
    );
  }
  const c = config.components;
  const opt = (p: string | null) =>
    p === null ? Promise.resolve(null) : pathComponent(harnessRoot, p);
  const plugins = [];
  for (const p of [...c.plugins].sort()) {
    plugins.push(await pathComponent(harnessRoot, p));
  }
  return ResolvedManifestSchema.parse({
    v: 1,
    rules: HASH_RULES_VERSION,
    config_id: config.id,
    harness: config.harness,
    harness_version,
    models: config.models,
    settings: { requested: config.settings, native: facts.native_settings },
    limits: config.limits,
    instructions: await opt(c.instructions),
    skills: await opt(c.skills),
    agents: await opt(c.agents),
    hooks: await opt(c.hooks),
    plugins,
    mcp: servers(c.mcp, facts, "mcp"),
    lsp: servers(c.lsp, facts, "lsp"),
    toolchain: [...c.toolchain].sort(),
    image: facts.image,
    backend_version: facts.backend_version,
    provider_routes: Object.fromEntries(
      Object.keys(config.models).map((s) => [s, facts.provider_routes[s]!]),
    ),
  });
}

/** The execution manifest: the arm template with task-effective limits. */
export function forTask(
  template: ResolvedManifest,
  taskLimits: HarnessTask["limits"],
): ResolvedManifest {
  return { ...template, limits: effectiveLimits(template.limits, taskLimits) };
}

/** Manifest keys that get their own component hash. */
export const MANIFEST_KEYS = [
  "harness",
  "harness_version",
  "models",
  "settings",
  "limits",
  "instructions",
  "skills",
  "agents",
  "hooks",
  "plugins",
  "mcp",
  "lsp",
  "toolchain",
  "image",
  "backend_version",
  "provider_routes",
] as const;
export type ManifestKey = (typeof MANIFEST_KEYS)[number];

export async function componentHashes(
  m: ResolvedManifest,
): Promise<Record<ManifestKey, string>> {
  const out = {} as Record<ManifestKey, string>;
  for (const k of MANIFEST_KEYS) out[k] = await hashJson({ [k]: m[k] });
  return out;
}

/** Config identity: every field except the config's own name. */
export function manifestHash(m: ResolvedManifest): Promise<string> {
  const { config_id: _name, ...rest } = m;
  return hashJson({ manifest: rest });
}

function assertComparable(a: ResolvedManifest, b: ResolvedManifest): void {
  for (const m of [a, b]) {
    if (m.v !== 1 || m.rules !== HASH_RULES_VERSION) {
      throw new ConfigurationError(
        `${m.config_id}: manifest v${m.v} rules ${m.rules} is not comparable under ${HASH_RULES_VERSION}; re-resolve it`,
      );
    }
  }
}

/** Keys whose component hashes differ, in MANIFEST_KEYS order. */
export async function diffManifests(
  a: ResolvedManifest,
  b: ResolvedManifest,
): Promise<ManifestKey[]> {
  assertComparable(a, b);
  const [ha, hb] = [await componentHashes(a), await componentHashes(b)];
  return MANIFEST_KEYS.filter((k) => ha[k] !== hb[k]);
}

/**
 * Keys a vary list permits to differ. The image follows harness,
 * harness_version or toolchain (bundles are mounted, not baked); provider
 * routes follow models. backend_version never differs. The image revision is
 * part of `image` and gets no vary key: arms on different revisions of one
 * harness_version differ in `image` and are refused (H-01 run 004).
 */
export function allowedDiffs(vary: readonly VaryKey[]): Set<ManifestKey> {
  const allowed = new Set<ManifestKey>(vary);
  if (
    vary.some((k) => ["harness", "harness_version", "toolchain"].includes(k))
  ) {
    allowed.add("image");
  }
  if (vary.includes("models")) allowed.add("provider_routes");
  return allowed;
}

const MCP_NATIVE_KEYS = ["mcp", "mcp_tools"] as const;

/**
 * A side with MCP servers carries native.mcp (its sorted server names) and
 * native.mcp_tools (keyed by exactly those names, each a sorted,
 * duplicate-free tool-name list); a side without servers carries neither.
 */
function mcpKeysDerived(m: ResolvedManifest): boolean {
  const names = m.mcp.map((s) => s.name).sort();
  const native = m.settings.native;
  if (names.length === 0) {
    return !Object.hasOwn(native, "mcp") && !Object.hasOwn(native, "mcp_tools");
  }
  if (!Object.hasOwn(native, "mcp") || !Object.hasOwn(native, "mcp_tools")) {
    return false;
  }
  if (JSON.stringify(native["mcp"]) !== JSON.stringify(names)) return false;
  const tools = native["mcp_tools"];
  if (tools === null || typeof tools !== "object" || Array.isArray(tools)) {
    return false;
  }
  if (JSON.stringify(Object.keys(tools).sort()) !== JSON.stringify(names)) {
    return false;
  }
  // Each value is a tool-name list, never a place for other settings to ride along.
  for (const list of Object.values(tools)) {
    if (
      !Array.isArray(list) || !list.every((t) => typeof t === "string") ||
      list.some((t, i) => i > 0 && t <= (list[i - 1] as string))
    ) return false;
  }
  return true;
}

const toolsOf = (m: ResolvedManifest, server: string): string => {
  const tools = m.settings.native["mcp_tools"] as
    | Record<string, unknown>
    | undefined;
  return JSON.stringify(tools?.[server] ?? null);
};

/**
 * A server identical on both sides (name, version, schema hash) explains no
 * difference in its tool list: such a difference is not MCP-derived.
 */
function sharedServerToolsDiffer(a: ResolvedManifest, b: ResolvedManifest) {
  return a.mcp.some((s) =>
    b.mcp.some((x) =>
      x.name === s.name && x.version === s.version &&
      x.tool_schema_hash === s.tool_schema_hash
    ) && toolsOf(a, s.name) !== toolsOf(b, s.name)
  );
}

/**
 * A side with LSP servers carries native.lsp, exactly its sorted server names
 * (the claude-code adapter derives it from components.lsp); a side without
 * servers does not carry it (H-14).
 */
function lspKeyDerived(m: ResolvedManifest): boolean {
  const names = m.lsp.map((s) => s.name).sort();
  if (names.length === 0) return !Object.hasOwn(m.settings.native, "lsp");
  return JSON.stringify(m.settings.native["lsp"]) === JSON.stringify(names);
}

/** Each varied component's derived native keys follow it on this side. */
const componentKeysDerived = (m: ResolvedManifest, vary: readonly VaryKey[]) =>
  (!vary.includes("mcp") || mcpKeysDerived(m)) &&
  (!vary.includes("lsp") || lspKeyDerived(m));

/**
 * True when two manifests' settings differ only by native keys derived from the
 * varied mcp and lsp components (M2-14, H-14): removing exactly native.mcp and
 * native.mcp_tools (vary [mcp]) and native.lsp (vary [lsp]) makes the settings
 * hash-equal, and on each side those keys follow its own component.
 */
async function componentDerivedSettingsOnly(
  a: ResolvedManifest,
  b: ResolvedManifest,
  vary: readonly VaryKey[],
): Promise<boolean> {
  if (!componentKeysDerived(a, vary) || !componentKeysDerived(b, vary)) {
    return false;
  }
  if (vary.includes("mcp") && sharedServerToolsDiffer(a, b)) return false;
  const keys: string[] = [
    ...(vary.includes("mcp") ? MCP_NATIVE_KEYS : []),
    ...(vary.includes("lsp") ? ["lsp"] : []),
  ];
  const strip = (m: ResolvedManifest) => ({
    requested: m.settings.requested,
    native: Object.fromEntries(
      Object.entries(m.settings.native).filter(([k]) => !keys.includes(k)),
    ),
  });
  return await hashJson({ settings: strip(a) }) ===
    await hashJson({ settings: strip(b) });
}

/** The M2-14 rule alone (vary [mcp]). Exported for the test only. */
export const mcpDerivedSettingsOnly = (
  a: ResolvedManifest,
  b: ResolvedManifest,
) => componentDerivedSettingsOnly(a, b, ["mcp"]);

/**
 * Per harness, the native settings its adapter derives from the harness alone
 * (M5-01a). The caller passes the adapters' own derivations: this module is
 * below the adapters in the import graph.
 */
export type HarnessNative = Readonly<
  Record<string, (m: ResolvedManifest) => Record<string, unknown>>
>;

/**
 * True when two manifests' settings differ only by what each side's adapter
 * derives (M5-01a): its harness keys, with exactly the derived values, and
 * under vary [models] native.api_models (one model id per slot). Removing
 * those makes the settings hash-equal.
 */
async function harnessDerivedSettingsOnly(
  a: ResolvedManifest,
  b: ResolvedManifest,
  vary: readonly VaryKey[],
  harnessNative: HarnessNative,
): Promise<boolean> {
  const rest = async (m: ResolvedManifest): Promise<string | null> => {
    const native = { ...m.settings.native };
    const own = Object.hasOwn(harnessNative, m.harness)
      ? harnessNative[m.harness]!(m)
      : {};
    // ponytail: checked against today's derivation (given the manifest, so an
    // adapter can recognise its own older shape, H-07), so changing
    // DISALLOWED_TOOLS or PI_SETTINGS otherwise invalidates older campaigns'
    // reports; upgrade: key the derivation by harness_version or record it.
    for (const [k, v] of Object.entries(own)) {
      if (
        !Object.hasOwn(native, k) ||
        await hashJson({ v: native[k] }) !== await hashJson({ v })
      ) return null;
      delete native[k];
    }
    if (vary.includes("models")) {
      // Each slot's id is its slug minus the first segment: the catalog
      // convention (src/catalog/seed/inference.ts apiModelId), so no catalog
      // lookup. ponytail: a catalog row breaking that convention is refused.
      const ids = native["api_models"];
      if (
        ids === null || typeof ids !== "object" || Array.isArray(ids) ||
        JSON.stringify(Object.keys(ids).sort()) !==
          JSON.stringify(Object.keys(m.models).sort()) ||
        !Object.entries(m.models).every(([slot, slug]) => {
          const i = slug.indexOf("/");
          return i > 0 &&
            (ids as Record<string, unknown>)[slot] === slug.slice(i + 1);
        })
      ) return null;
      delete native["api_models"];
    }
    if (vary.includes("mcp")) {
      // The M2-14 rule applies here too: MCP keys follow the mcp component.
      if (!mcpKeysDerived(m)) return null;
      for (const k of MCP_NATIVE_KEYS) delete native[k];
    }
    if (vary.includes("lsp")) {
      // H-14: native.lsp follows the lsp component.
      if (!lspKeyDerived(m)) return null;
      delete native["lsp"];
    }
    return await hashJson({
      settings: { requested: m.settings.requested, native },
    });
  };
  if (vary.includes("mcp") && sharedServerToolsDiffer(a, b)) return false;
  // One harness, one derivation: a derived key may not differ between its
  // arms (H-07: a pre-H-07 six-tool list beside today's eight is web policy).
  if (a.harness === b.harness && Object.hasOwn(harnessNative, a.harness)) {
    for (const k of Object.keys(harnessNative[a.harness]!(a))) {
      const has = Object.hasOwn(a.settings.native, k);
      if (has !== Object.hasOwn(b.settings.native, k)) return false;
      // Both absent: rest() refuses the missing derived key.
      if (
        has && await hashJson({ v: a.settings.native[k] }) !==
          await hashJson({ v: b.settings.native[k] })
      ) return false;
    }
  }
  const ra = await rest(a);
  return ra !== null && ra === await rest(b);
}

/** Refuse a variant whose template differs from the baseline outside `vary`. */
export async function assertVaryHolds(
  baseline: ResolvedManifest,
  variant: ResolvedManifest,
  vary: readonly VaryKey[],
  harnessNative?: HarnessNative,
): Promise<void> {
  const allowed = allowedDiffs(vary);
  let bad = (await diffManifests(baseline, variant)).filter((k) =>
    !allowed.has(k)
  );
  // Under vary [mcp], native.mcp and native.mcp_tools follow the mcp
  // component; under vary [lsp], native.lsp follows the lsp component (H-14).
  if (vary.includes("mcp") || vary.includes("lsp")) {
    if (bad.includes("settings")) {
      if (await componentDerivedSettingsOnly(baseline, variant, vary)) {
        bad = bad.filter((k) => k !== "settings");
      }
    } else if (
      !componentKeysDerived(baseline, vary) ||
      !componentKeysDerived(variant, vary)
    ) {
      // Equal settings still must have the derived key shape on each side
      // (a variant with servers and no derived key equals a no-server baseline).
      bad = [...bad, "settings"];
    }
  }
  // Under vary [harness], native settings follow each side's adapter; with no
  // derivations given, a settings difference stays refused.
  if (vary.includes("harness") && !vary.includes("settings") && harnessNative) {
    const ok = await harnessDerivedSettingsOnly(
      baseline,
      variant,
      vary,
      harnessNative,
    );
    if (bad.includes("settings")) {
      if (ok) bad = bad.filter((k) => k !== "settings");
    } else if (!ok) {
      // Equal settings still must carry each side's derived values.
      bad = [...bad, "settings"];
    }
  }
  if (bad.length > 0) {
    throw new ConfigurationError(
      `${variant.config_id} differs from ${baseline.config_id} outside vary [${
        vary.join(", ")
      }]: ${bad.join(", ")}`,
    );
  }
}

/**
 * Problems that stop an execution manifest from belonging to an arm: it must
 * be exactly `forTask(template, taskLimits)`. Names the differing components
 * (limits included, so an arbitrary tighter limit is caught). Empty = ok.
 */
export async function executionMismatch(
  template: ResolvedManifest,
  execution: ResolvedManifest,
  taskLimits: HarnessTask["limits"],
): Promise<string[]> {
  const expected = forTask(template, taskLimits);
  return (await diffManifests(expected, execution)).map((k) =>
    `component ${k} differs from the arm template with task limits`
  );
}
