import type { CatalogTag } from "../../../../site/src/lib/shared/taxonomy-schema.ts";

/** raw manifest tag (lower-case) -> surface slug; null drops it; missing = drop too. */
export const SURFACE_ALIASES: Record<string, string | null> = {
  "table": "table",
  "tableextension": "table-extension",
  "table-extension": "table-extension",
  "enum": "enum",
  "enum-extension": "enum-extension",
  "interface": "interface",
  "page": "page",
  "api-page": "page",
  "pageextension": "page-extension",
  "page-extension": "page-extension",
  "pagecustomization": "page-customization",
  "customization": "page-customization",
  "report": "report",
  "dataset": "report",
  "query": "query",
  "query-object": "query",
  "xmlport": "xml",
  "codeunit": "codeunit",
  "permissionset": "permissionset",
  "flowfield": "flowfield",
  "calcformula": "flowfield",
  "flowfilter": "flowfilter",
  "sift": "sift-keys",
  "sift-keys": "sift-keys",
  "keys": "keys",
  "table-relation": "table-relation",
  "recordref": "recordref",
  "fieldref": "fieldref",
  "keyref": "fieldref",
  "variant": "variant",
  "datatransfer": "datatransfer",
  "event-subscriber": "event-subscriber",
  "eventsubscriber": "event-subscriber",
  "event-publisher": "event-publisher",
  "integration-event": "event-publisher",
  "business-event": "business-event",
  "errorinfo": "error-info",
  "collectible-errors": "collectible-errors",
  "json": "json",
  "xml": "xml",
  "http": "http",
  "httpclient": "http",
  "web-service": "web-service",
  "secrettext": "secrettext",
  "base64": "base64",
  "text-builder": "text-builder",
  "guid": "guid",
  "string-formatting": "string-formatting",
  "temporary-table": "temporary-table",
  "single-instance": "single-instance",
  "singleinstance": "single-instance",
  "install": "install",
  "upgrade-tag": "upgrade-tag",
  "test-codeunit": "test-codeunit",
  "test-page": "test-page",
  "factbox": "factbox",
  "system-part": "system-part",
  "systempart": "system-part",
  "page-action": "page-action",
  // mechanism-shaped raw tags: not surfaces, handled by enrichment; drop here.
  "try-function": null,
  "tryfunction": null,
  "transaction": null,
  "rollback": null,
  "commitbehavior": null,
  "rounding": null,
  "numeric-precision": null,
  "decimal-precision": null,
  "locking": null,
  "locktimeoutduration": null,
  "xrec": null,
  "filter-group": null,
  "filter": null,
  "permissions": null,
  "namespace": null,
  // retired / noise
  "calculations": null,
  "collections": null,
  "list": null,
  "generics": null,
  "codeunit-self-reference": null,
  "v15": null,
  "v16": null,
  "v17": null, // become min_bc_version
};

const surfaceSlugs = [
  ...new Set(
    Object.values(SURFACE_ALIASES).filter((v): v is string => v !== null),
  ),
].sort();
const HIDDEN = new Set(["codeunit", "table", "page", "keys"]);
export const SURFACE_TAGS: CatalogTag[] = surfaceSlugs.map((slug) => ({
  slug,
  family: "surface",
  name: slug.split("-").map((w) => (w[0] ?? "").toUpperCase() + w.slice(1))
    .join(" "),
  description: `A ${
    slug.replace(/-/g, " ")
  } is created, extended or exercised.`,
  ...(HIDDEN.has(slug) ? { hidden_by_default: true } : {}),
}));

/** min_bc_version from the raw version tags; 15 when none is present. */
export function minVersionFromTags(raw: string[]): number {
  const vs = raw.map((t) => /^v(1[5-9]|2\d)$/.exec(t.toLowerCase())?.[1])
    .filter((x): x is string => !!x).map(Number);
  return vs.length ? Math.max(...vs) : 15;
}
