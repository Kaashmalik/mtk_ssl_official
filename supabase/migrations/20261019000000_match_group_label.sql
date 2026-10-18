-- COMP-05 (Batch 150): group labels on matches. Hybrid tournaments
-- (group stage then knockout) need a group label on each group-stage
-- fixture so standings can be computed per group. NULL means "no group"
-- (knockout stages and single-group tournaments); standings computation
-- filters by group when one is supplied. ADDITIVE ONLY, no data changes,
-- no RLS change (matches already has RLS forced + grants).
ALTER TABLE matches ADD COLUMN group_label text;
CREATE INDEX matches_tournament_group_idx
ON matches (tournament_id, group_label)
WHERE group_label IS NOT NULL;
COMMENT ON COLUMN matches.group_label IS
'COMP-05: group label for hybrid group stages ("A", "B", ...); NULL for knockout stages and single-group tournaments';
