"use client"

import Link from "next/link"
import { Button } from "@mtk/ui/components/ui/button"
import { Printer, FileDown } from "lucide-react"

interface PrintButtonProps {
  /**
   * When provided, the button opens the dedicated PDF scorecard route in a new
   * tab instead of calling `window.print()` on the current page. This allows
   * the PDF page to use its own print-optimised layout rather than the full
   * website chrome.
   */
  href?: string
}

export function PrintButton({ href }: PrintButtonProps = {}) {
  const cls =
    "text-white border-white/30 bg-white/10 hover:bg-white/20 hover:text-white"

  if (href) {
    return (
      <Button asChild variant="outline" size="sm" className={cls}>
        <Link href={href} target="_blank" rel="noopener noreferrer">
          <FileDown className="h-4 w-4 mr-1.5" /> Export PDF
        </Link>
      </Button>
    )
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => window.print()}
      className={cls}
    >
      <Printer className="h-4 w-4 mr-1.5" /> PDF / Print
    </Button>
  )
}
