import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"

/**
 * The middleware protects an explicit list of private areas and lets
 * everything else through (unknown paths must 404, not redirect to sign-in).
 * The risk of that design is a NEW private route that nobody adds to the
 * list. This pin makes every top-level app route a deliberate decision: it
 * must appear in exactly one of the two lists below, and both lists must
 * match what middleware.ts actually declares.
 */
const PUBLIC_TOP_LEVEL = [
  "about", "accept-invite", "ads.txt", "contact", "guides", "hall-of-fame", "hub", "leaderboards",
  "matches", "offline", "privacy", "sign-in", "sign-up", "terms", "tournaments", "verify-otp",
]
const PRIVATE_TOP_LEVEL = ["api", "broadcast", "dashboard", "impersonation", "settings"]
// Server-action modules only; they contain no page or route handler.
const NOT_A_ROUTE = ["actions"]

const appDir = path.resolve(__dirname, "../app")
const middleware = fs.readFileSync(path.resolve(__dirname, "../middleware.ts"), "utf8")

describe("middleware route coverage", () => {
  it("classifies every top-level app route as public or private", () => {
    const routes = fs
      .readdirSync(appDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("(") && !entry.name.startsWith("_"))
      .map((entry) => entry.name)
    for (const route of routes) {
      const classified = [PUBLIC_TOP_LEVEL, PRIVATE_TOP_LEVEL, NOT_A_ROUTE].filter((list) => list.includes(route)).length
      expect(classified, `app/${route} must be classified in exactly one list here AND in middleware.ts`).toBe(1)
    }
  })

  it("declares every private area in the middleware's private matcher", () => {
    for (const route of PRIVATE_TOP_LEVEL) {
      expect(middleware, `/${route} missing from isPrivateRoute`).toContain(`"/${route}(.*)"`)
    }
  })

  it("declares every public area in the middleware's public matcher", () => {
    for (const route of PUBLIC_TOP_LEVEL) {
      expect(middleware, `/${route} missing from isPublicRoute`).toMatch(new RegExp(`"/${route.replace(".", "\\.")}(\\(\\.\\*\\)|\\[\\^?|/|")`))
    }
  })

  it("keeps the 'actions' folder free of pages and route handlers", () => {
    const files = fs.readdirSync(path.join(appDir, "actions"), { recursive: true }).map(String)
    expect(files.filter((file) => /(^|[\\/])(page|route)\.(t|j)sx?$/.test(file))).toEqual([])
  })
})
