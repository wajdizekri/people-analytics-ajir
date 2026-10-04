import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Accès direct à la base réservé à lib/ (DAL et moteurs), aux scripts CLI, au worker et aux tests :
  // pages, composants, Route Handlers et proxy passent par src/lib/dal (AccessContext, périmètre, audit).
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    ignores: ["src/lib/**", "src/db/**", "src/worker/**", "scripts/**", "tests/**", "**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{ group: ["@/db/client", "**/db/client", "**/db/client.ts"], message: "Accès direct à la base interdit ici : passer par src/lib/dal." }],
        },
      ],
    },
  },
  // Scripts Node en CommonJS (ex. tests/security/gen-fixtures.cjs) : require() est la syntaxe du format
  { files: ["**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // Builds isolés (NEXT_DIST_DIR), sorties de tests et données locales
    ".next-*/**",
    "test-results/**",
    "playwright-report/**",
    "coverage/**",
    "data/**",
    "docs/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
