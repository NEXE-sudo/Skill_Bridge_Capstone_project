import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/*.config.js"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["client/src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    rules: { "@typescript-eslint/no-explicit-any": "warn" },
  },
  {
    files: ["server/src/**/*.ts"],
    languageOptions: { globals: globals.node },
    rules: { "@typescript-eslint/no-explicit-any": "warn" },
  },
);
