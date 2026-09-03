/**
 * Shared row-mapping helper for `/api/v2/runs` and `/api/v2/runs/[id]`
 * (Task 8). Lives outside any `+server.ts` because SvelteKit only allows
 * HTTP-method exports (plus `config`/`prerender`/`trailingSlash`) from those
 * files — a non-method export from one would fail the build.
 */
import { blobHashFromKey } from "./ingest";
import type { RunV2Summary } from "../shared/api-types";

export interface RunV2Row {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  harness_fingerprint: string | null;
  retry_path_version: string | null;
  environment_digest: string | null;
  test_runner: "soap" | "legacy" | null;
  model_slug: string;
  model_display: string;
  family_slug: string;
}

/**
 * `capture` is `"full"` when `harness_fingerprint` is non-null (a run
 * captured under the 2026-09 harness), else `"pre_capture"`.
 * `environment_digest` is the bare sha256 hex digest of the uploaded
 * environment-manifest blob (the `blobs/` prefix stripped), or `null`.
 */
export function toRunV2Summary(r: RunV2Row): RunV2Summary {
  return {
    id: r.id,
    model: {
      slug: r.model_slug,
      display_name: r.model_display,
      family: r.family_slug,
    },
    started_at: r.started_at,
    completed_at: r.completed_at ?? null,
    status: r.status,
    harness_fingerprint: r.harness_fingerprint ?? null,
    retry_path_version: r.retry_path_version ?? null,
    environment_digest: r.environment_digest
      ? blobHashFromKey(r.environment_digest)
      : null,
    test_runner: r.test_runner ?? null,
    capture: r.harness_fingerprint ? "full" : "pre_capture",
  };
}
