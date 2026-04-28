import type { PageServerLoad } from './$types';
import type { ModelsIndexResponse } from '$shared/api-types';
import { passthroughLoader } from '$lib/server/loader-helpers';

const inner = passthroughLoader<ModelsIndexResponse, 'models'>({
  depTag: 'app:models',
  fetchPath: '/api/v1/models',
  resultKey: 'models',
});

export const load: PageServerLoad = async (event) => ({
  ...(await inner(event)),
  filters: {
    family:   event.url.searchParams.get('family') ?? '',
    has_runs: event.url.searchParams.get('has_runs') ?? '',
  },
});
