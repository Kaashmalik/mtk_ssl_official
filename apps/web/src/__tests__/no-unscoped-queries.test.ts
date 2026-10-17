import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

/**
 * Security guard: detects unscoped database queries in server actions.
 *
 * Tenant isolation depends on every query being filtered by tenantId. The
 * repository layer (TenantScopedRepository) handles this automatically. This
 * test enforces that server actions use repos instead of direct `db` calls.
 *
 * ALLOWED (bypass the guard):
 *   - Files in `apps/web/src/app/actions/tenants.ts` (tenant bootstrap, pre-context)
 *   - Files importing `unscoped()` (explicitly opted-in)
 *   - Files importing `withoutTenantContext` (super-admin / bootstrap flows)
 *
 * NOT ALLOWED (will fail this test):
 *   - `db.select()` / `db.update()` / `db.delete()` / `db.insert()` in any
 *     other server action file without going through a repo.
 */

const ACTIONS_DIR = join(__dirname, "../app/actions");

/**
 * Files that are allowed to use direct `db`.
 *
 * "tenants.ts" is the only remaining exemption: it reads/provisions the very
 * first tenant rows before any active-league context can exist. Every other
 * action file delegates to tenant-scoped readers/writers in lib/; the test
 * enforces that repo-only shape.
 */
const ALLOWLIST = new Set([
  // Bootstrap only: tenants.ts provisions the very first tenant/actor rows
  // before any TenantScopedRepository context can exist. It pre-dates
  // resolution of an active league and is audited accordingly.
  "tenants.ts",
  // Bootstrap only (REG-01): league-applications.ts is the reviewed-onboarding
  // sibling of tenants.ts. An applicant has no league yet, so there is nothing
  // a tenant-scoped repository could scope to; writes are user-scoped under
  // the applicant's row lock, version-checked and audited (LEAGUE_APPLICATION_*).
  "league-applications.ts",
  // Every other action file delegates to tenant-scoped readers/writers in
  // lib/ (or scoring-service via its client): notifications.ts (Batch 33),
  // follows.ts/registrations.ts (Batch 36), player-ids.ts (Batch 37),
  // scorecards.ts (Batch 38), users-invites.ts (Batch 39), matches.ts
  // (Batch 40), scoring.ts (Batch 41 — reads only; writes belong to the
  // scoring-service SoT) and users.ts (Batch 54 — member management moved to
  // lib/member-management.ts). The guard enforces repo-only access everywhere.
]);

/** Patterns that indicate intentional unscoped access. */
const INTENTIONAL_MARKERS = [
  "unscoped()",
  "withoutTenantContext",
  "SuperAdmin",
  "super_admin",
];

interface Finding {
  file: string;
  line: number;
  match: string;
}

function findAllTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...findAllTsFiles(full));
    } else if (extname(entry) === ".ts") {
      results.push(full);
    }
  }
  return results;
}

/**
 * Simple regex-based scanner for `db.select`, `db.update`, `db.delete`,
 * `db.insert` call patterns. Good enough for a CI gate; not a full parser.
 */
function scanForUnscopedQueries(filePath: string): Finding[] {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const findings: Finding[] = [];

  // Match db.select(, db.update(, db.delete(, db.insert(
  const pattern = /\bdb\.(select|update|delete|insert)\s*\(/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(line)) !== null) {
      findings.push({
        file: filePath,
        line: i + 1,
        match: match[0],
      });
    }
  }

  return findings;
}

describe("Tenant Isolation: No Unscoped DB Queries in Server Actions", () => {
  const files = findAllTsFiles(ACTIONS_DIR);

  it("server actions directory exists and has files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => ({ file: f, name: f.split(/[/\\]/).pop()! })))(
    "$name: uses repo layer or is allowlisted",
    ({ file, name }) => {
      // Allowlisted files can use direct db (bootstrap flows)
      if (ALLOWLIST.has(name)) {
        return;
      }

      const findings = scanForUnscopedQueries(file);

      if (findings.length === 0) {
        return; // No direct db calls — pass
      }

      // Check if the file has intentional markers
      const content = readFileSync(file, "utf8");
      const hasIntentionalMarker = INTENTIONAL_MARKERS.some((marker) =>
        content.includes(marker)
      );

      // Filter out db calls that are inside comments
      const realFindings = findings.filter((f) => {
        const lineContent = readFileSync(f.file, "utf8").split("\n")[f.line - 1];
        return !lineContent.trim().startsWith("//") && !lineContent.trim().startsWith("*");
      });

      if (hasIntentionalMarker && realFindings.length === 0) {
        return; // Intentional + only comments — pass
      }

      // If there are real (non-comment) unscoped db calls and no intentional marker, fail
      if (!hasIntentionalMarker) {
        expect(
          true,
          `Unscoped db call found in ${name}:${realFindings.map((f) => f.line).join(",")}. ` +
            `Use a tenant-scoped repository (e.g. tournamentRepo, teamRepo) instead of direct db calls. ` +
            `If this is intentional (e.g., super-admin flow), add 'withoutTenantContext' to the file.`
        ).toBe(false);
      }
    }
  );

  it("tournaments.ts uses the repository layer (migration verification)", () => {
    const tournamentsPath = join(ACTIONS_DIR, "tournaments.ts");
    const content = readFileSync(tournamentsPath, "utf8");

    // Must import from the repo layer
    expect(content).toContain("tournamentRepo");
    // Must use withTenantContext
    expect(content).toContain("withTenantContext");
    // Must NOT have raw db.select/update/delete/insert (the repo wraps those)
    const findings = scanForUnscopedQueries(tournamentsPath);
    expect(findings.length).toBe(0);
  });

  it("users.ts delegates member management to the lib (Batch 54 migration verification)", () => {
    const usersPath = join(ACTIONS_DIR, "users.ts");
    const content = readFileSync(usersPath, "utf8");

    // Member reads/writes now live in the tenant-scoped lib; the action only
    // resolves the session/permission, parses input and revalidates.
    expect(content).toContain("@/lib/member-management");
    expect(content).not.toContain("from \"@mtk/database\"");
    // Must NOT have raw db.select/update/delete/insert
    expect(scanForUnscopedQueries(usersPath).length).toBe(0);
  });
});
