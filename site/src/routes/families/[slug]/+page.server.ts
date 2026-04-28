import type { FamilyDetail } from '$shared/api-types';
import { passthroughLoader } from '$lib/server/loader-helpers';

export const load = passthroughLoader<FamilyDetail, 'family'>({
  depTag: (params) => `app:family:${params.slug}`,
  fetchPath: (_url, params) => `/api/v1/families/${params.slug}`,
  resultKey: 'family',
});
