#!/usr/bin/env node
/**
 * Supabase MCP stdio launcher (project-scoped).
 *
 * OpenCode's local MCP config runs this instead of the remote
 * https://mcp.supabase.com/mcp integration, which previously failed with
 * transient `getaddrinfo ENOTFOUND mcp.supabase.com` and requires an OAuth
 * browser sign-in. The local server needs neither: it talks to
 * api.supabase.com directly using SUPABASE_ACCESS_TOKEN, read at runtime
 * from the repo's git-ignored `.env` (never hardcoded or logged), and is
 * pinned to this project's ref so its blast radius is one project.
 *
 * stdio is inherited: the MCP client's JSON-RPC passes straight through.
 *
 * Cold-start discipline (the server's own initialize round-trip already
 * costs ~10s against api.supabase.com, and OpenCode's MCP connect has a
 * hard timeout - Batch 178 diagnosis): the server is launched from a
 * PINNED pnpm-global install via its node entrypoint. Never `npx ...@latest`,
 * which re-resolves the tag against the npm registry on every spawn and
 * pushes total connect latency past the deadline.
 */
const { spawn } = require("child_process")
const fs = require("fs")
const path = require("path")

const REPO = path.join(__dirname, "..")
const PROJECT_REF = "anxstufkbqnjkxgksfkn"
// Optional: point at a pinned global install's cli.js to skip the npx registry
// round-trip, e.g. `$(corepack pnpm root -g)/@supabase/mcp-server-supabase/dist/cli.js`.
const PINNED_ENTRY = process.env.SUPABASE_MCP_ENTRY || ""

let envSrc
try {
  envSrc = fs.readFileSync(path.join(REPO, ".env"), "utf8")
} catch {
  console.error("supabase-mcp: repo .env not found")
  process.exit(1)
}
const token = (envSrc.match(/^SUPABASE_ACCESS_TOKEN=(\S+)$/m) || [])[1]
if (!token) {
  console.error("supabase-mcp: SUPABASE_ACCESS_TOKEN missing from .env")
  process.exit(1)
}

function spawnServer() {
  const base = ["-y", "@supabase/mcp-server-supabase@latest", "--access-token", token, "--project-ref", PROJECT_REF]
  let child
  if (fs.existsSync(PINNED_ENTRY)) {
    child = spawn(process.execPath, [PINNED_ENTRY, "--access-token", token, "--project-ref", PROJECT_REF], {
      stdio: "inherit",
      shell: false,
    })
  } else {
    // Fallback (slow: registry round-trip). Install the pinned server with
    // `corepack pnpm add -g @supabase/mcp-server-supabase` to avoid this path.
    console.error("supabase-mcp: pinned entry missing, falling back to npx (slow cold start)")
    child = spawn("npx", base, { stdio: "inherit", shell: process.platform === "win32" })
  }
  child.on("error", (err) => {
    console.error("supabase-mcp: failed to spawn server:", err.message)
    process.exit(1)
  })
  child.on("exit", (code) => process.exit(code ?? 1))
}

// Fail fast with an actionable message when the configured token is no
// longer valid; otherwise the MCP client only sees an opaque startup
// timeout. A transient network failure (offline, DNS blip) must NOT block
// startup - the server itself is still launched in that case.
async function main() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    const res = await fetch("https://api.supabase.com/v1/projects", {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
    if (res.status === 401 || res.status === 403) {
      console.error(
        "supabase-mcp: SUPABASE_ACCESS_TOKEN in .env is invalid or expired (api.supabase.com returned " +
          res.status +
          "). Mint a fresh personal access token at https://supabase.com/dashboard/account/tokens and replace it in .env, then reconnect this MCP server.",
      )
      process.exit(1)
    }
  } catch {
    // Offline or timed out: proceed; per-request auth will surface any real
    // token problem.
  } finally {
    clearTimeout(timer)
  }
  spawnServer()
}
main()
