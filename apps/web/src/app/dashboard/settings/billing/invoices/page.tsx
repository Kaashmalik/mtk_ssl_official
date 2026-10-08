import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@clerk/nextjs/server"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { getMyInvoices } from "@/lib/invoices"
import { unstable_noStore as noStore } from "next/cache"

export const metadata = { title: "Invoices" }

export default async function InvoicesPage() {
  noStore()
  const { userId } = await auth()
  if (!userId) redirect("/")

  const rows = await getMyInvoices()
  const fmt = (total: string, currency: string) =>
    new Intl.NumberFormat("en-PK", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(total))

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Invoices &amp; Receipts</h1>
        <p className="text-muted-foreground mt-1">Every settled payment, ready to print or save as PDF.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Billing History</CardTitle>
          <CardDescription>{rows.length} invoice{rows.length === 1 ? "" : "s"}</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No invoices yet. An invoice is generated automatically when a payment is approved.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="py-2 text-left font-medium">Invoice</th>
                    <th className="py-2 text-left font-medium">Plan</th>
                    <th className="py-2 text-left font-medium">Date</th>
                    <th className="py-2 text-left font-medium">Status</th>
                    <th className="py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-2">
                        <Link href={`/dashboard/settings/billing/${r.id}`} className="font-mono text-xs text-primary underline">
                          {r.invoiceNumber}
                        </Link>
                      </td>
                      <td className="py-2 capitalize">{r.plan ?? "—"}</td>
                      <td className="py-2 text-muted-foreground">
                        {new Date(r.paidAt ?? r.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-2">
                        <Badge variant="outline" className="uppercase">{r.status}</Badge>
                      </td>
                      <td className="py-2 text-right tabular-nums font-medium">{fmt(r.total, r.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}