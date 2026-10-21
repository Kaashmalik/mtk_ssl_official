import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    // Exercise workspace schema/source without a build or stale dist columns.
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      { find: /^@mtk\/database$/, replacement: path.resolve(__dirname, "../../packages/database/src/index.ts") },
      { find: /^@mtk\/database\/$/, replacement: path.resolve(__dirname, "../../packages/database/src") + "/" },
      { find: /^@mtk\/contracts$/, replacement: path.resolve(__dirname, "../../packages/contracts/src/index.ts") },
      { find: /^@mtk\/ui\//, replacement: path.resolve(__dirname, "../../packages/ui/src") + "/" },
      // Native modules from apps/mobile source exercised in tests: the
      // storage engine behind the persisted offline store (offline-sync
      // barrier suite) is a no-op in-memory implementation.
      { find: /^@react-native-async-storage\/async-storage$/, replacement: path.resolve(__dirname, "./src/__tests__/stubs/async-storage.ts") },
    ],
  },
})
