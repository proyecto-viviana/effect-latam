import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    globals: true,
    environment: "node",
  },
});
