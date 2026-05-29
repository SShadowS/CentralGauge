import {
  ContainerError,
  PwshSessionError,
  QueueFullError,
  QueueTimeoutError,
} from "../errors.ts";

const INFRA_MESSAGE_HINTS = [
  /\b(timeout|timed\s+out)\b/i,
  /econnreset/i,
  /econnrefused/i,
  /etimedout/i,
  /enotfound/i,
  /socket hang up/i,
  /connection\s+(?:reset|refused|closed)/i,
  /container.*not running/i,
  /PSSession.*(?:disconnected|broken|closed)/i,
  /Get-NavServerInstance.*(?:not recognized|not found)/i,
  /CommandNotFoundException.*Get-NavServerInstance/i,
  /Run-TestsInBcContainer.*failed/i,
  /Publish-BcContainerApp.*(?:timed out|PSSession|container.*not running)/i,
  // NOTE: a bare "TEST_ERROR" is intentionally NOT an infra hint — it is a
  // generic catch-all around the test runner that also fires for model-induced
  // faults. Genuine infra still matches the specific hints above. See
  // isInfraTestFailure in bc-container-provider.ts.
];

/**
 * Returns true if the error originates from infrastructure (container,
 * BC test harness, pwsh session, queue) and NOT from generated AL code
 * or model output. Generated-AL compile errors must NEVER trip container
 * health, since they are valid benchmark signal.
 */
export function isInfraError(err: unknown): boolean {
  if (err instanceof ContainerError) return true;
  if (err instanceof PwshSessionError) return true;
  if (err instanceof QueueTimeoutError) return true;
  if (err instanceof QueueFullError) return true;
  if (err instanceof Error) {
    return INFRA_MESSAGE_HINTS.some((p) => p.test(err.message));
  }
  return false;
}
