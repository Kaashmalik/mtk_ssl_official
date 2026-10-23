import {
  clampGraphicsOffsetMs,
  pruneBroadcastCelebrations,
  type BroadcastCelebrationEvent,
  type BroadcastOverlaySnapshot,
} from "@mtk/contracts"

/**
 * ENH-09-04 (Batch 101): pure state machine for the overlay's celebration
 * latency buffer.
 *
 * Planned celebrations may be HELD for the operator's graphics offset so
 * burned animations align with the programme A/V timeline (OBS composites the
 * browser source over camera/video BEFORE provider ingest). The buffer is a
 * rendering convenience only: it never gates how snapshots are read or how
 * official state persists, and its occupants remain fully subject to undo
 * pruning - a retracted delivery can never surface merely because it was
 * held. Sequencing guarantees pinned by tests:
 *
 * - an event planned while held is NOT due before `revealAt`;
 * - an undo (snapshot prune) removes a held event and FORGETS its dedup id,
 *   exactly like the on-screen queue always did;
 * - a duplicate plan (socket-triggered refetch of the same revision) is
 *   absorbed while held;
 * - reveal order is FIFO by reveal time; the cap is applied when events are
 *   appended to the visible queue, not by silently dropping held events.
 */

export type HeldCelebration = { event: BroadcastCelebrationEvent; revealAt: number }

export function normalizeEventOffsetMs(value: number): number {
  return clampGraphicsOffsetMs(value)
}

/**
 * Fold a poll's newly planned events into the hold buffer. Returns the
 * next buffer contents and the updated dedup set (both as new arrays/sets;
 * callers keep them in refs/state).
 */
export function ingestHeldCelebrations(input: {
  planned: BroadcastCelebrationEvent[]
  held: HeldCelebration[]
  seenIds: ReadonlySet<string>
  snapshot: BroadcastOverlaySnapshot
  now: number
  offsetMs: number
}): { held: HeldCelebration[]; seenIds: Set<string> } {
  const seenIds = new Set(input.seenIds)

  // Undo/revision-regression pruning applies to held events BEFORE reveal.
  const keptHeldEvents = pruneBroadcastCelebrations(
    input.held.map(heldEntry => heldEntry.event),
    input.snapshot,
  )
  const keptIds = new Set(keptHeldEvents.map(event => event.id))
  for (const heldEntry of input.held) {
    if (!keptIds.has(heldEntry.event.id)) seenIds.delete(heldEntry.event.id)
  }
  const survivors = input.held.filter(heldEntry => keptIds.has(heldEntry.event.id))

  const offsetMs = normalizeEventOffsetMs(input.offsetMs)
  const next = survivors
  for (const event of input.planned) {
    if (seenIds.has(event.id)) continue
    seenIds.add(event.id)
    next.push({ event, revealAt: input.now + offsetMs })
  }
  next.sort((a, b) => a.revealAt - b.revealAt || a.event.id.localeCompare(b.event.id))
  return { held: next, seenIds }
}

/** Split the buffer at `now`: due events leave the buffer in reveal order. */
export function dueHeldCelebrations(
  held: HeldCelebration[],
  now: number,
): { due: BroadcastCelebrationEvent[]; held: HeldCelebration[] } {
  const due = held.filter(heldEntry => heldEntry.revealAt <= now).map(heldEntry => heldEntry.event)
  return { due, held: due.length === 0 ? held : held.filter(heldEntry => heldEntry.revealAt > now) }
}

/** Prune the visible queue against the official snapshot, reporting which
 *  dedup ids became forgettable (an undo may re-open the claim window via a
 *  later re-plan). */
export function pruneQueuedCelebrations(
  queued: BroadcastCelebrationEvent[],
  snapshot: BroadcastOverlaySnapshot,
): { kept: BroadcastCelebrationEvent[]; forgottenIds: string[] } {
  const kept = pruneBroadcastCelebrations(queued, snapshot)
  const keptIds = new Set(kept.map(event => event.id))
  const forgottenIds = queued.filter(event => !keptIds.has(event.id)).map(event => event.id)
  return { kept, forgottenIds }
}
