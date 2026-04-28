import type { ShortcomingsIndexResponse } from '$shared/api-types';
import { passthroughLoader } from '$lib/server/loader-helpers';

export const load = passthroughLoader<ShortcomingsIndexResponse, 'shortcomings'>({
  depTag: 'app:shortcomings',
  fetchPath: '/api/v1/shortcomings',
  resultKey: 'shortcomings',
});
