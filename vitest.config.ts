import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: process.cwd(),
  test: {
    environment: "jsdom",
    setupFiles: [
      fileURLToPath(new URL("./tests/setup.ts", import.meta.url)),
      fileURLToPath(new URL("./apps/dashboard/src/test-setup.ts", import.meta.url))
    ]
  }
});
