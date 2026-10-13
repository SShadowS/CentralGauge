/** Harness images (spec 1a section 5, D9): tags, labels, facts, provenance, runtime facts. */

import { join } from "@std/path";
import type { Catalog } from "../ingest/catalog/read.ts";
import type { HarnessAdapter } from "./adapter.ts";
import type { HarnessConfig } from "./config.ts";
import type { InstalledLsp, RuntimeFacts } from "./manifest.ts";
import type { DockerCli } from "./sandbox.ts";
import { ConfigurationError } from "../errors.ts";
import { BACKEND_VERSION } from "./backend.ts";
import { hashJson } from "./hash.ts";
import { LSP_ASSET_LABEL, LSP_MODES, LSP_TAG } from "./manifest.ts";

/** base:1 is frozen; H-01 run 004 builds base:2 (an existing tag is never rebuilt). */
export const BASE_VERSION = "2";
export const BASE_IMAGE = `centralgauge/harness-base:${BASE_VERSION}`;
/**
 * Tags the frozen campaign images carry (H-01 run 005). Reserved in code, not by
 * local presence: `images build` refuses them even on a host that has pruned
 * them, so a changed Dockerfile can never be built under one. Old records still
 * resolve through them (imageTag without a revision).
 */
export const FROZEN_IMAGE_TAGS: readonly string[] = [
  "centralgauge/harness-base:1",
  "centralgauge/harness-mock:1",
  "centralgauge/harness-claude-code:2.1.282",
  "centralgauge/harness-pi:0.87.1",
];
export const IMAGE_LABELS = {
  harness: "centralgauge.harness",
  version: "centralgauge.harness.version",
  base: "centralgauge.harness.base_digest",
  /** Optional (H-01 run 004): only images built with --revision carry it. */
  revision: "centralgauge.harness.revision",
} as const;
const REQUIRED_LABELS = [
  IMAGE_LABELS.harness,
  IMAGE_LABELS.version,
  IMAGE_LABELS.base,
];

/**
 * MCP component labels (M3-03): `centralgauge.mcp.<name>` = `<version> <sha256>`.
 * Separate from IMAGE_LABELS, whose values are all required. The base image
 * carries them; child images inherit them.
 */
export const MCP_LABEL_PREFIX = "centralgauge.mcp.";
/** The MCP components an image label may name (run.ps1 refuses any other). */
const MCP_COMPONENTS: readonly string[] = ["al-tools"];
export const AL_TOOLS_DEF = "harness/images/base/al-tools-tools.json";
/** Where the base Dockerfile puts the definition al-tools-mcp.mjs reads. */
export const AL_TOOLS_SHIPPED = "C:\\al-tools-tools.json";

/**
 * LSP component labels (M10): `centralgauge.lsp.<name>` = `<version> <sha256>`
 * on the claude-code image, the hashJson of the repo definition.
 */
export const LSP_LABEL_PREFIX = "centralgauge.lsp.";
const LSP_COMPONENTS: readonly string[] = ["al"];
export const AL_LSP_DEF = "harness/images/claude-code/lsp/al-lsp.json";
/** Where the claude-code Dockerfile puts the definition the image was built from. */
export const AL_LSP_SHIPPED = "C:\\cg-lsp\\al-lsp.json";
/** What install-lsp.ps1 records about the wrapper release it verified and installed (M10-10). */
export const AL_LSP_RESOLVED = "C:\\cg-lsp\\al-lsp-resolved.json";
/**
 * M10-10: the al-lsp-for-agents release `images build` resolved, labelled on the
 * claude-code image beside `centralgauge.lsp.al` (all three or none).
 */
export const LSP_RELEASE_LABELS = {
  release: `${LSP_LABEL_PREFIX}al.release`,
  asset: `${LSP_LABEL_PREFIX}al.asset`,
  dependency_source: `${LSP_LABEL_PREFIX}al.dependency_source`,
} as const;
const LSP_RELEASE_KEYS: readonly string[] = Object.values(LSP_RELEASE_LABELS);
/** The only repo the recipe may name; install-lsp.ps1 checks the same. */
const LSP_REPO = "SShadowS/al-lsp-for-agents";
const LSP_ASSET = /^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/;
const LSP_EXES = ["al-call-hierarchy.exe", "al-lsp-wrapper.exe"];
const GITHUB_API_TIMEOUT_MS = 30_000;

/** No revision: exactly the frozen tag. A revision: `<version>-r<revision>`. */
export const imageTag = (
  harness: string,
  version: string,
  revision?: string,
) =>
  `centralgauge/harness-${harness}:${version}${
    revision === undefined ? "" : `-r${revision}`
  }`;

export interface ImageFacts {
  digest: string;
  base_digest: string;
  harness: string;
  version: string;
  /** The revision label; null when the image has none (a frozen image). */
  revision: string | null;
  mcp?: Record<string, { version: string; tool_schema_hash: string }>;
  lsp?: Record<string, LspFact>;
}

/** An LSP component's facts; release, asset and dependency_source on images built since M10-10. */
export interface LspFact {
  version: string;
  tool_schema_hash: string;
  release?: string;
  /** `<asset name> sha256:<hex>`, the digest the wrapper zip was verified against. */
  asset?: string;
  dependency_source?: string;
}

type Inspect = {
  Id?: string;
  Config?: { Labels?: Record<string, string> | null };
  RootFS?: { Layers?: string[] };
} | null;

const IMMUTABLE = /^sha256:[0-9a-f]{64}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
/** An MCP component version: non-empty, no whitespace (write side: mcpLabel, read side: mcpFacts). */
const MCP_VERSION = /^\S+$/;

export async function imageFacts(
  docker: DockerCli,
  ref: string,
  /**
   * Owner label of the throwaway container that reads the shipped MCP
   * definition; null (a dry run) inspects only and never reads it.
   */
  owner: string | null,
): Promise<ImageFacts> {
  const img = await docker.inspectImage(ref) as Inspect;
  if (!img?.Id) {
    throw new ConfigurationError(
      `image ${ref} not found: run \`centralgauge harness images build\``,
    );
  }
  if (!IMMUTABLE.test(img.Id)) {
    throw new ConfigurationError(
      `image ${ref} has no immutable id (sha256:...): ${img.Id}`,
    );
  }
  const l = img.Config?.Labels ?? {};
  const missing = REQUIRED_LABELS.filter((k) => !l[k]);
  if (missing.length > 0) {
    throw new ConfigurationError(
      `image ${ref} lacks label(s) ${missing.join(", ")}`,
    );
  }
  if (!IMMUTABLE.test(l[IMAGE_LABELS.base]!)) {
    throw new ConfigurationError(
      `image ${ref}: label ${IMAGE_LABELS.base} (base_digest) is not sha256:<64 hex>: ${
        l[IMAGE_LABELS.base]
      }`,
    );
  }
  const mcp = mcpFacts(ref, l);
  const lsp = lspFacts(ref, l);
  // The label is trusted at build time only: the bytes the image ships must
  // hash to it (same names with another schema would pass a name check).
  if (owner !== null) {
    if (mcp["al-tools"]) {
      await verifyShipped(
        docker,
        img.Id,
        owner,
        ref,
        AL_TOOLS_SHIPPED,
        mcp["al-tools"],
        "rebuild the base image",
      );
    }
    if (lsp["al"]) {
      const def = await verifyShipped(
        docker,
        img.Id,
        owner,
        ref,
        AL_LSP_SHIPPED,
        lsp["al"],
        "rebuild the claude-code image",
      );
      await verifyResolved(docker, img.Id, owner, ref, def, lsp["al"]);
    }
  }
  return {
    digest: img.Id,
    base_digest: l[IMAGE_LABELS.base]!,
    harness: l[IMAGE_LABELS.harness]!,
    version: l[IMAGE_LABELS.version]!,
    revision: l[IMAGE_LABELS.revision] ?? null,
    mcp,
    // No key on images without LSP: existing deep-equal expectations hold.
    ...(Object.keys(lsp).length > 0 ? { lsp } : {}),
  };
}

async function verifyShipped(
  docker: DockerCli,
  id: string,
  owner: string,
  ref: string,
  path: string,
  label: { version: string; tool_schema_hash: string },
  fix: string,
): Promise<unknown> {
  const want = label.tool_schema_hash;
  const text = await docker.readImageFile(id, path, owner);
  let hash: string;
  let version: unknown;
  let def: unknown;
  try {
    if (text === null) throw new Error("not found");
    def = JSON.parse(text);
    hash = await hashJson(def);
    version = (def as { version?: unknown } | null)?.version;
  } catch (e) {
    throw new ConfigurationError(
      `image ${ref}: cannot read the shipped ${path} (${
        e instanceof Error ? e.message : String(e)
      })`,
    );
  }
  if (hash !== want) {
    throw new ConfigurationError(
      `image ${ref}: shipped ${path} hashes to ${hash}, which differs from its label ${want}: ${fix}`,
    );
  }
  // The hash covers the version field, but the label's own version text is
  // separate: a label may not claim a version the shipped file does not carry.
  if (version !== label.version) {
    throw new ConfigurationError(
      `image ${ref}: label version ${label.version} differs from the shipped ${path} version ${
        String(version)
      }: ${fix}`,
    );
  }
  return def;
}

/**
 * M10-10: a shipped recipe with a `source` (latest-release wrapper) needs the
 * release labels, and the shipped AL_LSP_RESOLVED must agree with them and with
 * the recipe. A pre-M10-10 recipe (hand-pinned wrapper, no source) has neither.
 */
async function verifyResolved(
  docker: DockerCli,
  id: string,
  owner: string,
  ref: string,
  def: unknown,
  f: LspFact,
): Promise<void> {
  const fix = "rebuild the claude-code image";
  const src = (def as {
    source?: { asset?: unknown; dependency_source?: unknown; exes?: unknown };
  } | null)?.source;
  if (f.release === undefined) {
    if (src === undefined) return;
    throw new ConfigurationError(
      `image ${ref}: the shipped ${AL_LSP_SHIPPED} resolves its wrapper release, but the image lacks label ${LSP_RELEASE_LABELS.release}: ${fix}`,
    );
  }
  if (src === undefined) {
    throw new ConfigurationError(
      `image ${ref}: label ${LSP_RELEASE_LABELS.release} on an image whose shipped ${AL_LSP_SHIPPED} has no source: ${fix}`,
    );
  }
  const text = await docker.readImageFile(id, AL_LSP_RESOLVED, owner);
  let r: {
    release?: unknown;
    asset?: unknown;
    sha256?: unknown;
    dependency_source?: unknown;
    exes?: unknown;
  };
  try {
    if (text === null) throw new Error("not found");
    r = JSON.parse(text) ?? {};
  } catch (e) {
    throw new ConfigurationError(
      `image ${ref}: cannot read the shipped ${AL_LSP_RESOLVED} (${
        e instanceof Error ? e.message : String(e)
      })`,
    );
  }
  const pairs: [string, unknown, string | undefined][] = [
    ["release", r.release, f.release],
    ["asset", `${r.asset} sha256:${r.sha256}`, f.asset],
    ["dependency_source", r.dependency_source, f.dependency_source],
  ];
  for (const [k, got, want] of pairs) {
    if (got !== want) {
      throw new ConfigurationError(
        `image ${ref}: shipped ${AL_LSP_RESOLVED} ${k} ${
          String(got)
        } differs from its label ${want}: ${fix}`,
      );
    }
  }
  if (
    r.asset !== src.asset || r.dependency_source !== src.dependency_source
  ) {
    throw new ConfigurationError(
      `image ${ref}: shipped ${AL_LSP_RESOLVED} (${String(r.asset)}, ${
        String(r.dependency_source)
      }) differs from the shipped recipe (${String(src.asset)}, ${
        String(src.dependency_source)
      }): ${fix}`,
    );
  }
  const exes = r.exes && typeof r.exes === "object"
    ? Object.entries(r.exes as Record<string, unknown>)
    : [];
  if (
    JSON.stringify(exes.map(([n]) => n).sort()) !==
      JSON.stringify([...LSP_EXES].sort()) ||
    exes.some(([, h]) => typeof h !== "string" || !SHA256_HEX.test(h))
  ) {
    throw new ConfigurationError(
      `image ${ref}: shipped ${AL_LSP_RESOLVED} exes must hash exactly ${
        LSP_EXES.join(" and ")
      }: ${fix}`,
    );
  }
}

type ComponentFacts = NonNullable<ImageFacts["mcp"]>;

function componentFacts(
  ref: string,
  l: Record<string, string>,
  prefix: string,
  known: readonly string[],
  kind: "MCP" | "LSP",
): ComponentFacts {
  const mcp: ComponentFacts = {};
  for (const [k, v] of Object.entries(l)) {
    if (!k.startsWith(prefix)) continue;
    const name = k.slice(prefix.length);
    if (!known.includes(name)) {
      throw new ConfigurationError(
        `image ${ref}: label ${k} names an unknown ${kind} component "${name}" (known: ${
          known.join(", ")
        })`,
      );
    }
    const [version, hash, ...rest] = v.split(" ");
    if (
      !version || !MCP_VERSION.test(version) || !hash ||
      !SHA256_HEX.test(hash) || rest.length > 0
    ) {
      throw new ConfigurationError(
        `image ${ref}: label ${k} must be "<version> <sha256>", got "${v}"`,
      );
    }
    mcp[name] = { version, tool_schema_hash: hash };
  }
  return mcp;
}

/** The MCP component facts in an image's labels; malformed or unknown labels are refused. */
export const mcpFacts = (ref: string, l: Record<string, string>) =>
  componentFacts(ref, l, MCP_LABEL_PREFIX, MCP_COMPONENTS, "MCP");
/**
 * The LSP component facts in an image's labels (M10); same rules. The M10-10
 * release labels join the al facts: all three or none, each well-formed.
 */
export function lspFacts(
  ref: string,
  l: Record<string, string>,
): Record<string, LspFact> {
  const facts: Record<string, LspFact> = componentFacts(
    ref,
    Object.fromEntries(
      Object.entries(l).filter(([k]) => !LSP_RELEASE_KEYS.includes(k)),
    ),
    LSP_LABEL_PREFIX,
    LSP_COMPONENTS,
    "LSP",
  );
  const present = LSP_RELEASE_KEYS.filter((k) => Object.hasOwn(l, k));
  if (present.length === 0) return facts;
  const al = facts["al"];
  if (present.length !== LSP_RELEASE_KEYS.length || !al) {
    throw new ConfigurationError(
      `image ${ref}: labels ${
        LSP_RELEASE_KEYS.join(", ")
      } go together with ${LSP_LABEL_PREFIX}al (present: ${
        [...present, ...(al ? [`${LSP_LABEL_PREFIX}al`] : [])].join(", ")
      })`,
    );
  }
  const L = LSP_RELEASE_LABELS;
  const bad = (k: string, want: string) =>
    new ConfigurationError(
      `image ${ref}: label ${k} must be ${want}, got "${l[k]}"`,
    );
  if (!LSP_TAG.test(l[L.release]!)) {
    throw bad(L.release, "v<major>.<minor>.<patch>");
  }
  if (!LSP_ASSET_LABEL.test(l[L.asset]!)) {
    throw bad(L.asset, '"<asset>.zip sha256:<64 hex>"');
  }
  if (!LSP_MODES.includes(l[L.dependency_source]!)) {
    throw bad(L.dependency_source, LSP_MODES.join(" or "));
  }
  facts["al"] = {
    ...al,
    release: l[L.release]!,
    asset: l[L.asset]!,
    dependency_source: l[L.dependency_source]!,
  };
  return facts;
}

/**
 * The base image's al-tools label: the tool definition's version and its
 * hashJson (canonical, so formatting of the file does not move it).
 */
export async function mcpLabel(root: string): Promise<[string, string]> {
  const def = await readAlToolsDef(root);
  return [
    `${MCP_LABEL_PREFIX}al-tools`,
    `${def.version} ${await hashJson(def)}`,
  ];
}

/** A component definition file, read once and version-checked. */
async function readDef(
  root: string,
  rel: string,
  what: string,
): Promise<{ version: string; tools?: unknown }> {
  const path = join(root, rel);
  let def: { version?: unknown; tools?: unknown };
  try {
    def = JSON.parse(await Deno.readTextFile(path));
  } catch (e) {
    throw new ConfigurationError(
      `${path}: cannot read the ${what}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
  if (typeof def?.version !== "string" || !MCP_VERSION.test(def.version)) {
    throw new ConfigurationError(
      `${path}: version missing or contains whitespace`,
    );
  }
  return def as { version: string; tools?: unknown };
}
const readAlToolsDef = (root: string) =>
  readDef(root, AL_TOOLS_DEF, "al-tools tool definition");

/** The repo's MCP definitions: per server, the definition hash (as in the image label) and its sorted tool names. */
export type McpDefinitions = Record<
  string,
  { hash: string; tools: string[]; version?: string }
>;

export async function mcpDefinitions(root: string): Promise<McpDefinitions> {
  // One read: the hash and the tool names come from the same object.
  const def = await readAlToolsDef(root);
  const names = (Array.isArray(def.tools) ? def.tools : []).map((
    t: { name?: unknown } | null,
  ) => t?.name);
  if (
    names.length === 0 ||
    names.some((n: unknown) => typeof n !== "string" || n === "") ||
    new Set(names).size !== names.length
  ) {
    throw new ConfigurationError(
      `${
        join(root, AL_TOOLS_DEF)
      }: tools must be a non-empty list of uniquely named tools`,
    );
  }
  return {
    "al-tools": {
      hash: await hashJson(def),
      version: def.version,
      tools: (names as string[]).sort(),
    },
  };
}

/**
 * The claude-code image's LSP label. null when the build root has no
 * al-lsp.json: the real Dockerfile COPYs that file, so a real build cannot
 * succeed without it; temp build roots in tests stay label-free.
 */
export async function lspLabel(
  root: string,
): Promise<[string, string] | null> {
  try {
    await Deno.stat(join(root, AL_LSP_DEF));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
  const def = await readDef(root, AL_LSP_DEF, "AL LSP definition");
  return [`${LSP_LABEL_PREFIX}al`, `${def.version} ${await hashJson(def)}`];
}

/** The newest al-lsp-for-agents release, as `images build` passes and labels it (M10-10). */
export interface LspRelease {
  tag: string;
  asset: string;
  /** Exactly https://github.com/<repo>/releases/download/<tag>/<asset>. */
  url: string;
  /** The API's asset digest (sha256:<hex>), hex only. */
  sha256: string;
  dependency_source: string;
}

/** The recipe's wrapper source, checked as install-lsp.ps1 checks it. */
async function lspSource(root: string) {
  const path = join(root, AL_LSP_DEF);
  const def = await readDef(root, AL_LSP_DEF, "AL LSP definition") as {
    source?: {
      repo?: unknown;
      asset?: unknown;
      exes?: unknown;
      dependency_source?: unknown;
    };
  };
  const s = def.source;
  if (
    s?.repo !== LSP_REPO || typeof s.asset !== "string" ||
    !LSP_ASSET.test(s.asset) || !Array.isArray(s.exes) ||
    JSON.stringify([...s.exes].sort()) !== JSON.stringify(LSP_EXES) ||
    typeof s.dependency_source !== "string" ||
    !LSP_MODES.includes(s.dependency_source)
  ) {
    throw new ConfigurationError(
      `${path}: source must name repo ${LSP_REPO}, a .zip asset, exes ${
        LSP_EXES.join(", ")
      } and dependency_source ${LSP_MODES.join(" or ")}`,
    );
  }
  return {
    repo: LSP_REPO,
    asset: s.asset,
    dependency_source: s.dependency_source,
  };
}

/**
 * The newest release of the recipe's repo, from the GitHub API over HTTPS (no
 * token): fails closed on any error, non-200, odd tag, draft or prerelease,
 * not exactly one recipe asset, a foreign download URL, or a missing or
 * non-sha256 digest. The digest is what install-lsp.ps1 verifies the zip against.
 */
export async function resolveLspRelease(
  root: string,
  fetchFn: typeof fetch,
): Promise<LspRelease> {
  const src = await lspSource(root);
  const api = `https://api.github.com/repos/${src.repo}/releases/latest`;
  const fail = (why: string) =>
    new ConfigurationError(
      `cannot resolve the newest ${src.repo} release (${api}): ${why}`,
    );
  let body: {
    tag_name?: unknown;
    draft?: unknown;
    prerelease?: unknown;
    assets?: unknown;
  } | null;
  try {
    const res = await fetchFn(api, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "centralgauge-harness",
      },
      signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
      // The digest comes from this answer: a redirect may not change who gives it.
      redirect: "error",
    });
    if (res.status !== 200) {
      await res.body?.cancel();
      throw fail(`HTTP ${res.status}`);
    }
    body = await res.json();
  } catch (e) {
    if (e instanceof ConfigurationError) throw e;
    throw fail(e instanceof Error ? e.message : String(e));
  }
  const tag = body?.tag_name;
  if (typeof tag !== "string" || !LSP_TAG.test(tag)) {
    throw fail(
      `tag_name ${JSON.stringify(tag)} is not v<major>.<minor>.<patch>`,
    );
  }
  if (body!.draft !== false || body!.prerelease !== false) {
    throw fail(
      `${tag} is not a published release (draft ${
        String(body!.draft)
      }, prerelease ${String(body!.prerelease)})`,
    );
  }
  const assets = (Array.isArray(body!.assets) ? body!.assets : []).filter((
    a: { name?: unknown } | null,
  ) => a?.name === src.asset) as {
    browser_download_url?: unknown;
    digest?: unknown;
  }[];
  if (assets.length !== 1) {
    throw fail(
      `${tag} has ${assets.length} assets named ${src.asset}, want exactly 1`,
    );
  }
  const a = assets[0]!;
  const url =
    `https://github.com/${src.repo}/releases/download/${tag}/${src.asset}`;
  if (a.browser_download_url !== url) {
    throw fail(
      `browser_download_url ${
        JSON.stringify(a.browser_download_url)
      } is not ${url}`,
    );
  }
  const m = typeof a.digest === "string"
    ? /^sha256:([0-9a-f]{64})$/.exec(a.digest)
    : null;
  if (!m) {
    throw fail(
      `${src.asset} of ${tag} has no sha256 digest (got ${
        JSON.stringify(a.digest)
      })`,
    );
  }
  return {
    tag,
    asset: src.asset,
    url,
    sha256: m[1]!,
    dependency_source: src.dependency_source,
  };
}

/** The resolved release as claude-code build args (install-lsp.ps1) and image labels. */
export const lspReleaseArgs = (r: LspRelease): string[] => [
  "--build-arg",
  `LSP_RELEASE=${r.tag}`,
  "--build-arg",
  `LSP_WRAPPER_URL=${r.url}`,
  "--build-arg",
  `LSP_WRAPPER_SHA256=${r.sha256}`,
  "--label",
  `${LSP_RELEASE_LABELS.release}=${r.tag}`,
  "--label",
  `${LSP_RELEASE_LABELS.asset}=${r.asset} sha256:${r.sha256}`,
  "--label",
  `${LSP_RELEASE_LABELS.dependency_source}=${r.dependency_source}`,
];

/** The repo's LSP definition: the hash the label must carry; no MCP tool list. */
export async function lspDefinitions(root: string): Promise<McpDefinitions> {
  const def = await readDef(root, AL_LSP_DEF, "AL LSP definition");
  return { al: { hash: await hashJson(def), version: def.version, tools: [] } };
}

/** The definitions runtimeFacts needs for exactly the server kinds a config names. */
export async function serverDefinitions(
  root: string,
  c: { mcp: readonly string[]; lsp: readonly string[] },
): Promise<McpDefinitions> {
  // One map keyed by server name: a name in both kinds would overwrite.
  const dup = c.mcp.filter((n) => c.lsp.includes(n));
  if (dup.length > 0) {
    throw new ConfigurationError(
      `server name(s) ${dup.join(", ")} named as both MCP and LSP components`,
    );
  }
  return {
    ...(c.mcp.length > 0 ? await mcpDefinitions(root) : {}),
    ...(c.lsp.length > 0 ? await lspDefinitions(root) : {}),
  };
}

/** Provenance, not a label: the image's layers must start with the base image's layers. */
export async function hasBaseLayers(
  docker: DockerCli,
  imageRef: string,
  baseRef: string,
): Promise<boolean> {
  const img = await docker.inspectImage(imageRef) as Inspect;
  const base = await docker.inspectImage(baseRef) as Inspect;
  const a = img?.RootFS?.Layers ?? [];
  const b = base?.RootFS?.Layers ?? [];
  return b.length > 0 && a.length >= b.length && b.every((x, i) => a[i] === x);
}

/**
 * The LSP releases an image has installed (M10-10), recorded for every arm on
 * it, enabled or not. No key when the image has no release labels: those
 * manifests keep their hashes.
 */
export function installedFacts(
  image: Pick<ImageFacts, "lsp">,
): { installed?: { lsp: Record<string, InstalledLsp> } } {
  const lsp: Record<string, InstalledLsp> = {};
  for (const [name, f] of Object.entries(image.lsp ?? {})) {
    const { release, asset, dependency_source } = f;
    if (release && asset && dependency_source) {
      lsp[name] = { release, asset, dependency_source };
    }
  }
  return Object.keys(lsp).length > 0 ? { installed: { lsp } } : {};
}

export function runtimeFacts(
  config: HarnessConfig,
  image: ImageFacts,
  adapter: HarnessAdapter,
  catalog: Catalog,
  /** Required when the config names MCP components (mcpDefinitions). */
  defs: McpDefinitions = {},
): RuntimeFacts {
  if (
    image.harness !== config.harness ||
    image.version !== config.harness_version
  ) {
    throw new ConfigurationError(
      `${config.id}: image is ${image.harness} ${image.version}, config wants ${config.harness} ${config.harness_version}`,
    );
  }
  // Fail closed (H-01 run 004): a frozen image and a rebuilt one never stand
  // in for each other, in either direction.
  const want = config.image_revision ?? null;
  if (image.revision !== want) {
    const say = (r: string | null) =>
      r === null ? "no revision" : `revision ${r}`;
    throw new ConfigurationError(
      `${config.id}: image ${image.digest} has ${
        say(image.revision)
      } (label ${IMAGE_LABELS.revision}), config wants ${
        say(want)
      } (image_revision)`,
    );
  }
  const servers: RuntimeFacts["servers"] = {};
  const fact = (
    kind: "MCP" | "LSP",
    name: string,
    table: ImageFacts["lsp"],
    defFile: string,
    fix: string,
  ) => {
    const f = table && Object.hasOwn(table, name) ? table[name] : undefined;
    if (!f) {
      throw new ConfigurationError(
        `${config.id}: image ${image.digest} has no ${kind} component ${name} (${fix})`,
      );
    }
    // Definition drift: the repo's file is not the one the image shipped.
    const def = Object.hasOwn(defs, name) ? defs[name] : undefined;
    if (!def) {
      throw new ConfigurationError(
        `${config.id}: no repo definition loaded for ${kind} component ${name}`,
      );
    }
    if (def.hash !== f.tool_schema_hash) {
      throw new ConfigurationError(
        `${config.id}: definition ${defFile} differs from image ${image.digest}: rebuild`,
      );
    }
    if (def.version !== undefined && def.version !== f.version) {
      throw new ConfigurationError(
        `${config.id}: image ${image.digest} label version ${f.version} differs from ${defFile} version ${def.version}: rebuild`,
      );
    }
    servers[name] = f;
  };
  for (const name of config.components.mcp) {
    fact(
      "MCP",
      name,
      image.mcp,
      AL_TOOLS_DEF,
      "rebuild the base image, then the harness image",
    );
  }
  for (const name of config.components.lsp) {
    fact(
      "LSP",
      name,
      image.lsp,
      AL_LSP_DEF,
      "build the claude-code image with the LSP layer",
    );
  }
  const native = adapter.nativeSettings(config, catalog);
  // The expected MCP tool inventory (M2-09): MCP servers only, sorted.
  const names = [...config.components.mcp].sort();
  return {
    native_settings: names.length > 0
      ? {
        ...native,
        mcp_tools: Object.fromEntries(
          names.map((n) => [n, defs[n]!.tools]),
        ),
      }
      : native,
    // No key when absent: frozen-image manifests keep their hashes.
    image: {
      digest: image.digest,
      base_digest: image.base_digest,
      ...(image.revision === null ? {} : { revision: image.revision }),
      ...installedFacts(image),
    },
    backend_version: BACKEND_VERSION,
    servers,
    provider_routes: adapter.providerRoutes(config),
  };
}
