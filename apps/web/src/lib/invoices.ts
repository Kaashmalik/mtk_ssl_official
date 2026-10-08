import { db, invoices } from "@mtk/database"
import { desc, eq } from "drizzle-orm"
import { getMyTenant } from "@/app/actions/tenants"

export type InvoiceSummary = {
  id: string
  invoiceNumber: string
  plan: string | null
  status: string
  total: string
  currency: string
  paidAt: Date | null
  createdAt: Date
}

export async function getMyInvoices(): Promise<InvoiceSummary[]> {
  const tenant = await getMyTenant()
  if (!tenant) return []

  return db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      plan: invoices.plan,
      status: invoices.status,
      total: invoices.total,
      currency: invoices.currency,
      paidAt: invoices.paidAt,
      createdAt: invoices.createdAt,
    })
    .from(invoices)
    .where(eq(invoices.tenantId, tenant.id))
    .orderBy(desc(invoices.createdAt))
    .limit(50)
}