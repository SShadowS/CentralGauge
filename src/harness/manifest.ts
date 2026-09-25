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
import { effectiveLimits } from "./config.ts";
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
  lsp: z.array(Server),
  toolchain: z.array(z.string()),
  image: z.strictObject({
    digest: z.string().min(1),
    base_digest: z.string().min(1),
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
);
export type ResolvedManifest = z.output<typeof ResolvedManifestSchema>;

export interface RuntimeFacts {
  native_settings: Record<string, unknown>;
  image: { digest: string; base_digest: string };
  backend_version: string;
  servers: Record<string, { version: string; tool_schema_hash: string }>;
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
    harness_version: config.harness_version,
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
 * routes follow models. backend_version never differs.
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
 * True when two manifests' settings differ only by MCP-derived native keys
 * (M2-14): removing exactly native.mcp and native.mcp_tools makes the settings
 * hash-equal, and on each side those keys follow its own mcp component.
 * Exported for the test only.
 */
export async function mcpDerivedSettingsOnly(
  a: ResolvedManifest,
  b: ResolvedManifest,
): Promise<boolean> {
  if (!mcpKeysDerived(a) || !mcpKeysDerived(b)) return false;
  // A server identical on both sides (name, version, schema hash) explains no
  // difference in its tool list: that difference is not MCP-derived.
  for (const s of a.mcp) {
    const t = b.mcp.find((x) =>
      x.name === s.name && x.version === s.version &&
      x.tool_schema_hash === s.tool_schema_hash
    );
    if (t && toolsOf(a, s.name) !== toolsOf(b, s.name)) return false;
  }
  const strip = (m: ResolvedManifest) => ({
    requested: m.settings.requested,
    native: Object.fromEntries(
      Object.entries(m.settings.native).filter(([k]) =>
        !(MCP_NATIVE_KEYS as readonly string[]).includes(k)
      ),
    ),
  });
  return await hashJson({ settings: strip(a) }) ===
    await hashJson({ settings: strip(b) });
}

/** Refuse a variant whose template differs from the baseline outside `vary`. */
export async function assertVaryHolds(
  baseline: ResolvedManifest,
  variant: ResolvedManifest,
  vary: readonly VaryKey[],
): Promise<void> {
  const allowed = allowedDiffs(vary);
  let bad = (await diffManifests(baseline, variant)).filter((k) =>
    !allowed.has(k)
  );
  // Under vary [mcp], native.mcp and native.mcp_tools follow the mcp component.
  if (
    vary.includes("mcp") && bad.includes("settings") &&
    await mcpDerivedSettingsOnly(baseline, variant)
  ) {
    bad = bad.filter((k) => k !== "settings");
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
