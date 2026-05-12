import {
  ContainerError,
  PwshSessionError,
  QueueFullError,
  QueueTimeoutError,
} from "../errors.ts";

const INFRA_MESSAGE_HINTS = [
  /\b(timeout|timed\s+out)\b/i,
  /econnreset/i,
  /enotfound/i,
  /container.*not running/i,
  /publish.*failed/i,
  /test_error/i,
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
