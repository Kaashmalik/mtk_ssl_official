/**
 * Batch 128: the share TEXTS carry the server-resolved league short label —
 * never a hardcoded platform abbreviation. Pure builders so the strings are
 * directly pinnable without mounting any UI module.
 */

export function buildMatchShareText(short: string, teamAName: string, teamBName: string, resultText: string): string {
  return `🏏 ${short} Match Update: ${teamAName} vs ${teamBName} - ${resultText}`
}

export function buildTournamentShareText(short: string, name: string, championName?: string | null): string {
  return championName
    ? `🏏 ${short}: ${name} - Champions: ${championName}`
    : `🏏 ${short} Tournament: ${name}`
}
