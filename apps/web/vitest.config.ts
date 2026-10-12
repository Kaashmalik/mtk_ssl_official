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
      { find: /^@mtk\/database\//, replacement: path.resolve(__dirname, "../../packages/database/src") + "/" },
      { find: /^@mtk\/ui\//, replacement: path.resolve(__dirname, "../../packages/ui/src") + "/" },
    ],
  },
})
