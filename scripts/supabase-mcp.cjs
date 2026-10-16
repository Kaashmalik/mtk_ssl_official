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
 */
const { spawn } = require("child_process")
const fs = require("fs")
const path = require("path")

const REPO = path.join(__dirname, "..")
const PROJECT_REF = "anxstufkbqnjkxgksfkn"

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

const args = [
  "-y",
  "@supabase/mcp-server-supabase@latest",
  "--access-token",
  token,
  "--project-ref",
  PROJECT_REF,
]

const child = spawn("npx", args, {
  stdio: "inherit",
  shell: process.platform === "win32",
})
child.on("error", (err) => {
  console.error("supabase-mcp: failed to spawn npx:", err.message)
  process.exit(1)
})
child.on("exit", (code) => process.exit(code ?? 1))
