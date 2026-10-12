import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    globalSetup: ["./src/services/__tests__/db/global-setup.ts"],
    // root所有のディレクトリや、テストに不要なディレクトリをスキャン対象から除外
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/dump/**",
      "**/.{git,cache,output,temp,wrangler}/**",
      "**/e2e/**",
      "**/vendor/**",
    ],
  },
  resolve: {
    alias: [
      { find: "@", replacement: resolve(__dirname, "./") },
      {
        find: "cloudflare:workers",
        replacement: resolve(
          __dirname,
          "./src/__tests__/cloudflare-workers.ts",
        ),
      },
    ],
  },
});
