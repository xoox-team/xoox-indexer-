import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
    env: {
      ENVIO_CONFIG: fileURLToPath(
        new URL("./config.test.yaml", import.meta.url),
      ),
    },
    testTimeout: 15_000,
  },
});
