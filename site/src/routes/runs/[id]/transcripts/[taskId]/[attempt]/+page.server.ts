import type { PageServerLoad } from './$types';
import type { RunDetail, Transcript } from '$shared/api-types';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params, fetch, setHeaders, depends }) => {
  depends(`app:transcript:${params.id}:${params.taskId}:${params.attempt}`);

  // First fetch run detail to find the transcript_key for this task+attempt
  const runRes = await fetch(`/api/v1/runs/${params.id}`);
  if (!runRes.ok) throw error(runRes.status, `run ${params.id} not found`);
  const run = await runRes.json() as RunDetail;

  const taskResult = run.results.find((r) => r.task_id === params.taskId);
  if (!taskResult) throw error(404, `task ${params.taskId} not in run ${params.id}`);

  const attemptNum = parseInt(params.attempt, 10);
  const attempt = taskResult.attempts.find((a) => a.attempt === attemptNum);
  if (!attempt) throw error(404, `attempt ${params.attempt} not in run ${params.id} task ${params.taskId}`);

  const tRes = await fetch(`/api/v1/transcripts/${attempt.transcript_key}`);
  if (!tRes.ok) throw error(tRes.status, 'transcript fetch failed');

  const apiCache = tRes.headers.get('cache-control');
  if (apiCache) setHeaders({ 'cache-control': apiCache });

  return {
    runId: params.id,
    taskId: params.taskId,
    attempt: attemptNum,
    passed: attempt.passed,
    score: attempt.score,
    model: run.model,
    transcript: (await tRes.json()) as Transcript,
  };
};
