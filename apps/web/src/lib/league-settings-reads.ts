import { db, tenants, tenantBranding, invoices, whiteLabelRequests } from "@mtk/database"
import { and, desc, eq } from "drizzle-orm"
import { z } from "zod"

/**
 * Settings/billing readers for the exact active league.
 *
 * Every query below is predicated on the caller's resolved `tenantId`; none of them
 * fall back to the account's primary/owned league. Callers must first obtain that id
 * from `requireActiveLeagueContext`, which fails closed when there is no active
 * league or the membership lacks the permission. Reads return plain projections so a
 * page never serializes private tenant/contact fields to the client.
 */

export type LeagueIdentity = { id: string; name: string; slug: string; plan: string }

const leagueBrandingColumns = {
  appName: tenantBranding.appName,
  logoUrl: tenantBranding.logoUrl,
  faviconUrl: tenantBranding.faviconUrl,
  primaryColor: tenantBranding.primaryColor,
  secondaryColor: tenantBranding.secondaryColor,
  accentColor: tenantBranding.accentColor,
}

export type LeagueBranding = {
  appName: string | null
  logoUrl: string | null
  faviconUrl: string | null
  primaryColor: string | null
  secondaryColor: string | null
  accentColor: string | null
}

export type LeagueSettings = { tenant: LeagueIdentity; branding: LeagueBranding | null }

/** The active league's identity. An inactive or missing league is a hard failure, not an empty state. */
export async function readLeagueIdentity(tenantId: string): Promise<LeagueIdentity> {
  const [tenant] = await db.select({ id: tenants.id, name: tenants.name, slug: tenants.slug, plan: tenants.plan })
    .from(tenants).where(and(eq(tenants.id, tenantId), eq(tenants.isActive, true))).limit(1)
  if (!tenant) throw new Error("League not found")
  return tenant
}

/** The active league's branding row, or null when it has never been customized. */
export async function readLeagueBranding(tenantId: string): Promise<LeagueBranding | null> {
  const [branding] = await db.select(leagueBrandingColumns).from(tenantBranding)
    .where(eq(tenantBranding.tenantId, tenantId)).limit(1)
  return branding ?? null
}

export async function readLeagueSettings(tenantId: string): Promise<LeagueSettings> {
  const [tenant, branding] = await Promise.all([readLeagueIdentity(tenantId), readLeagueBranding(tenantId)])
  return { tenant, branding }
}

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

/** Bounded invoice history for the active league only. */
export async function readInvoices(tenantId: string, limit = 50): Promise<InvoiceSummary[]> {
  const bounded = z.number().int().min(1).max(200).parse(limit)
  return db.select({
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
    .where(eq(invoices.tenantId, tenantId))
    .orderBy(desc(invoices.createdAt))
    .limit(bounded)
}

export type InvoiceDetail = {
  id: string
  invoiceNumber: string
  status: string
  currency: string
  subtotal: string
  taxRate: string | null
  taxAmount: string | null
  total: string
  description: string | null
  plan: string | null
  periodStart: Date | null
  periodEnd: Date | null
  paidAt: Date | null
  notes: string | null
  createdAt: Date
}

/** A single invoice, only if it belongs to the active league. Returns null on a foreign id. */
export async function readInvoice(tenantId: string, id: string): Promise<InvoiceDetail | null> {
  z.string().uuid().parse(id)
  const [invoice] = await db.select({
    id: invoices.id,
    invoiceNumber: invoices.invoiceNumber,
    status: invoices.status,
    currency: invoices.currency,
    subtotal: invoices.subtotal,
    taxRate: invoices.taxRate,
    taxAmount: invoices.taxAmount,
    total: invoices.total,
    description: invoices.description,
    plan: invoices.plan,
    periodStart: invoices.periodStart,
    periodEnd: invoices.periodEnd,
    paidAt: invoices.paidAt,
    notes: invoices.notes,
    createdAt: invoices.createdAt,
  })
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)))
    .limit(1)
  return invoice ?? null
}

export type WhiteLabelRequestSummary = {
  id: string
  status: string
  customDomain: string | null
  hideBranding: boolean
  customAppName: string | null
  adminNotes: string | null
  createdAt: Date
}

/** Bounded white-label request history for the active league only. */
export async function readWhiteLabelRequests(tenantId: string, limit = 10): Promise<WhiteLabelRequestSummary[]> {
  const bounded = z.number().int().min(1).max(50).parse(limit)
  return db.select({
    id: whiteLabelRequests.id,
    status: whiteLabelRequests.status,
    customDomain: whiteLabelRequests.customDomain,
    hideBranding: whiteLabelRequests.hideBranding,
    customAppName: whiteLabelRequests.customAppName,
    adminNotes: whiteLabelRequests.adminNotes,
    createdAt: whiteLabelRequests.createdAt,
  })
    .from(whiteLabelRequests)
    .where(eq(whiteLabelRequests.tenantId, tenantId))
    .orderBy(desc(whiteLabelRequests.createdAt))
    .limit(bounded)
}
