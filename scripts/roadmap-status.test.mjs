import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { roadmapStatus } from "./roadmap-status.mjs";

const fixture = body => `## 16. Phased Implementation Checklists\n${body}\n## 17. Delivery Gates`;
test("counts stable tasks without claiming open tasks are untouched", () => {
  const result = roadmapStatus(fixture("- [x] **BASE-01:** Built\n- [ ] **SCORE-11:** Partial\n- [ ] **REL-01:** Acceptance"));
  assert.equal(result.total, 3);
  assert.equal(result.checked, 1);
  assert.equal(result.open, 2);
  assert.equal(result.groups.length, 2);
  assert.match(result.caveat, /not remaining batch estimates/);
});
test("ignores historical checkbox copies outside the authoritative checklist", () => {
  const result = roadmapStatus(`- [x] **BASE-01:** History\n${fixture("- [ ] **BASE-01:** Current")}\n- [x] **BASE-01:** Later history`);
  assert.equal(result.open, 1);
  assert.equal(result.total, 1);
});
test("refuses duplicate IDs", () => {
  assert.throws(() => roadmapStatus(fixture("- [ ] **BASE-01:** A\n- [x] **BASE-01:** B")), /Duplicate/);
});
test("refuses unclassified IDs instead of silently omitting scope", () => {
  assert.throws(() => roadmapStatus(fixture("- [ ] **NEW-01:** New scope")), /Unclassified/);
});
test("refuses missing or empty checklists", () => {
  assert.throws(() => roadmapStatus("missing"), /missing/);
  assert.throws(() => roadmapStatus(fixture("")), /No authoritative/);
});
test("all current roadmap IDs are classified exactly once", () => {
  const result = roadmapStatus(readFileSync(new URL("../docs/SAAS_MASTER_PLAN_2026-10-12.md", import.meta.url), "utf8"));
  assert.equal(result.total, 79);
  assert.equal(result.checked, 26);
  assert.equal(result.open, 53);
  assert.equal(result.groups.reduce((sum, group) => sum + group.open, 0), result.open);
  assert.equal(new Set(result.groups.flatMap(group => group.ids)).size, result.open);
});
