import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  // ?url is built-in (Vite 5+); returns the asset URL as a string. No
  // assetsInclude needed — TTF is recognized as an asset automatically.
  build: {
    rollupOptions: {
      output: {
        // Force a stable chunk name for boundary modules so the
        // bundle-budget glob bites. Default chunkFileNames is
        // 'chunks/[hash].js' which produces unmatchable names.
        chunkFileNames: (chunkInfo) => {
          // Use a name-prefixed pattern when the chunk has a recognizable
          // module ID; fall back to the hash-only default otherwise.
          const facade = chunkInfo.facadeModuleId ?? '';
          if (facade.includes('CommandPalette')) {
            return 'chunks/cmd-k-[hash].js';
          }
          if (facade.includes('use-event-source')) {
            return 'chunks/use-event-source-[hash].js';
          }
          return 'chunks/[hash].js';
        },
        manualChunks: (id) => {
          if (id.includes('CommandPalette')) return 'cmd-k';
          if (id.includes('use-event-source')) return 'use-event-source';
          return null;
        },
      },
    },
  },
});
