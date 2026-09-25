/** Harness images (spec 1a section 5, D9): tags, labels, facts, provenance, runtime facts. */

import type { Catalog } from "../ingest/catalog/read.ts";
import type { HarnessAdapter } from "./adapter.ts";
import type { HarnessConfig } from "./config.ts";
import type { RuntimeFacts } from "./manifest.ts";
import type { DockerCli } from "./sandbox.ts";
import { ConfigurationError } from "../errors.ts";
import { BACKEND_VERSION } from "./backend.ts";

export const BASE_IMAGE = "centralgauge/harness-base:1";
export const IMAGE_LABELS = {
  harness: "centralgauge.harness",
  version: "centralgauge.harness.version",
  base: "centralgauge.harness.base_digest",
} as const;

export const imageTag = (harness: string, version: string) =>
  `centralgauge/harness-${harness}:${version}`;

export interface ImageFacts {
  digest: string;
  base_digest: string;
  harness: string;
  version: string;
}

type Inspect = {
  Id?: string;
  Config?: { Labels?: Record<string, string> | null };
  RootFS?: { Layers?: string[] };
} | null;

const IMMUTABLE = /^sha256:[0-9a-f]{64}$/;

export async function imageFacts(
  docker: DockerCli,
  ref: string,
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
  return {
    digest: img.Id,
    base_digest: l[IMAGE_LABELS.base]!,
    harness: l[IMAGE_LABELS.harness]!,
    version: l[IMAGE_LABELS.version]!,
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
): RuntimeFacts {
  if (
    image.harness !== config.harness ||
    image.version !== config.harness_version
  ) {
    throw new ConfigurationError(
      `${config.id}: image is ${image.harness} ${image.version}, config wants ${config.harness} ${config.harness_version}`,
    );
  }
  if (config.components.mcp.length > 0 || config.components.lsp.length > 0) {
    throw new ConfigurationError(
      `${config.id}: MCP and LSP components need runtime facts collected in M2`,
    );
  }
  return {
    native_settings: adapter.nativeSettings(config, catalog),
    image: { digest: image.digest, base_digest: image.base_digest },
    backend_version: BACKEND_VERSION,
    servers: {},
    provider_routes: adapter.providerRoutes(config),
  };
}
