import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * ENH-06-04: realtime recovery.
 *
 * The socket is an enhancement, never the record. Notices written while it was
 * disconnected are recovered by re-reading the DB on every successful
 * (re)connect; the bell keeps its polling fallback.
 */
const here = dirname(fileURLToPath(import.meta.url))
const hook = readFileSync(join(here, "../hooks/use-notification-socket.ts"), "utf8")
const bell = readFileSync(join(here, "../components/layout/notification-bell.tsx"), "utf8")

describe("ENH-06-04: notification socket recovery", () => {
  it("refreshes from the read path on every connect, not only on pushed events", () => {
    expect(hook).toContain('socket.on("connect"')
    expect(hook).toContain("onConnectedRef.current?.()")
    expect(bell).toContain("onConnected:")
    expect(bell).toContain("refresh()")
  })

  it("keeps the polling fallback and never treats the socket as a delivery record", () => {
    expect(bell).toContain("setInterval(refresh, 30000)")
    // Pushed payloads only prompt a re-read; they never insert into the list.
    expect(bell).toContain("onNotification: () => refresh()")
    expect(bell).not.toContain("setItems([...items")
  })
})
