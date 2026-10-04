import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Integration files share one database; global maintenance cases delete shared tables.
    fileParallelism: false,
    include: ["tests/integration/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    setupFiles: ["./tests/setup/integration.ts"],
  },
});
