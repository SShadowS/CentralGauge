import type { PageServerLoad } from './$types';
import type { RunsListResponse } from '$shared/api-types';
import { passthroughLoader } from '$lib/server/loader-helpers';

const inner = passthroughLoader<RunsListResponse>({
  depTag: 'app:runs',
  fetchPath: '/api/v1/runs',
  forwardParams: ['cursor', 'limit', 'tier', 'task_set', 'since', 'model'],
  resultKey: 'runs',
});

export const load: PageServerLoad = async (event) => ({
  ...(await inner(event)),
  filters: {
    model:    event.url.searchParams.get('model') ?? '',
    tier:     event.url.searchParams.get('tier') ?? '',
    task_set: event.url.searchParams.get('task_set') ?? '',
    since:    event.url.searchParams.get('since') ?? '',
  },
  cursor: event.url.searchParams.get('cursor'),
});
