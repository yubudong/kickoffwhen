import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    ".superpowers/**",
    ".next-e2e/**",
    ".next-todo-preview/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);
