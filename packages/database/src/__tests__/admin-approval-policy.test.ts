import { describe, expect, it } from "vitest"
import { getTableConfig } from "drizzle-orm/pg-core"
import { readFileSync } from "node:fs"
import { adminActionApprovals } from "../schema/admin-action-approvals"
import {
  ADMIN_APPROVAL_TTL_HOURS,
  approvalExpiry,
  evaluateApprovalDecision,
  normalizeApprovalReason,
  parseApprovalDecision,
} from "../lib/admin-approval-policy"

const migration = readFileSync(new URL("../../../../supabase/migrations/20261026120000_admin_action_approvals.sql", import.meta.url), "utf8")

const NOW = new Date("2026-10-26T12:00:00Z")
const REQUESTER = "11111111-1111-4111-8111-111111111111"
const SECOND_ADMIN = "22222222-2222-4222-8222-222222222222"
const pending = { status: "pending", requestedBy: REQUESTER, expiresAt: approvalExpiry(NOW) }

describe("two-person approval policy", () => {
  it("never lets the requester approve or reject their own request", () => {
    for (const decision of ["approve", "reject"] as const) {
      const verdict = evaluateApprovalDecision(pending, REQUESTER, decision, NOW)
      expect(verdict).toMatchObject({ ok: false, status: 403 })
    }
  })

  it("lets a second admin approve (executes) or reject", () => {
    expect(evaluateApprovalDecision(pending, SECOND_ADMIN, "approve", NOW)).toEqual({ ok: true, nextStatus: "executed" })
    expect(evaluateApprovalDecision(pending, SECOND_ADMIN, "reject", NOW)).toEqual({ ok: true, nextStatus: "rejected" })
  })

  it("reserves cancel for the requester", () => {
    expect(evaluateApprovalDecision(pending, REQUESTER, "cancel", NOW)).toEqual({ ok: true, nextStatus: "cancelled" })
    expect(evaluateApprovalDecision(pending, SECOND_ADMIN, "cancel", NOW)).toMatchObject({ ok: false, status: 403 })
  })

  it("refuses decided requests and expired requests", () => {
    for (const status of ["executed", "rejected", "cancelled", "expired"]) {
      expect(evaluateApprovalDecision({ ...pending, status }, SECOND_ADMIN, "approve", NOW)).toMatchObject({ ok: false, status: 409 })
    }
    const atExpiry = new Date(NOW.getTime() + ADMIN_APPROVAL_TTL_HOURS * 3_600_000)
    expect(evaluateApprovalDecision(pending, SECOND_ADMIN, "approve", atExpiry)).toMatchObject({ ok: false, status: 410 })
  })

  it("requires a real reason and a known decision", () => {
    expect(normalizeApprovalReason("  league closed by owner request  ")).toBe("league closed by owner request")
    expect(normalizeApprovalReason("too short")).toBeNull()
    expect(normalizeApprovalReason("x".repeat(1001))).toBeNull()
    expect(normalizeApprovalReason(42)).toBeNull()
    expect(parseApprovalDecision("approve")).toBe("approve")
    expect(parseApprovalDecision("APPROVE")).toBeNull()
    expect(parseApprovalDecision(undefined)).toBeNull()
  })
})

describe("admin_action_approvals schema and migration contracts (not real SQL execution)", () => {
  it("declares the second-person rule in the database, not only in code", () => {
    const checks = getTableConfig(adminActionApprovals).checks.map(check => check.name).sort()
    expect(checks).toEqual([
      "admin_action_approvals_action_check",
      "admin_action_approvals_reason_check",
      "admin_action_approvals_second_person_check",
      "admin_action_approvals_status_check",
    ])
    expect(migration).toContain("CHECK (status <> 'executed' OR (decided_by IS NOT NULL AND decided_by <> requested_by))")
  })

  it("keeps the evidence row when its target league is deleted", () => {
    const fks = getTableConfig(adminActionApprovals).foreignKeys.map(fk => fk.reference().columns.map(c => c.name)).flat()
    expect(fks).not.toContain("target_tenant_id")
    expect(migration).toMatch(/target_tenant_id uuid NOT NULL,/)
    expect(migration).not.toMatch(/target_tenant_id[^,]*REFERENCES/)
  })

  it("allows one open request per action and target", () => {
    const pendingKey = getTableConfig(adminActionApprovals).indexes.find(index => index.config.name === "admin_action_approvals_pending_key")
    expect(pendingKey?.config.unique).toBe(true)
    expect(pendingKey?.config.where).toBeDefined()
    expect(migration).toContain("WHERE status = 'pending'")
  })

  it("is additive, idempotent and closed to PostgREST clients", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.admin_action_approvals")
    expect(migration).toContain("BEGIN;")
    expect(migration.trim()).toMatch(/COMMIT;$/)
    expect(migration).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE/i)
    expect(migration).toContain("FORCE ROW LEVEL SECURITY")
    expect(migration).not.toMatch(/GRANT[\s\S]*?TO\s+anon/i)
    expect(migration).not.toMatch(/GRANT[\s\S]*?TO\s+authenticated/i)
    // Evidence rows are never deleted by the application.
    expect(migration).not.toMatch(/GRANT[^;]*DELETE[^;]*admin_action_approvals/i)
  })
})
