"use server"

import {
  reportMatchReactionFeed,
  readOpenReactionReports,
  decideReactionReport,
} from "@/lib/fan-report-records"

/**
 * Thin delegates over the locked FAN-01 reports writer. The fan gate, the
 * publication policy, the flood floor, the partial-unique replay safety, the
 * organizer gate, the FOR UPDATE lock and the audits all live in the writer;
 * this tier only validates inputs and forwards.
 */

export async function reportMatchReactionFeedAction(input: unknown) {
  return reportMatchReactionFeed(input)
}

export async function getOpenReactionReports(matchId: unknown) {
  return readOpenReactionReports(matchId)
}

export async function decideReactionReportAction(input: unknown) {
  return decideReactionReport(input)
}
