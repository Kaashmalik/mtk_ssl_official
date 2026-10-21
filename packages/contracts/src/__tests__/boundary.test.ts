import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * ENH-03-01 (portable contracts): the package is consumed by web, mobile and
 * the Nest scoring service, so NOTHING server- or DOM-flavored may leak in.
 * The scan covers every non-test source file, plus the package manifest.
 */

const SRC_DIR = join(__dirname, "..");
const PACKAGE_ROOT = join(SRC_DIR, "..");

const FORBIDDEN_IMPORT = /^(next|react|react-dom|react-native|expo|@expo|drizzle-orm|drizzle-kit|@supabase|postgres|@mtk\/database|@mtk\/ui|node:fs|node:crypto|node:path|node:child_process|nanoid)/;

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") {
        // Tests may use node builtins to SCAN the sources.
        continue;
      }
      out.push(...listFiles(full));
    } else if (full.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("ENH-03-01: contracts portability boundary", () => {
  it("never imports Next, DOM, React, native, database, drizzle, supabase or node-server builtins", () => {
    const violations: string[] = [];
    for (const file of listFiles(SRC_DIR)) {
      const source = readFileSync(file, "utf8");
      const imports = source.matchAll(/from\s+["']([^"']+)["']/g);
      for (const match of imports) {
        const spec = match[1];
        // Relative imports and the one approved runtime dep stay allowed.
        if (spec.startsWith(".") || spec === "zod") continue;
        if (FORBIDDEN_IMPORT.test(spec)) violations.push(`${file}: ${spec}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("ships no runtime dependency except the validator", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(["zod"]);
    // And never a server secret surface in a manifest script.
    const scripts = JSON.stringify(manifest.scripts ?? {});
    expect(scripts).not.toMatch(/SUPABASE_|SCORING_SERVICE_URL|DATABASE_URL|CLERK_SECRET/);
  });
});
