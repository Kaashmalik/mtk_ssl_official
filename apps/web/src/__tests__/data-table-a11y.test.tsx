import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { DataTable, type Column } from "@mtk/ui/components/ui/data-table"

/**
 * ENH-04-02 acceptance (code-side arm): the shared table announces its
 * controls to assistive tech - labeled icon buttons, a labeled search
 * input, a live "no results" region, and page-position text.
 */

type Row = { id: string; name: string }

const columns: Column<Row>[] = [
  { key: "name", header: "Name", cell: (row) => row.name },
]

describe("DataTable semantics (ENH-04-02)", () => {
  it("labels the search input, and every pagination icon button, with a live page position", () => {
    const html = renderToStaticMarkup(
      <DataTable<Row>
        columns={columns}
        data={[{ id: "1", name: "Alpha XI" }]}
        pagination={{ page: 2, pageSize: 25, total: 80, totalPages: 4 }}
        onPageChange={() => {}}
        onSearch={() => {}}
        searchPlaceholder="Search teams"
      />,
    )

    // Search input is labeled (placeholder is not an accessible name):
    expect(html).toContain('aria-label="Search teams"')
    // Every icon-only pagination control is named:
    for (const label of ["First page", "Previous page", "Next page", "Last page"]) {
      expect(html).toContain(`aria-label="${label}"`)
    }
    // Position text is a live region and includes the word "Page":
    expect(html).toMatch(/aria-live="polite"[^>]*>\s*Showing 26/)
    expect(html).toContain("Page 2 of 4")
  })

  it("announces an empty table as a status region, not silence", () => {
    const html = renderToStaticMarkup(
      <DataTable<Row> columns={columns} data={[]} emptyMessage="No teams yet" />,
    )
    expect(html).toMatch(/role="status"/)
    expect(html).toContain("No teams yet")
  })
})
