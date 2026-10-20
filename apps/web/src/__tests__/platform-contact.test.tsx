import React, { type ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { PlatformContact } from "@/components/support/platform-contact"

/**
 * ENH-02-04 (privacy-conscious support component): the surface shows the
 * display number, discloses the exact prefilled draft BEFORE anything opens,
 * opens WhatsApp for a MANUAL send (nothing claims a message was sent), and
 * offers a copy-number fallback.
 */

const mocks = vi.hoisted(() => ({
  writeText: vi.fn(),
  cursor: 0,
  states: [] as unknown[],
  touched: [] as boolean[],
  setters: [] as Array<(update: unknown) => void>,
  buttons: [] as Array<{ label: string; disabled?: boolean; click?: () => void }>,
  links: [] as Array<{ href: string; label: string }>,
}))

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = mocks.cursor++
    if (mocks.touched[index] !== true) {
      mocks.states[index] = typeof initial === "function" ? initial() : initial
    }
    return [mocks.states[index], mocks.setters[index]]
  },
}))
vi.mock("next/link", () => ({ default: ({ children, href }: { children?: ReactNode; href: string }) => <a href={href}>{children}</a> }))
vi.mock("@mtk/ui/components/ui/button", () => ({
  Button: ({ children, disabled, onClick }: { children?: ReactNode; disabled?: boolean; onClick?: () => void }) => {
    const label = React.Children.toArray(children).filter((child) => typeof child === "string").join("").trim()
    mocks.buttons.push({ label, disabled, click: onClick })
    return <button disabled={disabled}>{children}</button>
  },
}))
vi.mock("@mtk/ui/components/ui/card", () => ({
  Card: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))
vi.mock("lucide-react", () => ({
  Copy: () => null,
  ExternalLink: () => null,
  Info: () => null,
  MessageCircle: () => null,
}))

function render(props: Parameters<typeof PlatformContact>[0]) {
  mocks.cursor = 0
  mocks.buttons = []
  mocks.links = []
  return renderToStaticMarkup(<PlatformContact {...props} />)
}

const CONTEXT = {
  topic: "apply" as const,
  leagueName: "Shakir Super League",
  leagueSlug: "shakir-super-league",
  applicationReference: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  statusLabel: "Information requested",
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.cursor = 0
  mocks.states = []
  mocks.touched = []
  mocks.buttons = []
  mocks.links = []
  mocks.setters = Array.from({ length: 8 }, (_, index) => (update: unknown) => {
    mocks.touched[index] = true
    mocks.states[index] = typeof update === "function" ? (update as (previous: unknown) => unknown)(mocks.states[index]) : update
  })
})

describe("PlatformContact (ENH-02-04)", () => {
  it("shows the display number and a wa.me link built from the draft", () => {
    const html = render({ context: CONTEXT })

    expect(html).toContain("+92 303 8111297")
    expect(html).toContain("https://wa.me/923038111297?text=")
    // No claim that anything was sent: only the honesty disclaimer may use
    // the word, and it always denies automatic sending.
    expect(html).not.toMatch(/(message (was |has been )?sent|was sent (to|success)|successfully sent|we have sent|we've sent)/i)
    expect(html).toMatch(/you send the message yourself/i)
  })

  it("discloses the exact prefilled draft before WhatsApp opens", () => {
    mocks.states[0] = true
    mocks.touched[0] = true

    const html = render({ context: CONTEXT })

    expect(html).toContain("Shakir Super League")
    expect(html).toContain("Information requested")
  })

  it("offers the manual-send WhatsApp link (the send happens in WhatsApp, not here)", () => {
    const html = render({ context: CONTEXT })
    expect(html).toContain(`href="https://wa.me/923038111297?text=`)
    expect(html).toContain("Open WhatsApp with this draft")
  })

  it("copies the display number as the fallback", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: mocks.writeText } })
    try {
      render({ context: CONTEXT })
      const copyButton = mocks.buttons.find((button) => button.label.toLowerCase().includes("copy"))
      expect(copyButton).toBeTruthy()
      await copyButton!.click!()
      expect(mocks.writeText).toHaveBeenCalledWith("+92 303 8111297")
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
