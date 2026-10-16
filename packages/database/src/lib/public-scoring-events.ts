/** Public reaction protocol; never an official-score mutation. */
export const PUBLIC_FAN_REACTIONS = ["🔥", "👏", "😱", "🏏", "🎉", "💔"] as const
export type ScopedFanReaction = { matchId: string; tenantId: string; emoji: typeof PUBLIC_FAN_REACTIONS[number] }
const reactions: ReadonlySet<string> = new Set(PUBLIC_FAN_REACTIONS)
export function isScopedFanReaction(input: unknown, tenantId: string, matchId: string): input is ScopedFanReaction {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false
  const data = input as Record<string, unknown>
  return data.tenantId === tenantId && data.matchId === matchId && typeof data.emoji === "string" && reactions.has(data.emoji)
}
