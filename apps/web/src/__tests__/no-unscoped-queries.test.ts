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
 * "tenants.ts" and "users.ts" are bootstrap flows that run before tenant context exists.
 * The remaining files are NOT YET migrated to the repository layer. As each file
 * is migrated, remove it from this set — the test will then enforce repo-only access.
 */
const ALLOWLIST = new Set([
  "tenants.ts",
  "users.ts",
  // TODO: migrate these to repos and remove from allowlist:
  "matches.ts", // withTenantContext + explicit tenantId filters; still direct db
  "scoring.ts", // all WRITES proxy to scoring-service (SoT); remaining db.select are tenant-scoped authz reads
  "registrations.ts", // withTenantContext + tenantId filters; still direct db
  "scorecards.ts",
  "follows.ts",
  // Personal notifications: every query is filtered by the caller's active
  // tenant (resolved via the RBAC junction table) plus userId. No repo exists
  // for this table yet; remove from the allowlist when one is added.
  "notifications.ts",
  "player-ids.ts", // tenantId-filtered; uses direct db pending repo migration
  "users-invites.ts", // tenantId-filtered; uses direct db pending repo migration
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
});
