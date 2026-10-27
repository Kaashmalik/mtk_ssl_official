import tsParser from "@typescript-eslint/parser";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "eslint.config.mjs"],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {
      "no-unused-vars": "off",
      // chat.ts deliberately matches control characters to strip invisible /
      // bidi text from messages; it carries a targeted disable directive.
      "no-control-regex": "error",
    },
  },
];
