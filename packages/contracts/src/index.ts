/**
 * ENH-03-01 (@mtk/contracts): the portable cross-platform vocabulary.
 *
 * Explicit exports only. This package must stay dependency-free apart from
 * the validator, with no Next/DOM/native/database/server-secret imports —
 * the boundary test in src/__tests__/boundary.test.ts enforces it.
 */
export * from "./scoring";
export * from "./public-reads";
export * from "./capabilities";
