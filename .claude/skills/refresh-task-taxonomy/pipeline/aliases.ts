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
  // `domains:` entries. The X-series records object types there rather than in
  // metadata.tags, so the same table has to speak plural. A domain that names a
  // concern rather than an AL surface (error-handling, performance, posting,
  // dimensions, testability, install-upgrade) is left out and dropped like any
  // unknown value; the enrichment names those as mechanisms instead.
  "codeunits": "codeunit",
  "tables": "table",
  "pages": "page",
  "enums": "enum",
  "interfaces": "interface",
  "reports": "report",
  "queries": "query",
  "xmlports": "xml",
  "flowfields": "flowfield",
  "table-relations": "table-relation",
  "web-services": "web-service",
  "events": "event-subscriber",
  "reflection": "recordref",
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

/**
 * Display spelling for slug words that plain title-casing gets wrong:
 * acronyms, and AL type names whose canonical form is camel-cased.
 * Keyed by the lower-case word as it appears in a slug.
 */
export const WORD_CASE: Record<string, string> = {
  // acronyms
  guid: "GUID",
  http: "HTTP",
  json: "JSON",
  sift: "SIFT",
  sql: "SQL",
  tryfunction: "TryFunction",
  xml: "XML",
  // AL type names
  datatransfer: "DataTransfer",
  errorinfo: "ErrorInfo",
  fieldref: "FieldRef",
  flowfield: "FlowField",
  flowfilter: "FlowFilter",
  permissionset: "PermissionSet",
  recordref: "RecordRef",
  secrettext: "SecretText",
  xrec: "xRec",
};

/** Title-case a slug for display, honouring the WORD_CASE spellings. */
export function displayName(slug: string): string {
  return slug
    .split("-")
    .map((w) => WORD_CASE[w] ?? (w[0] ?? "").toUpperCase() + w.slice(1))
    .join(" ");
}

export const SURFACE_TAGS: CatalogTag[] = surfaceSlugs.map((slug) => ({
  slug,
  family: "surface",
  name: displayName(slug),
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
