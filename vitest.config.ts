import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // root所有のディレクトリや、テストに不要なディレクトリをスキャン対象から除外
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/dump/**",
      "**/.{git,cache,output,temp,wrangler}/**",
      "**/e2e/**",
    ],
    projects: [
      {
        extends: true,
        test: {
          name: "server",
          exclude: ["web/**"],
          globalSetup: ["./src/services/__tests__/db/global-setup.ts"],
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
      },
      {
        extends: "./web/vite.config.ts",
        test: {
          name: "web",
          root: __dirname,
          environment: "node",
          globals: true,
          include: ["web/src/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
});
