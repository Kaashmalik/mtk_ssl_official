import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { notFound } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Separator } from "@mtk/ui/components/ui/separator"
import { PrintButton } from "@/components/share/print-button"
import { db, invoices, tenants } from "@mtk/database"
import { and, eq } from "drizzle-orm"
import { getMyTenant } from "@/app/actions/tenants"
import { unstable_noStore as noStore } from "next/cache"

/**
 * Printable invoice / receipt for the signed-in league owner.
 * Tenant-scoped: an invoice is only visible to the league that owns it.
 */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  noStore()

  const { userId } = await auth()
  if (!userId) redirect("/sign-in")

  const { id } = await params
  const tenant = await getMyTenant()
  if (!tenant) redirect("/dashboard/league/setup")

  const [invoice] = await db.select().from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenant.id)))
    .limit(1)
  if (!invoice) notFound()

  const [league] = await db.select({ name: tenants.name, slug: tenants.slug })
    .from(tenants).where(eq(tenants.id, tenant.id)).limit(1)

  const subtotal = Number(invoice.subtotal)
  const taxAmount = Number(invoice.taxAmount)
  const total = Number(invoice.total)
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-PK", { style: "currency", currency: invoice.currency, maximumFractionDigits: 2 }).format(n)

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-2xl font-bold">Invoice</h1>
        <PrintButton />
      </div>

      <Card>
        <CardHeader className="border-b">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-xl">Shakir Super League</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {league?.name}
                {league?.slug ? ` · ${league.slug}` : ""}
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-sm font-semibold">{invoice.invoiceNumber}</p>
              <Badge variant="outline" className="mt-1 uppercase">{invoice.status}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6 space-y-6">
          <div className="grid grid-cols-2 gap-6 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Issued</p>
              <p>{invoice.createdAt ? new Date(invoice.createdAt).toLocaleDateString() : "—"}</p>
              {invoice.paidAt && (
                <>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mt-3 mb-1">Paid</p>
                  <p>{new Date(invoice.paidAt).toLocaleDateString()}</p>
                </>
              )}
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Billing period</p>
              <p>
                {invoice.periodStart ? new Date(invoice.periodStart).toLocaleDateString() : "—"}
                {" → "}
                {invoice.periodEnd ? new Date(invoice.periodEnd).toLocaleDateString() : "—"}
              </p>
              {invoice.plan && (
                <>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mt-3 mb-1">Plan</p>
                  <p className="capitalize">{invoice.plan}</p>
                </>
              )}
            </div>
          </div>

          <Separator />

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span>{invoice.description ?? "Subscription"}</span>
              <span className="tabular-nums">{fmt(subtotal)}</span>
            </div>
            {taxAmount > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Tax ({Number(invoice.taxRate)}%)</span>
                <span className="tabular-nums">{fmt(taxAmount)}</span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between text-base font-semibold">
              <span>Total paid</span>
              <span className="tabular-nums">{fmt(total)}</span>
            </div>
          </div>

          {invoice.notes && (
            <>
              <Separator />
              <p className="text-xs text-muted-foreground">{invoice.notes}</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}