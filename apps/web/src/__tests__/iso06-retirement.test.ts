import { readFileSync, readdirSync, statSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * ISO-06 (Batch 165): the retirement wellness pin. The legacy
 * `users.tenantIds` fallback has been write-disabled since Batch 138 and has
 * had no authorization reader since; Batch 165 removes the column from the
 * schema, drops it by LOCAL migration, and converts the last full-row
 * readers (the platform console) to explicit projections with a
 * platform-only users.role. This scan pins the retirement so no future
 * source change may reintroduce the array, the column, or league roles in
 * the platform console's users.role surface.
 */

const WEB_SRC = join(dirname(fileURLToPath(import.meta.url)), "..")
const WEB_APP = join(WEB_SRC, "..")
const ADMIN_SRC = join(WEB_APP, "..", "admin", "src")
const DB_SRC = join(WEB_APP, "..", "..", "packages", "database", "src")

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

/** Strip block and line comments so documentation MAY mention what code MAY NOT use. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
}

describe("ISO-06 (B165): the tenantIds array is retired from every production source", () => {
  // Repo-wide scans walk every production file on disk; give them an
  // explicit timeout instead of vitest's 5s default (they are IO-bound
  // and machine-speed dependent - both timed out on a cold cache).
  it("no non-test production source references users.tenantIds or the tenant_ids column", { timeout: 120_000 }, () => {
    for (const dir of [WEB_APP, ADMIN_SRC, DB_SRC]) {
      for (const file of walk(dir)) {
        const code = stripComments(readFileSync(file, "utf8"))
        expect(code, file).not.toMatch(/users\.tenantIds|\btenantIds\b|\btenant_ids\b/)
      }
    }
  })

  it("no full-row users select remains (explicit projections only)", { timeout: 120_000 }, () => {
    for (const dir of [WEB_APP, ADMIN_SRC]) {
      for (const file of walk(dir)) {
        const code = readFileSync(file, "utf8")
        expect(code, file).not.toMatch(/select\(\)\s*\.\s*from\(\s*users\s*\)/)
      }
    }
  })
})

describe("ISO-06 (B165): the platform console's users.role surface is platform-only", () => {
  const USERS_API_FILES = walk(join(ADMIN_SRC, "app", "api", "users")).filter((f) => f.endsWith("route.ts"))

  it("the console ships exactly the two platform-route files", () => {
    expect(USERS_API_FILES.length).toBe(2)
  })

  it("league roles can neither be read as filters nor written through users.role", () => {
    for (const file of USERS_API_FILES) {
      const code = readFileSync(file, "utf8")
      expect(code, file).not.toMatch(/["']league_owner["']/)
      expect(code, file).not.toMatch(/["']team_manager["']/)
      expect(code, file).not.toMatch(/["']coach["']/)
      expect(code, file).not.toMatch(/["']scorer["']/)
      expect(code, file).not.toMatch(/["']player["']/)
      expect(code, file).toMatch(/PLATFORM_ROLE|PLATFORM_ROLES/)
    }
  })

  it("the console grid no longer offers league roles in its role control", () => {
    const grid = readFileSync(join(ADMIN_SRC, "components", "users", "users-grid.tsx"), "utf8")
    expect(grid).toMatch(/const ROLES = \["super_admin", "fan"\] as const/)
    expect(grid).not.toMatch(/league_owner|team_manager|coach|scorer|player/)
  })

  it("the users schema no longer carries the tenantIds column", () => {
    const schema = readFileSync(join(DB_SRC, "schema", "users.ts"), "utf8")
    expect(schema).not.toMatch(/tenantIds:\s*uuid\(/)
    expect(schema).toMatch(/20261019160000/)
  })
})
