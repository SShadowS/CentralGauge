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
      // 'warn' permits prerender crawl to skip 404s on Nav links not yet shipped:
      //   - /models (index)            — P5.3
      //   - /tasks (index + /:id)      — P5.3
      //   - /compare                   — P5.3
      //   - /search                    — P5.3
      //   - /runs (index)              — P5.2 ships /runs/:id but not /runs index
      // Switch to 'fail' once all Nav targets resolve (target: P5.4 polish).
      handleHttpError: 'warn'
    }
  }
};
