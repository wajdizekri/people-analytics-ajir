import { defineConfig, configDefaults } from "vitest/config";
import path from "node:path";

// tests/security/* attaquent un serveur lancé à part (SEC_BASE_URL, défaut http://127.0.0.1:3300) : exclus de
// `npm test` sauf si SEC_BASE_URL est défini ; `npm run test:security` les lance seuls.
const withSecurity = !!process.env.SEC_BASE_URL || process.env.npm_lifecycle_event === "test:security";
const security = withSecurity ? [] : ["tests/security/**"];

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: [...configDefaults.exclude, ...security],
    testTimeout: 60000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/server-only-stub.ts"),
    },
  },
});
