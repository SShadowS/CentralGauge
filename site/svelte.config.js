import adapter from "@sveltejs/adapter-cloudflare";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      routes: { include: ["/*"], exclude: ["<all>"] },
    }),
    alias: {
      "$lib": "src/lib",
      "$lib/*": "src/lib/*",
      "$shared": "src/lib/shared",
      "$shared/*": "src/lib/shared/*",
    },
    csrf: { checkOrigin: true },
    inlineStyleThreshold: 4096,
    output: { preloadStrategy: "modulepreload" },
    prerender: {
      entries: ["/about"],
      // P5.3 lands every Nav target — `/models`, `/runs`, `/tasks`,
      // `/compare`, `/search`, `/families`, `/limitations`. Re-arm strict
      // mode so any future broken Nav link fails CI.
      handleHttpError: "fail",
    },
  },
};
