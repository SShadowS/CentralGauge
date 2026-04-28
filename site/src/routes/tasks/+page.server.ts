import type { PageServerLoad } from './$types';
import type { TasksIndexResponse } from '$shared/api-types';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ url, fetch, setHeaders, depends }) => {
  depends('app:tasks');

  const sp = new URLSearchParams();
  const set = url.searchParams.get('set') ?? 'current';
  sp.set('set', set);
  const cursor = url.searchParams.get('cursor');
  if (cursor) sp.set('cursor', cursor);
  const difficulty = url.searchParams.get('difficulty') ?? '';
  if (difficulty) sp.set('difficulty', difficulty);
  const category = url.searchParams.get('category') ?? '';
  if (category) sp.set('category', category);

  const res = await fetch(`/api/v1/tasks?${sp.toString()}`);
  if (!res.ok) {
    let body: unknown;
    try { body = await res.json(); } catch { body = {}; }
    throw error(res.status, (body as { error?: string }).error ?? 'tasks load failed');
  }

  const apiCache = res.headers.get('cache-control');
  if (apiCache) setHeaders({ 'cache-control': apiCache });

  return {
    tasks: (await res.json()) as TasksIndexResponse,
    filters: { set, difficulty, category },
    cursor,
  };
};
