import type { PageServerLoad } from "./$types";
import type { RunDetail, Transcript } from "$shared/api-types";
import { error } from "@sveltejs/kit";

// SvelteKit's `error()` only accepts 400-599. Server-internal `fetch()` can
// return 3xx (e.g. 308 from trailing-slash canonicalization on catch-all
// routes), so map any non-error status to 502 before throwing.
function httpErrorStatus(status: number): number {
  return status >= 400 && status <= 599 ? status : 502;
}

export const load: PageServerLoad = async ({
  params,
  fetch,
  setHeaders,
  depends,
}) => {
  depends(`app:transcript:${params.id}:${params.taskId}:${params.attempt}`);

  // First fetch run detail to find the transcript_key for this task+attempt
  const runRes = await fetch(`/api/v1/runs/${params.id}`);
  if (!runRes.ok)
    throw error(httpErrorStatus(runRes.status), `run ${params.id} not found`);
  const run = (await runRes.json()) as RunDetail;

  const taskResult = run.results.find((r) => r.task_id === params.taskId);
  if (!taskResult) {
    throw error(404, `task ${params.taskId} not in run ${params.id}`);
  }

  const attemptNum = parseInt(params.attempt, 10);
  const attempt = taskResult.attempts.find((a) => a.attempt === attemptNum);
  if (!attempt) {
    throw error(
      404,
      `attempt ${params.attempt} not in run ${params.id} task ${params.taskId}`,
    );
  }

  // Empty transcript_key would produce `/api/v1/transcripts/` — SvelteKit
  // canonicalizes that with a 308 redirect, which `error()` rejects (only
  // 400-599 allowed). Treat missing-key as a 404 directly.
  if (!attempt.transcript_key) {
    throw error(
      404,
      `transcript not available for run ${params.id} task ${params.taskId} attempt ${params.attempt}`,
    );
  }

  const tRes = await fetch(`/api/v1/transcripts/${attempt.transcript_key}`);
  if (!tRes.ok)
    throw error(httpErrorStatus(tRes.status), "transcript fetch failed");

  const apiCache = tRes.headers.get("cache-control");
  if (apiCache) setHeaders({ "cache-control": apiCache });

  // The transcript endpoint returns text/plain (already decompressed) — read as text
  // and wrap in the Transcript shape expected by the page component.
  const text = await tRes.text();
  const transcript: Transcript = {
    key: attempt.transcript_key,
    text,
    size_bytes: new TextEncoder().encode(text).length,
    meta: {
      run_id: params.id,
      task_id: params.taskId,
      attempt: attemptNum,
    },
  };

  return {
    runId: params.id,
    taskId: params.taskId,
    attempt: attemptNum,
    passed: attempt.passed,
    score: attempt.score,
    model: run.model,
    transcript,
  };
};
