import type { SetupPublishPayload } from "../../site/src/lib/shared/setup-publish.ts";
import type { AdminConfig } from "./types.ts";
import { CentralGaugeError } from "../errors.ts";
import { postWithRetry, type RetryOptions } from "./client.ts";
import { signPathBound } from "./sign.ts";

const PUBLISH_PATH = "/api/v1/admin/setups/publish";
const PROMOTE_PATH = "/api/v1/admin/setups/task-sets/promote";

async function postSigned<T>(
  config: AdminConfig,
  key: Uint8Array,
  path: string,
  payload: unknown,
  opts: RetryOptions,
): Promise<T> {
  const signature = await signPathBound(payload, path, key, config.adminKeyId);
  // 409 is a 4xx, which postWithRetry returns without retrying; 5xx retries.
  const resp = await postWithRetry(
    `${config.url.replace(/\/+$/, "")}${path}`,
    { signature, payload },
    { maxAttempts: 3, ...opts },
  );
  const text = await resp.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // non-JSON body: fall through to the generic error below
  }
  if (!resp.ok) {
    const code = typeof body["code"] === "string"
      ? body["code"]
      : `http_${resp.status}`;
    const msg = typeof body["error"] === "string" ? body["error"] : text;
    throw new CentralGaugeError(
      `${path} failed (${resp.status} ${code}): ${msg}`,
      code,
      { status: resp.status, details: body["details"] },
    );
  }
  return body as T;
}

export function postSetupPublish(
  config: AdminConfig,
  key: Uint8Array,
  payload: SetupPublishPayload,
  opts: RetryOptions = {},
): Promise<{ run_id: string; setup_id: string; task_set_hash: string }> {
  return postSigned(config, key, PUBLISH_PATH, payload, opts);
}

export function postSetupPromote(
  config: AdminConfig,
  key: Uint8Array,
  hash: string,
  opts: RetryOptions = {},
): Promise<{ hash: string; promoted_at: string }> {
  return postSigned(config, key, PROMOTE_PATH, { hash }, opts);
}
