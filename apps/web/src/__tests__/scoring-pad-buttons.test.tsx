import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

/**
 * ENH-03-02: the web scoring pad offers every legal run value. The server
 * ceiling is 7 and five runs is a real cricket score — a pad that omits 5/7
 * makes the official silently falsify the record into something recordable.
 */

const buttonLabels: string[] = []

vi.mock("@mtk/ui", () => ({
  Button: ({ children }: { children?: React.ReactNode }) => {
    const label = React.Children.toArray(children).filter((child) => typeof child === "string").join("").trim()
    buttonLabels.push(label)
    return <button>{label}</button>
  },
}))
vi.mock("@/components/scoring/wicket-selector", () => ({ WicketSelector: () => null }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { BallInputComponent } from "@/components/scoring/ball-input"
import { useScoringStore } from "@/stores/scoring-store"

describe("ENH-03-02: the web scoring pad carries the full legal run vocabulary", () => {
  it("offers 5 and 7 next to the existing values — everything the server accepts is recordable", () => {
    useScoringStore.setState({ matchId: "match", innings1: {
      inningsId: "innings", teamId: "team", totalRuns: 0, totalWickets: 0, totalBalls: 0,
      extras: 0, byes: 0, legByes: 0, wides: 0, noBalls: 0, status: "not_started",
      currentOver: 0, currentBall: 0, balls: [],
    } })
    renderToStaticMarkup(<BallInputComponent batsmanId="b" bowlerId="w" />)
    expect(buttonLabels).toEqual(expect.arrayContaining(["0", "1", "2", "3", "4", "5", "6", "7", "W", "WD", "NB", "LB", "B"]))
  })
})
