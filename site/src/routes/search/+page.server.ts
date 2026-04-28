import type { PageServerLoad } from './$types';
import type { SearchResponse } from '$shared/api-types';
import { error } from '@sveltejs/kit';
import { passthroughLoader } from '$lib/server/loader-helpers';

const inner = passthroughLoader<SearchResponse, 'results'>({
  depTag: (_p) => 'app:search', // overridden per-call below via depends() once q is known
  fetchPath: '/api/v1/search',
  forwardParams: ['q', 'cursor'],
  resultKey: 'results',
});

export const load: PageServerLoad = async (event) => {
  const q = (event.url.searchParams.get('q') ?? '').trim();
  event.depends(`app:search:${q}`);

  if (!q) {
    return { query: '', results: null };
  }
  if (q.length > 200) {
    throw error(400, 'q must be ≤ 200 chars');
  }

  return {
    query: q,
    ...(await inner(event)),
  };
};
