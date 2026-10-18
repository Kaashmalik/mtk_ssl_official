import { createRequire } from "node:module"
import test from "node:test"
import assert from "node:assert/strict"

const require = createRequire(import.meta.url)
const { buildManifest, reconcile, registryStamps } = require("./migration-inventory.cjs")

test("manifest derives every migration from the folder, sorted, with parseable stamps", () => {
  const manifest = buildManifest()
  assert.ok(manifest.length >= 70, `expected ~77 migrations, got ${manifest.length}`)
  const sorted = [...manifest].sort((a, b) => a.file.localeCompare(b.file))
  assert.deepEqual(manifest, sorted)
  for (const m of manifest) {
    // Both historical shapes are digit-stamps: 3-digit legacy and
    // 14-digit timestamp prefixes.
    assert.match(m.stamp, /^\d+$/)
    assert.ok(m.name.length > 0)
  }
})

test("registry reconciliation finds the remotely-applied register entries", () => {
  const stamps = registryStamps()
  for (const expected of ["20261018220000", "20261018210000", "20261018200000"]) {
    assert.ok(stamps.has(expected), `registry should record ${expected}`)
  }
})

test("reconcile flags both honest drift directions and nothing else", () => {
  const expected = [
    { file: "1_a.sql", stamp: "00000000000001", name: "a" },
    { file: "2_b.sql", stamp: "00000000000002", name: "b" },
  ]
  const result = reconcile(expected, new Set(["00000000000001"]), new Set(["00000000000002", "00000000000099"]))
  assert.deepEqual(result.drift.missingInDb, ["00000000000001"], "applied in registry only -> missing from db")
  assert.deepEqual(result.drift.untrackedInDb, ["00000000000099"], "db-only stamp is untracked, never normalized")
  assert.deepEqual(result.drift.pendingInRegistry, ["00000000000002"], "not yet registered")
})

test("clean state has zero drift in every direction", () => {
  const expected = [{ file: "1_a.sql", stamp: "00000000000001", name: "a" }]
  const result = reconcile(expected, new Set(["00000000000001"]), new Set(["00000000000001"]))
  assert.equal(result.drift.missingInDb.length, 0)
  assert.equal(result.drift.untrackedInDb.length, 0)
  assert.equal(result.drift.pendingInRegistry.length, 0)
})
