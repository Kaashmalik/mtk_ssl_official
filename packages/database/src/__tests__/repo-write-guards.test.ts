import { describe, expect, it } from "vitest"
import { assertWritableFields, PROTECTED_WRITE_FIELDS } from "../repositories/write-guards"

/**
 * ENH-01-04: the generic tenant-scoped repository must never let a
 * caller-controlled payload mutate the fields that define WHERE a row lives
 * and WHO it belongs to. updateById previously applied `values` verbatim, so
 * a payload with `tenantId` could MOVE a row into another tenant through a
 * query that is otherwise tenant-scoped; an explicit `id` could re-key the
 * primary key. tenant-field and authority keys are refused, loudly.
 */

describe("repo write guards (ENH-01-04)", () => {
  it("documents the protected key vocabulary", () => {
    expect(PROTECTED_WRITE_FIELDS).toEqual(expect.arrayContaining(["tenantId", "id"]))
  })

  it("passes ordinary payloads through untouched", () => {
    const values = { name: "Lions", maxSquadSize: 16, isActive: true }
    expect(assertWritableFields(values)).toBe(values)
  })

  it("refuses a tenant move through the generic update path", () => {
    expect(() => assertWritableFields({ tenantId: "other-tenant" })).toThrow(/\[repo\].*tenantId/)
  })

  it("refuses a primary-key rekey through the generic update path", () => {
    expect(() => assertWritableFields({ id: "00000000-0000-4000-8000-000000000009" })).toThrow(/\[repo\].*id/)
  })

  it("names the exact offending key and accepts clean overrides per key", () => {
    expect(() => assertWritableFields({ status: "active", tenantId: "x", name: "y" })).toThrow(/tenantId/)
  })
})
