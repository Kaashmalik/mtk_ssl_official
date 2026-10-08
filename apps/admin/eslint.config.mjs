import { FlatCompat } from "@eslint/eslintrc";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooksPlugin from "eslint-plugin-react-hooks";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

/**
 * react-hooks v6 `recommended` enables the React Compiler lint rules
 * (static-components, purity, refs, set-state-in-effect, ...). This codebase is
 * not compiler-ready, so those are disabled wholesale and only the two
 * long-standing rules stay active.
 */
const reactHooksRules = Object.fromEntries(
  Object.keys(reactHooksPlugin.configs.recommended.rules).map((rule) => [rule, "off"]),
);
reactHooksRules["react-hooks/rules-of-hooks"] = "error";
reactHooksRules["react-hooks/exhaustive-deps"] = "warn";

export default [
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "public/**"],
  },
  {
    // `next build` detects the plugin via calculateConfigForFile() on this
    // config file first (package.json second). Neither matched any explicit
    // `files` block before, leaving the plugin "undetected" during builds.
    // The config file must therefore stay out of `ignores`.
    files: ["eslint.config.mjs"],
    plugins: {
      "@next/next": nextPlugin,
    },
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      ...reactHooksRules,
      "@typescript-eslint/no-explicit-any": "off",
      "react/no-unescaped-entities": "off",
      "@next/next/no-img-element": "off",
    },
  },
];
