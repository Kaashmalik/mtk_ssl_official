import { describe, expect, it } from "vitest"
import { getTableConfig } from "drizzle-orm/pg-core"
import { readFileSync } from "node:fs"
import { users } from "../schema/users"

const migration = readFileSync(new URL("../../../../supabase/migrations/20261018120000_users_display_time_zone.sql", import.meta.url), "utf8")

describe("User display timezone schema and migration contract (UX-03, not real SQL execution)", () => {
  it("carries a nullable text time_zone column - null means the UTC-labelled fallback", () => {
    const config = getTableConfig(users)
    const column = config.columns.find((c) => c.name === "time_zone")
    expect(column).toBeDefined()
    // Nullable by design: unset = explicit UTC label, never the server's zone.
    expect(column?.notNull).toBe(false)
    expect(column?.hasDefault).toBe(false)
  })

  it("keeps the migration additive, idempotent and non-destructive", () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "time_zone" text')
    expect(migration).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE|SET NOT NULL/i)
    // Personal surface: no RLS changes - the users table's own policy set governs.
    expect(migration).not.toMatch(/ENABLE ROW LEVEL SECURITY|GRANT /)
  })
})
