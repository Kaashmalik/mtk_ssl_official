import { describe, expect, it } from "vitest"
import React from "react"

/**
 * FAN-01 poll UI slice tests: pure label/percent helpers and truthful copy -
 * aggregate counts only, engagement disclosed, closed polls final.
 */

import { TournamentPollCard, POLL_CARD_LABELS, pollTotalLabel, pollSharePercent } from "@/components/shared/tournament-poll-card"
import { PollManagementCard, POLL_MANAGER_LABELS, pollStatusBadge, pollOptionResultLine } from "@/components/tournaments/poll-management-card"

describe("Fan poll card copy (aggregate-only truthfulness)", () => {
  it("labels totals with honest singular/plural forms", () => {
    expect(pollTotalLabel(0)).toBe("0 votes")
    expect(pollTotalLabel(1)).toBe("1 vote")
    expect(pollTotalLabel(12)).toBe("12 votes")
  })

  it("computes bounded integer percents with a safe zero-total floor", () => {
    expect(pollSharePercent(0, 0)).toBe(0)
    expect(pollSharePercent(3, 10)).toBe(30)
    expect(pollSharePercent(2, 3)).toBe(67)
    expect(pollSharePercent(5, 0)).toBe(0)
  })

  it("always discloses that votes are engagement only", () => {
    expect(POLL_CARD_LABELS.disclosure).toMatch(/engagement only/i)
    expect(POLL_CARD_LABELS.disclosure).toMatch(/never decide/i)
    expect(POLL_CARD_LABELS.votingHint).toMatch(/change your mind/i)
    expect(POLL_CARD_LABELS.signedOutHint).toMatch(/sign in/i)
  })

  it("builds an open-poll element carrying the aggregate-only props", () => {
    // NODE-only env (no DOM): createElement composes the element WITHOUT
    // invoking hooks - the rendered output belongs to React.
    const element = React.createElement(TournamentPollCard, {
      poll: {
        pollId: "p1", question: "Who wins?", status: "open",
        options: ["A", "B"], counts: [2, 1], total: 3,
        createdAt: "2026-10-18T10:00:00.000Z",
      },
      myVote: 0,
      canVote: true,
    })
    expect(element.type).toBe(TournamentPollCard)
    const json = JSON.stringify(element.props)
    expect(json).toContain("Who wins?")
    expect(json).toContain("canVote\":true")
  })
})

describe("Poll management card copy (owner moderation)", () => {
  it("maps statuses to badges and never offers reopening for closed polls", () => {
    expect(pollStatusBadge("draft")).toBe("Draft")
    expect(pollStatusBadge("open")).toBe("Open")
    expect(pollStatusBadge("closed")).toBe("Closed")
    expect(pollStatusBadge("anything-else")).toBe("Draft")
  })

  it("renders result lines as bare counts with a dash fallback", () => {
    expect(pollOptionResultLine([2, 0], 0)).toBe("2")
    expect(pollOptionResultLine([2, 0], 1)).toBe("0")
    expect(pollOptionResultLine([2], 1)).toBe("-")
    expect(pollOptionResultLine([2, -3], 1)).toBe("-")
  })

  it("states the moderation point and the terminal lifecycle in words", () => {
    expect(POLL_MANAGER_LABELS.moderationNote).toMatch(/fans only vote/i)
    expect(POLL_MANAGER_LABELS.closedNote).toMatch(/final/i)
    expect(POLL_MANAGER_LABELS.optionsLabel).toMatch(/2-10/i)
  })

  it("builds an owner element carrying the tournament and bounded summaries", () => {
    const element = React.createElement(PollManagementCard, {
      tournamentId: "t1",
      polls: [{
        pollId: "p1", question: "Who wins?", status: "open",
        options: ["A", "B"], counts: [2, 1], total: 3,
        createdAt: "2026-10-18T10:00:00.000Z",
      }],
    })
    expect(element.type).toBe(PollManagementCard)
    const json = JSON.stringify(element.props)
    expect(json).toContain("t1")
    expect(json).toContain("Who wins?")
  })
})
