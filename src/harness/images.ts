/** Harness images (spec 1a section 5, D9): tags, labels, facts, provenance, runtime facts. */

import { join } from "@std/path";
import type { Catalog } from "../ingest/catalog/read.ts";
import type { HarnessAdapter } from "./adapter.ts";
import type { HarnessConfig } from "./config.ts";
import type { RuntimeFacts } from "./manifest.ts";
import type { DockerCli } from "./sandbox.ts";
import { ConfigurationError } from "../errors.ts";
import { BACKEND_VERSION } from "./backend.ts";
import { hashJson } from "./hash.ts";

export const BASE_IMAGE = "centralgauge/harness-base:1";
export const IMAGE_LABELS = {
  harness: "centralgauge.harness",
  version: "centralgauge.harness.version",
  base: "centralgauge.harness.base_digest",
} as const;

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

export const imageTag = (harness: string, version: string) =>
  `centralgauge/harness-${harness}:${version}`;

export interface ImageFacts {
  digest: string;
  base_digest: string;
  harness: string;
  version: string;
  mcp?: Record<string, { version: string; tool_schema_hash: string }>;
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
  const missing = Object.values(IMAGE_LABELS).filter((k) => !l[k]);
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
  // The label is trusted at build time only: the bytes the image ships must
  // hash to it (same names with another schema would pass a name check).
  if (mcp["al-tools"] && owner !== null) {
    const text = await docker.readImageFile(img.Id, AL_TOOLS_SHIPPED, owner);
    let hash: string;
    try {
      if (text === null) throw new Error("not found");
      hash = await hashJson(JSON.parse(text));
    } catch (e) {
      throw new ConfigurationError(
        `image ${ref}: cannot read the shipped ${AL_TOOLS_SHIPPED} (${
          e instanceof Error ? e.message : String(e)
        })`,
      );
    }
    if (hash !== mcp["al-tools"].tool_schema_hash) {
      throw new ConfigurationError(
        `image ${ref}: shipped ${AL_TOOLS_SHIPPED} hashes to ${hash}, which differs from its label ${
          mcp["al-tools"].tool_schema_hash
        }: rebuild the base image`,
      );
    }
  }
  return {
    digest: img.Id,
    base_digest: l[IMAGE_LABELS.base]!,
    harness: l[IMAGE_LABELS.harness]!,
    version: l[IMAGE_LABELS.version]!,
    mcp,
  };
}

/** The MCP component facts in an image's labels; malformed or unknown labels are refused. */
export function mcpFacts(
  ref: string,
  l: Record<string, string>,
): NonNullable<ImageFacts["mcp"]> {
  const mcp: NonNullable<ImageFacts["mcp"]> = {};
  for (const [k, v] of Object.entries(l)) {
    if (!k.startsWith(MCP_LABEL_PREFIX)) continue;
    const name = k.slice(MCP_LABEL_PREFIX.length);
    if (!MCP_COMPONENTS.includes(name)) {
      throw new ConfigurationError(
        `image ${ref}: label ${k} names an unknown MCP component "${name}" (known: ${
          MCP_COMPONENTS.join(", ")
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

/** The al-tools definition, read once and version-checked. */
async function readAlToolsDef(
  root: string,
): Promise<{ version: string; tools?: unknown }> {
  const path = join(root, AL_TOOLS_DEF);
  let def: { version?: unknown; tools?: unknown };
  try {
    def = JSON.parse(await Deno.readTextFile(path));
  } catch (e) {
    throw new ConfigurationError(
      `${path}: cannot read the al-tools tool definition: ${
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

/** The repo's MCP definitions: per server, the definition hash (as in the image label) and its sorted tool names. */
export type McpDefinitions = Record<string, { hash: string; tools: string[] }>;

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
      tools: (names as string[]).sort(),
    },
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
  if (config.components.lsp.length > 0) {
    throw new ConfigurationError(
      `${config.id}: LSP components are not implemented`,
    );
  }
  const servers: RuntimeFacts["servers"] = {};
  for (const name of config.components.mcp) {
    const f = image.mcp && Object.hasOwn(image.mcp, name)
      ? image.mcp[name]
      : undefined;
    if (!f) {
      throw new ConfigurationError(
        `${config.id}: image ${image.digest} has no MCP component ${name} (rebuild the base image, then the harness image)`,
      );
    }
    // Definition drift: the repo's tool file is not the one the image shipped.
    const def = Object.hasOwn(defs, name) ? defs[name] : undefined;
    if (!def) {
      throw new ConfigurationError(
        `${config.id}: no repo definition loaded for MCP component ${name}`,
      );
    }
    if (def.hash !== f.tool_schema_hash) {
      throw new ConfigurationError(
        `${config.id}: definition ${AL_TOOLS_DEF} differs from image ${image.digest}: rebuild`,
      );
    }
    servers[name] = f;
  }
  const native = adapter.nativeSettings(config, catalog);
  // The expected tool inventory, persisted with the manifest before release
  // (M2-09): only when servers exist, keyed by exactly the sorted names.
  const names = Object.keys(servers).sort();
  return {
    native_settings: names.length > 0
      ? {
        ...native,
        mcp_tools: Object.fromEntries(
          names.map((n) => [n, defs[n]!.tools]),
        ),
      }
      : native,
    image: { digest: image.digest, base_digest: image.base_digest },
    backend_version: BACKEND_VERSION,
    servers,
    provider_routes: adapter.providerRoutes(config),
  };
}
