import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@mtk/database/lib/scoring-delivery": path.resolve(__dirname, "../../packages/database/src/lib/scoring-delivery.ts"),
      "@mtk/database/lib/live-scoring-state": path.resolve(__dirname, "../../packages/database/src/lib/live-scoring-state.ts"),
    },
  },
})
