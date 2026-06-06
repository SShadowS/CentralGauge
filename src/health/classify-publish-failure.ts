// src/health/classify-publish-failure.ts

/**
 * Ownership class of a publish/install failure.
 * - `infra`   — harness/container/tooling fault; reroute + retry, do not penalize the model.
 * - `model`   — deterministic candidate defect (object-ID collision in a clean env,
 *               install-trigger error, schema-sync validation); score as a model failure, no retry.
 * - `unknown` — unrecognized; caller throws as infra for safety but should tag for telemetry.
 */
export type PublishFailureClass = "infra" | "model" | "unknown";

// Genuine infrastructure signatures. Mirrors src/health/is-infra-error.ts +
// TEST_ERROR_INFRA_SIGNATURES in bc-container-provider.ts. Checked FIRST: a
// real infra blip during publish must reroute even if the message also mentions
// an object collision.
const INFRA_PUBLISH_SIGNATURES: RegExp[] = [
  /\b(timeout|timed\s+out)\b/i,
  /\b(?:econnreset|econnrefused|etimedout|enotfound)\b/i,
  /socket hang up/i,
  /connection\b.{0,30}\b(?:reset|refused|closed|forcibly)/i,
  /unable to connect to the remote server/i,
  /PSSession.*(?:disconnected|broken|closed|removed)/i,
  /SQL.*(?:server|service).*(?:down|unavailable|not responding)/i,
  /Get-NavServerInstance.*(?:not recognized|not found)/i,
  /container .* not running/i,
];

// Harness contamination markers from our own cleanup scripts. When present, a
// collision is leftover-state, NOT the model's fault.
const CONTAMINATION_MARKERS: RegExp[] = [
  /PREREQ_CLEANUP_INCOMPLETE/,
  /PREPARE_CLEANUP_WARN/,
];

// Duplicate-object collision phrasings. Separated so the SOAP catch can decide
// to fall back to legacy (broader cleanup) for collisions rather than
// short-circuiting to "model".
const COLLISION_SIGNATURES: RegExp[] = [
  /already defined in/i,
  /defined in multiple apps/i,
];

// Deterministic candidate-defect signatures (model-owned). Install/schema
// patterns are scoped to error/failure phrasing to avoid matching generic
// platform prose that merely mentions OnInstall.
const MODEL_PUBLISH_SIGNATURES: RegExp[] = [
  ...COLLISION_SIGNATURES,
  /OnInstall(?:AppPerCompany|AppPerDatabase)?[^.\r\n]*(?:raised an error|failed|error|exception)/i,
  /install codeunit[^.\r\n]*(?:fail|error|exception)/i,
  /schema (?:synchronization|sync)[^.\r\n]*(?:fail|error)/i,
  /destructive changes/i,
];

/** True when the failure output carries a duplicate-object collision phrasing. */
export function isCollisionPublishFailure(output: string): boolean {
  return COLLISION_SIGNATURES.some((re) => re.test(output));
}

/**
 * Classify a publish/install failure by ownership from its raw output.
 * Pure + exported for testing. Precedence: infra → contamination(infra) →
 * model → unknown.
 */
export function classifyPublishFailure(output: string): PublishFailureClass {
  if (INFRA_PUBLISH_SIGNATURES.some((re) => re.test(output))) return "infra";
  if (CONTAMINATION_MARKERS.some((re) => re.test(output))) return "infra";
  if (MODEL_PUBLISH_SIGNATURES.some((re) => re.test(output))) return "model";
  return "unknown";
}
