import { describe, expect, it } from "vitest"
import { getTableConfig } from "drizzle-orm/pg-core"
import { readFileSync } from "node:fs"
import { matchPlayingXis } from "../schema/match-playing-xis"
import { matches } from "../schema/matches"

const migration = readFileSync(new URL("../../../../supabase/migrations/20261017090000_playing_xi_declaration.sql", import.meta.url), "utf8")

describe("Playing-XI migration and schema contracts (not real SQL execution)", () => {
  it("stores one immutable declared row per match side and player with a batting order", () => {
    expect(matchPlayingXis.matchId.name).toBe("match_id")
    expect(matchPlayingXis.tenantId.name).toBe("tenant_id")
    expect(matchPlayingXis.teamId.name).toBe("team_id")
    expect(matchPlayingXis.playerId.name).toBe("player_id")
    expect(matchPlayingXis.battingOrder.name).toBe("batting_order")
    expect(matchPlayingXis.declaredBy.name).toBe("declared_by")
    expect(matchPlayingXis.supersededAt.name).toBe("superseded_at")
    expect(getTableConfig(matchPlayingXis).name).toBe("match_playing_xis")
    expect(getTableConfig(matchPlayingXis).checks.map(check => check.name)).toContain("match_playing_xis_order_check")
  })

  it("binds rows to the same-league match and team with composite foreign keys", () => {
    // Four total: the two column-level references (player, declaring user)
    // plus the two named composite bindings.
    const fkNames = getTableConfig(matchPlayingXis).foreignKeys.map(fk => fk.getName())
    expect(fkNames).toContain("match_playing_xis_match_tenant_fk")
    expect(fkNames).toContain("match_playing_xis_team_tenant_fk")
    expect(migration).toContain("match_playing_xis_match_tenant_fk")
    expect(migration).toContain("match_playing_xis_team_tenant_fk")
    expect(migration).toContain("REFERENCES public.matches(id, tenant_id) ON DELETE CASCADE")
    expect(migration).toContain("REFERENCES public.teams(id, tenant_id) ON DELETE CASCADE")
    // The same-league team binding mirrors the outbox batch's matches binding.
    expect(migration).toContain("teams_id_tenant_key UNIQUE (id, tenant_id)")
  })

  it("declares the active-row uniqueness and lookup indexes", () => {
    const indexNames = getTableConfig(matchPlayingXis).indexes.map(index => index.config.name)
    expect(indexNames).toContain("match_playing_xis_active_player_key")
    expect(indexNames).toContain("match_playing_xis_active_order_key")
    expect(indexNames).toContain("match_playing_xis_active_idx")
    expect(migration.match(/WHERE superseded_at IS NULL/g)).toHaveLength(3)
  })

  it("arms the gate with legacy-safe defaults on matches", () => {
    expect(matches.xiRequired.name).toBe("xi_required")
    expect(matches.xiRequired.default).toBe(false)
    expect(matches.xiRequired.notNull).toBe(true)
    expect(matches.xiApprovedAt.name).toBe("xi_approved_at")
    expect(matches.xiApprovedAt.default).toBeUndefined()
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS xi_required boolean NOT NULL DEFAULT false")
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS xi_approved_at timestamptz")
  })

  it("keeps declared XI history off the public internet and deletes nothing", () => {
    expect(migration).toContain("ALTER TABLE public.match_playing_xis ENABLE ROW LEVEL SECURITY")
    expect(migration).toContain("FORCE ROW LEVEL SECURITY")
    expect(migration).toContain("REVOKE ALL ON public.match_playing_xis FROM PUBLIC, anon, authenticated")
    expect(migration).not.toMatch(/GRANT.*TO\s+(anon|authenticated)/i)
    expect(migration).not.toMatch(/GRANT DELETE/)
    expect(migration).toContain("BEGIN;")
    expect(migration.trim()).toMatch(/COMMIT;$/)
    expect(migration).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE/i)
    expect(migration).toContain("IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssl')")
    expect(migration).toContain("IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')")
  })
})
