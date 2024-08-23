import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./__tests__/utils/setup-tests.ts"],
  },
  resolve: {
    alias: [
      {
        find: "@",
        replacement: resolve(__dirname, "./"),
      },
    ],
  },
});
