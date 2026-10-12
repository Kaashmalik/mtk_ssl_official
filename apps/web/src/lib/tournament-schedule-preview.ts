import { calendarDateSchema } from "@mtk/database/lib/tournament-configuration"

export function estimateTournamentSchedule(format: "knockout" | "league" | "hybrid", maxTeams: number,
  startDate?: string, endDate?: string) {
  if (!Number.isInteger(maxTeams) || maxTeams < 2 || maxTeams > 64) return { total: 0, days: null, matchesPerDay: null }
  let total = format === "knockout" ? maxTeams - 1 : maxTeams * (maxTeams - 1) / 2
  if (format === "hybrid") {
    const groups = Math.ceil(maxTeams / 4)
    const base = Math.floor(maxTeams / groups)
    const largerGroups = maxTeams % groups
    total = groups - 1
    for (let group = 0; group < groups; group++) {
      const size = base + (group < largerGroups ? 1 : 0)
      total += size * (size - 1) / 2
    }
  }
  const start = calendarDateSchema.safeParse(startDate)
  const end = calendarDateSchema.safeParse(endDate)
  const days = start.success && end.success && end.data >= start.data
    ? (Date.parse(`${end.data}T00:00:00Z`) - Date.parse(`${start.data}T00:00:00Z`)) / 86400000 + 1 : null
  return { total, days, matchesPerDay: days === null ? null : Math.ceil(total / days) }
}
