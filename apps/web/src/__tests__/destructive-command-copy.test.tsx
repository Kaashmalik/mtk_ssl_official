import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { DeleteButton } from "@/components/shared/delete-button"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock("@mtk/ui/components/ui/button", () => ({ Button: ({ children }: any) => <button>{children}</button> }))
vi.mock("@mtk/ui/components/ui/dialog", () => {
  const Wrapper = ({ children }: any) => <div>{children}</div>
  return Object.fromEntries(["Dialog", "DialogContent", "DialogDescription", "DialogFooter", "DialogHeader", "DialogTitle", "DialogTrigger"]
    .map(name => [name, Wrapper]))
})

describe("Truthful destructive-command confirmation copy", () => {
  it.each(["team", "player"])("describes %s archival as history preserving, not permanent deletion", label => {
    const html = renderToStaticMarkup(<DeleteButton action={vi.fn()} id="id" redirectHref="/dashboard" entityLabel={label} operation="archive" />)
    expect(html).toContain(`Archive ${label}?`)
    expect(html).toContain("record and history are preserved")
    expect(html).toContain("unfinished fixtures")
    expect(html).not.toContain("permanently delete")
    expect(html).not.toContain("cannot be undone")
  })
  it("keeps match cancellation wording separate from archival/deletion", () => {
    const html = renderToStaticMarkup(<DeleteButton action={vi.fn()} id="id" redirectHref="/dashboard" entityLabel="match" operation="cancel" />)
    expect(html).toContain("Cancel fixture")
    expect(html).toContain("Only an unstarted fixture")
    expect(html).not.toContain("permanently delete")
  })
  it("preserves the default wording for callers that still perform real deletion", () => {
    const html = renderToStaticMarkup(<DeleteButton action={vi.fn()} id="id" redirectHref="/dashboard" entityLabel="item" />)
    expect(html).toContain("Delete item?")
    expect(html).toContain("permanently delete")
    expect(html).not.toContain("history are preserved")
  })
})
