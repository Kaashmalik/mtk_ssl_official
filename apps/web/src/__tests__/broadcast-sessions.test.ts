import { afterEach, describe, expect, it } from "vitest"
import {
  attachBroadcastSession,
  prepareBroadcastSession,
  readBroadcastControlData,
  readBroadcastIngest,
  refreshBroadcastSession,
  requestBroadcastEnd,
  requestBroadcastStart,
  setDefaultBroadcastDestination,
} from "@/lib/broadcast-sessions"

/**
 * ENH-08-01/02: the control gate is enforced in the command library, not only
 * by hiding the UI. A direct server-action call must not touch a table while
 * the verified control plane is disabled.
 */

const TENANT = "00000000-0000-4000-8000-0000000000a1"
const MATCH = "00000000-0000-4000-8000-0000000000b1"
const SESSION = "00000000-0000-4000-8000-0000000000c1"
const DESTINATION = "00000000-0000-4000-8000-0000000000d1"

afterEach(() => {
  delete process.env.BROADCAST_CONTROL_READY
})

describe("ENH-08-01/02: broadcast control gate", () => {
  it("returns no control data when the gate is off", async () => {
    await expect(readBroadcastControlData(TENANT, MATCH)).resolves.toEqual({
      destinations: [],
      sessions: [],
    })
  })

  it("refuses every command before any database work when the gate is off", async () => {
    const calls = [
      () => prepareBroadcastSession("clerk", TENANT, MATCH, DESTINATION),
      () => attachBroadcastSession("clerk", TENANT, MATCH, {
        provider: "youtube",
        destinationId: DESTINATION,
        url: "https://www.youtube.com/watch?v=abcdefghijk",
      }),
      () => requestBroadcastStart("clerk", TENANT, SESSION),
      () => requestBroadcastEnd("clerk", TENANT, SESSION),
      () => refreshBroadcastSession("clerk", TENANT, SESSION),
      () => readBroadcastIngest("clerk", TENANT, SESSION),
      () => setDefaultBroadcastDestination("clerk", TENANT, DESTINATION),
    ]
    for (const call of calls) {
      await expect(call()).rejects.toThrow("Verified broadcast controls are not enabled")
    }
  })

  it("does not treat the string 'false' as enabled", async () => {
    process.env.BROADCAST_CONTROL_READY = "false"
    await expect(readBroadcastControlData(TENANT, MATCH)).resolves.toEqual({
      destinations: [],
      sessions: [],
    })
    await expect(requestBroadcastStart("clerk", TENANT, SESSION))
      .rejects.toThrow("Verified broadcast controls are not enabled")
  })
})
