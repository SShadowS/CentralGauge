import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      routes: { include: ['/*'], exclude: ['<all>'] }
    }),
    alias: {
      '$lib': 'src/lib',
      '$lib/*': 'src/lib/*',
      '$shared': 'src/lib/shared',
      '$shared/*': 'src/lib/shared/*'
    },
    csrf: { checkOrigin: true },
    inlineStyleThreshold: 4096,
    output: { preloadStrategy: 'modulepreload' },
    prerender: {
      entries: ['/about'],
      // Routes /leaderboard, /models, /tasks, /compare, /search land in P5.2-5.5.
      // Until then, prerender crawl of /about would fail on Nav links to those
      // routes. Warn instead of erroring so the placeholder route can still ship.
      handleHttpError: 'warn'
    }
  }
};
