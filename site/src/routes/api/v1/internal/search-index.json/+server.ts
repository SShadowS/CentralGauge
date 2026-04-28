import type { RequestHandler } from './$types';
import { getAll } from '$lib/server/db';
import { errorResponse } from '$lib/server/errors';

interface ModelRow { slug: string; display_name: string; family_slug: string; family_display: string; }
interface FamilyRow { slug: string; display_name: string; vendor: string; }
interface TaskRow { id: string; difficulty: string; }
interface RunRow { id: string; model_slug: string; model_display: string; started_at: string; }

const STATIC_PAGES = [
  { id: '/',             label: 'Home',            href: '/',             hint: 'leaderboard' },
  { id: '/models',       label: 'Models',          href: '/models',       hint: 'browse all' },
  { id: '/families',     label: 'Families',        href: '/families',     hint: 'by vendor' },
  { id: '/runs',         label: 'Runs',            href: '/runs',         hint: 'global feed' },
  { id: '/tasks',        label: 'Tasks',           href: '/tasks',        hint: 'benchmark suite' },
  { id: '/compare',      label: 'Compare',         href: '/compare',      hint: 'side-by-side' },
  { id: '/search',       label: 'Search',          href: '/search',       hint: 'failure messages' },
  { id: '/limitations',  label: 'Limitations',     href: '/limitations',  hint: 'shortcomings' },
  { id: '/about',        label: 'About',           href: '/about',        hint: 'methodology' },
] as const;

export const GET: RequestHandler = async ({ platform }) => {
  const env = platform!.env;
  try {
    const [models, families, tasks, runs] = await Promise.all([
      getAll<ModelRow>(env.DB,
        `SELECT m.slug, m.display_name, mf.slug AS family_slug, mf.display_name AS family_display
         FROM models m JOIN model_families mf ON mf.id = m.family_id
         ORDER BY mf.slug, m.slug`,
        []),
      getAll<FamilyRow>(env.DB,
        `SELECT slug, display_name, vendor FROM model_families ORDER BY slug`,
        []),
      getAll<TaskRow>(env.DB,
        `SELECT task_id AS id, difficulty FROM tasks
         WHERE task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)
         ORDER BY task_id LIMIT 500`,
        []),
      getAll<RunRow>(env.DB,
        `SELECT runs.id, m.slug AS model_slug, m.display_name AS model_display, runs.started_at
         FROM runs JOIN models m ON m.id = runs.model_id
         ORDER BY runs.started_at DESC LIMIT 50`,
        []),
    ]);

    const entries = [
      ...STATIC_PAGES.map((p) => ({ kind: 'page' as const, id: p.id, label: p.label, href: p.href, hint: p.hint })),
      ...families.map((f) => ({
        kind: 'family' as const,
        id: f.slug,
        label: f.display_name,
        href: `/families/${f.slug}`,
        hint: f.vendor,
      })),
      ...models.map((m) => ({
        kind: 'model' as const,
        id: m.slug,
        label: m.display_name,
        href: `/models/${m.slug}`,
        hint: m.family_display,
      })),
      ...tasks.map((t) => ({
        kind: 'task' as const,
        id: t.id,
        label: t.id,
        href: `/tasks/${t.id}`,
        hint: t.difficulty,
      })),
      ...runs.map((r) => ({
        kind: 'run' as const,
        id: r.id,
        label: r.id.slice(0, 12),
        href: `/runs/${r.id}`,
        hint: r.model_display,
      })),
    ];

    // no-store on the index. The 10 KB payload is fetched once per cmd-K
    // session via the `if (!index)` guard in CommandPalette, so shared-cache
    // benefit is minimal and freshness (newly-uploaded runs / catalog
    // changes) is critical. This also kills any `caches.default` poisoning
    // by adapter-cloudflare.
    return new Response(
      JSON.stringify({ generated_at: new Date().toISOString(), entries }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
      },
    );
  } catch (err) {
    return errorResponse(err);
  }
};
