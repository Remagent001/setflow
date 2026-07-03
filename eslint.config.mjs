// Minimal flat config: JS + TypeScript recommended rules across the monorepo.
// Kept deliberately light in Segment 00; tightened later as code grows.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/build/**",
      "**/.expo/**",
      "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Placeholder apps have empty-ish modules early on; don't fail on stubs.
      "@typescript-eslint/no-empty-object-type": "off",
    },
  }
);
