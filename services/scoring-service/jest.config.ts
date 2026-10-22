import type { Config } from "jest";

const config: Config = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": ["ts-jest", { tsconfig: {
      paths: {
        "@mtk/database": ["../../packages/database/src/index.ts"],
        "@mtk/database/*": ["../../packages/database/src/*"],
        // Batch 100: @mtk/contracts emits an ESM-only dist, which CJS jest
        // cannot load ("Unexpected token 'export'"). Map it to workspace
        // source like @mtk/database, so the suites exercise source and the
        // run never depends on a generated build.
        "@mtk/contracts": ["../../packages/contracts/src/index.ts"],
        "@mtk/contracts/*": ["../../packages/contracts/src/*"],
      },
    } }],
  },
  collectCoverageFrom: ["src/**/*.(t|j)s"],
  coverageDirectory: "./coverage",
  testEnvironment: "node",
  // Tests exercise workspace source without rebuilding generated declarations.
  moduleNameMapper: {
    "^@mtk/database$": "<rootDir>/../../packages/database/src/index.ts",
    "^@mtk/database/(.*)$": "<rootDir>/../../packages/database/src/$1",
    "^@mtk/contracts$": "<rootDir>/../../packages/contracts/src/index.ts",
    "^@mtk/contracts/(.*)$": "<rootDir>/../../packages/contracts/src/$1",
  },
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};

export default config;
