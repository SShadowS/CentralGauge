import { ImageResponse } from '@cf-wasm/og';
import { read } from '$app/server';

// Vendored fonts. Vite's `?url` suffix returns a string URL; SvelteKit's
// `$app/server` `read()` then resolves that URL to a Response from the
// adapter's static asset map. This works in production (Cloudflare
// Workers ASSETS binding), in `vite preview`, and in vitest-pool-workers.
//
// We tried plain module-init `fetch(url).then(r => r.arrayBuffer())`:
// works in dev and prod CDN, but fails in the worker pool tests because
// the URL `/_app/immutable/assets/inter-400.<hash>.ttf` is relative —
// fetch in a worker isolate without a base URL throws "Invalid URL".
// `read()` doesn't need a base URL; it goes through the adapter.
//
// Vite has NO `?arraybuffer` suffix (built-ins are ?raw, ?inline, ?url,
// ?worker, ?sharedworker, ?no-inline) — `?url` + `read()` is the
// simplest correct alternative. No custom plugin, no base64 decode.
//
// Lifetime: the promise resolves on the FIRST OG request per worker
// isolate. Subsequent requests in the same isolate reuse the resolved
// ArrayBuffer (the promise is already settled). Cold-start cost: one
// extra read per isolate, ~1-5 ms.
import inter400Url from './fonts/inter-400.ttf?url';
import inter600Url from './fonts/inter-600.ttf?url';

let fontsPromise: Promise<Array<{
  name: string;
  data: ArrayBuffer;
  weight: 400 | 600;
  style: 'normal';
}>> | null = null;

function getFonts() {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      read(inter400Url).arrayBuffer(),
      read(inter600Url).arrayBuffer(),
    ]).then(([d400, d600]) => [
      { name: 'Inter', data: d400, weight: 400 as const, style: 'normal' as const },
      { name: 'Inter', data: d600, weight: 600 as const, style: 'normal' as const },
    ]);
  }
  return fontsPromise;
}

const CACHE_VERSION = 'v1';
const SWR_HEADER = 'public, max-age=60, stale-while-revalidate=86400';

export type OgKind = 'index' | 'model' | 'run' | 'family';

export type OgPayload =
  | { kind: 'index'; modelCount: number; runCount: number; lastRunAt: string }
  | { kind: 'model'; displayName: string; familySlug: string; avgScore: number; runCount: number }
  | { kind: 'run'; modelDisplay: string; tasksPassed: number; tasksTotal: number; tier: string; ts: string }
  | { kind: 'family'; displayName: string; vendor: string; modelCount: number; topModelDisplay: string };

export interface OgRenderOpts {
  kind: OgKind;
  slug?: string;
  taskSetHash?: string;
  blobs: R2Bucket;
  payload: OgPayload;
}

export interface OgRenderResult {
  body: ArrayBuffer;
  contentType: 'image/png';
  cacheControl: typeof SWR_HEADER;
  cacheHit: boolean;
}

export async function renderOgPng(opts: OgRenderOpts): Promise<OgRenderResult> {
  const slugPart = opts.slug ?? '_';
  const tsPart = opts.taskSetHash ?? 'unknown';
  // Include a payload-content hash so that, e.g., a model display-name
  // rename (display_name: "Claude Sonnet 4.7" → "Sonnet 4.7") triggers a
  // fresh render instead of serving the stale cached image. The
  // task-set hash alone doesn't change when only display strings move.
  const payloadHash = await hashPayload(opts.payload);
  const key = `og/${CACHE_VERSION}/${opts.kind}/${slugPart}/${tsPart}/${payloadHash}.png`;

  // 1. Cache lookup.
  const cached = await opts.blobs.get(key);
  if (cached) {
    const body = await cached.arrayBuffer();
    return { body, contentType: 'image/png', cacheControl: SWR_HEADER, cacheHit: true };
  }

  // 2. Cache miss — render fresh. The font ArrayBuffers are loaded once
  //    per isolate via getFonts() (see lifetime note above).
  const fonts = await getFonts();
  const jsx = renderJsxForPayload(opts.payload);
  const response = new ImageResponse(jsx, {
    width: 1200,
    height: 630,
    fonts,
  });
  const body = await response.arrayBuffer();

  // 3. Store inline (NOT ctx.waitUntil). Inline put guarantees the next
  // request — and tests — observe the entry deterministically (per
  // CLAUDE.md "await cache.put inline" rule).
  await opts.blobs.put(key, body);

  return { body, contentType: 'image/png', cacheControl: SWR_HEADER, cacheHit: false };
}

// JSX is the @cf-wasm/og DSL. We hand-build VNodes (no JSX runtime
// configured) so the worker bundle doesn't pull in @vercel/og's React
// runtime. Each layout is a small composition of div/span/h1/p with
// inline styles using design-token-equivalent values.
//
// Design tokens are duplicated here as literal hex codes because:
//   (a) tokens.css runs in the BROWSER, not the OG renderer,
//   (b) Satori's CSS support is partial and `var(--foo)` is unsupported,
//   (c) the OG palette is a subset of the design tokens (only `--bg`,
//       `--text`, `--text-muted`, `--accent`, `--border`).
const COLORS = {
  bg: '#ffffff',
  text: '#0a0a0a',
  muted: '#525252',
  accent: '#0a4dff',
  border: '#e5e5e5',
};

function renderJsxForPayload(payload: OgPayload): unknown {
  switch (payload.kind) {
    case 'index': return renderIndexCard(payload);
    case 'model': return renderModelCard(payload);
    case 'run':   return renderRunCard(payload);
    case 'family': return renderFamilyCard(payload);
    default: {
      // Exhaustiveness guard — adding a new OgPayload variant without
      // updating this switch fails typecheck.
      const _exhaustive: never = payload;
      throw new Error(`Unhandled OG payload kind: ${(_exhaustive as { kind: string }).kind}`);
    }
  }
}

// VNode helpers — Satori accepts a tree of {type, props, children}.
function div(style: Record<string, string | number>, children?: unknown): unknown {
  return { type: 'div', props: { style, children } };
}
function span(style: Record<string, string | number>, text: string): unknown {
  return { type: 'span', props: { style, children: text } };
}

function shellStyle(): Record<string, string | number> {
  return {
    width: '1200px', height: '630px',
    display: 'flex', flexDirection: 'column',
    background: COLORS.bg,
    color: COLORS.text,
    fontFamily: 'Inter',
    padding: '64px',
    boxSizing: 'border-box',
  };
}

function renderIndexCard(p: Extract<OgPayload, { kind: 'index' }>): unknown {
  return div(shellStyle(), [
    span({ fontSize: 32, color: COLORS.accent, fontWeight: 600, letterSpacing: '-0.01em' }, 'CentralGauge'),
    span({ fontSize: 64, fontWeight: 600, marginTop: 24, lineHeight: 1.1 }, 'LLM AL/BC Benchmark'),
    span({ fontSize: 24, color: COLORS.muted, marginTop: 16 }, 'Reproducible. Signed. Open.'),
    div({ display: 'flex', gap: '64px', fontSize: 28, flex: 1, alignItems: 'flex-end' }, [
      div({ display: 'flex', flexDirection: 'column' }, [
        span({ color: COLORS.muted, fontSize: 18 }, 'Models tracked'),
        span({ fontWeight: 600, fontSize: 36 }, String(p.modelCount)),
      ]),
      div({ display: 'flex', flexDirection: 'column' }, [
        span({ color: COLORS.muted, fontSize: 18 }, 'Total runs'),
        span({ fontWeight: 600, fontSize: 36 }, String(p.runCount)),
      ]),
    ]),
  ]);
}

function renderModelCard(p: Extract<OgPayload, { kind: 'model' }>): unknown {
  return div(shellStyle(), [
    span({ fontSize: 24, color: COLORS.accent }, 'CentralGauge · Model'),
    span({ fontSize: 72, fontWeight: 600, marginTop: 24, lineHeight: 1.1 }, p.displayName),
    span({ fontSize: 28, color: COLORS.muted, marginTop: 8 }, p.familySlug),
    div({ display: 'flex', gap: '64px', fontSize: 28, flex: 1, alignItems: 'flex-end' }, [
      div({ display: 'flex', flexDirection: 'column' }, [
        span({ color: COLORS.muted, fontSize: 18 }, 'Avg score'),
        span({ fontWeight: 600, fontSize: 48 }, (p.avgScore * 100).toFixed(1) + '%'),
      ]),
      div({ display: 'flex', flexDirection: 'column' }, [
        span({ color: COLORS.muted, fontSize: 18 }, 'Runs'),
        span({ fontWeight: 600, fontSize: 48 }, String(p.runCount)),
      ]),
    ]),
  ]);
}

function renderRunCard(p: Extract<OgPayload, { kind: 'run' }>): unknown {
  const pct = p.tasksTotal > 0 ? ((p.tasksPassed / p.tasksTotal) * 100).toFixed(0) : '0';
  return div(shellStyle(), [
    span({ fontSize: 24, color: COLORS.accent }, 'CentralGauge · Run'),
    span({ fontSize: 56, fontWeight: 600, marginTop: 24, lineHeight: 1.1 }, p.modelDisplay),
    span({ fontSize: 24, color: COLORS.muted, marginTop: 8 }, `${p.tier} · ${formatTs(p.ts)}`),
    div({ display: 'flex', gap: '64px', fontSize: 28, flex: 1, alignItems: 'flex-end' }, [
      div({ display: 'flex', flexDirection: 'column' }, [
        span({ color: COLORS.muted, fontSize: 18 }, 'Tasks passed'),
        span({ fontWeight: 600, fontSize: 56 }, `${p.tasksPassed}/${p.tasksTotal}`),
      ]),
      div({ display: 'flex', flexDirection: 'column' }, [
        span({ color: COLORS.muted, fontSize: 18 }, 'Pass rate'),
        span({ fontWeight: 600, fontSize: 56 }, `${pct}%`),
      ]),
    ]),
  ]);
}

function renderFamilyCard(p: Extract<OgPayload, { kind: 'family' }>): unknown {
  return div(shellStyle(), [
    span({ fontSize: 24, color: COLORS.accent }, 'CentralGauge · Family'),
    span({ fontSize: 72, fontWeight: 600, marginTop: 24, lineHeight: 1.1 }, p.displayName),
    span({ fontSize: 28, color: COLORS.muted, marginTop: 8 }, p.vendor),
    div({ display: 'flex', gap: '64px', fontSize: 28, flex: 1, alignItems: 'flex-end' }, [
      div({ display: 'flex', flexDirection: 'column' }, [
        span({ color: COLORS.muted, fontSize: 18 }, 'Models'),
        span({ fontWeight: 600, fontSize: 48 }, String(p.modelCount)),
      ]),
      div({ display: 'flex', flexDirection: 'column' }, [
        span({ color: COLORS.muted, fontSize: 18 }, 'Top'),
        span({ fontWeight: 600, fontSize: 36 }, p.topModelDisplay),
      ]),
    ]),
  ]);
}

function formatTs(iso: string): string {
  // Render YYYY-MM-DD; OG cards prefer dense data.
  return iso.slice(0, 10);
}

/**
 * 12-hex-char SHA-256 prefix of the canonical-stringified payload. Cheap
 * to compute (~50 µs per call); produces a stable, file-system-safe
 * cache-key suffix that flips when ANY rendered field changes.
 */
async function hashPayload(payload: OgPayload): Promise<string> {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 12);
}
