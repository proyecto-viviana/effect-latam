import { defineConfig } from "vite-plus";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/solid-start/plugin/vite";
import viteSolid from "@solidjs/vite-plugin";

const toolIgnorePatterns = [
  ".wrangler/**",
  ".tanstack/**",
  ".vite-hooks/**",
  "dist/**",
  "drizzle/**",
  "node_modules/**",
  "public/**",
  "content/**",
  "output/**",
  "src/routeTree.gen.ts",
  "worker-configuration.d.ts",
];

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: toolIgnorePatterns,
  },
  lint: {
    ignorePatterns: toolIgnorePatterns,
  },
  resolve: {
    tsconfigPaths: true,
    alias: {
      "react/jsx-dev-runtime": "@solidjs/web/jsx-dev-runtime",
      "react/jsx-runtime": "@solidjs/web/jsx-runtime",
    },
    dedupe: ["solid-js", "@solidjs/web", "@tanstack/solid-router", "@tanstack/router-core"],
  },
  server: {
    port: 4177,
  },
  build: {
    rolldownOptions: {
      checks: {
        pluginTimings: false,
      },
    },
  },
  ssr: {
    optimizeDeps: {
      exclude: ["solid-js", "@solidjs/web"],
    },
    noExternal: true,
  },
  plugins: [
    tanstackStart(),
    viteSolid({ ssr: true }),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
  ],
});
