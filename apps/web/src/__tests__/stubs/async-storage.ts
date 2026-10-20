/**
 * Vitest stub for @react-native-async-storage/async-storage (native module).
 * aliases in apps/web/vitest.config.ts point here so suites can exercise
 * mobile-source zustand stores (offline-store) in the node environment.
 */
const memory = new Map<string, string>()

const AsyncStorage = {
  getItem: async (key: string) => memory.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    memory.set(key, value)
  },
  removeItem: async (key: string) => {
    memory.delete(key)
  },
  clear: async () => {
    memory.clear()
  },
}

export default AsyncStorage
