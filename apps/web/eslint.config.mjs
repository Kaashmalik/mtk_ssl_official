import nextPlugin from "@next/eslint-plugin-next";
import nextTsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactHooksPlugin from "eslint-plugin-react-hooks";

/**
 * Flat ESLint config for the web app.
 *
 * The Next.js plugin is registered explicitly (rather than through
 * FlatCompat) because `next build` verifies the plugin is present by looking it
 * up in the flat config — going through the compat shim left it undetected,
 * which produced a build-time warning while silently skipping Next's rules.
 */
// react-hooks v6 `recommended` enables the React Compiler lint rules
// (static-components, purity, refs, set-state-in-effect, ...). This codebase is
// not compiler-ready, so those are disabled wholesale and only the two
// long-standing rules stay active.
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
    // config file first (and package.json second). Neither matched any
    // explicit `files` block before, which left the plugin "undetected" and
    // Next's own rules skipped during builds. Registering it here makes
    // detection succeed; this block must NOT stay in `ignores` for the same
    // reason.
    files: ["eslint.config.mjs"],
    plugins: {
      "@next/next": nextPlugin,
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@next/next": nextPlugin,
      "@typescript-eslint": nextTsPlugin,
      "react-hooks": reactHooksPlugin,
    },
    rules: {
      // Next.js recommended + core-web-vitals.
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,

      // React Hooks (see reactHooksRules above).
      ...reactHooksRules,

      // TypeScript
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Config files are CommonJS. The TS plugin is registered here too so
    // file-level disables such as `no-require-imports` resolve instead of
    // erroring as an unknown rule.
    files: ["**/*.{js,cjs,mjs}"],
    plugins: {
      "@typescript-eslint": nextTsPlugin,
    },
    rules: {
      "@typescript-eslint/no-require-imports": "error",
    },
  },
];
