import type { FamiliesIndexResponse } from '$shared/api-types';
import { passthroughLoader } from '$lib/server/loader-helpers';

export const load = passthroughLoader<FamiliesIndexResponse, 'families'>({
  depTag: 'app:families',
  fetchPath: '/api/v1/families',
  resultKey: 'families',
});
