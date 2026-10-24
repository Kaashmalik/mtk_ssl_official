/**
 * Batch 133: CricHeroes-style humanized fixture dates, still honest — the
 * text is always derived from the actual scheduled timestamp, never from
 * hope. Today and Tomorrow get their words (a reader must not need
 * calendar math to know the live match started today); every other date
 * this year keeps a weekday prefix; a fixture in another year shows its
 * year rather than a misleading bare date. `now` is an explicit argument
 * so the calendar-day behavior (including DST and year boundaries) is
 * pinnable. An unknown timestamp stays exactly what the page already
 * said: "TBD" — nothing is invented.
 */

const TIME_OPTS: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" }
const DAY_OPTS: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }

function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function friendlyFixtureDate(date: Date | null | undefined, now: Date): string {
  if (!date) return "TBD"
  const time = date.toLocaleTimeString("en-US", TIME_OPTS)
  if (isSameCalendarDay(date, now)) return `Today, ${time}`
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (isSameCalendarDay(date, tomorrow)) return `Tomorrow, ${time}`
  const day = date.toLocaleDateString("en-US", DAY_OPTS)
  return date.getFullYear() === now.getFullYear() ? `${day}, ${time}` : `${day}, ${date.getFullYear()}, ${time}`
}
