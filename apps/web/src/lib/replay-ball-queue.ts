import type { QueuedBall } from "./offline-ball-queue"

interface ReplayDependencies {
  record: (payload: Record<string, unknown>) => Promise<unknown>
  remove: (clientOpId: string) => Promise<void>
  incrementAttempts: (clientOpId: string) => Promise<void>
}

/** Stop at the first failure to preserve order. Never age deliveries out. */
export async function replayBallQueue(queue: QueuedBall[], dependencies: ReplayDependencies) {
  let synced = 0
  for (const item of queue) {
    try {
      const response = await dependencies.record({ ...item.payload, clientOpId: item.clientOpId })
      if (!response || typeof response !== "object" ||
          !("success" in response) || response.success !== true ||
          !("clientOpId" in response) || response.clientOpId !== item.clientOpId ||
          !("ballId" in response) || typeof response.ballId !== "string" || !response.ballId) {
        throw new Error("Delivery was not acknowledged by the scoring service")
      }
      await dependencies.remove(item.clientOpId)
      synced++
    } catch (error) {
      await dependencies.incrementAttempts(item.clientOpId)
      return { synced, blocked: item.clientOpId, error }
    }
  }
  return { synced, blocked: null, error: null }
}
