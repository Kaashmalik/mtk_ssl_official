"use client"

/**
 * Shared payment configuration for billing and upgrade modals.
 *
 * All values are read from NEXT_PUBLIC_PAYMENT_* environment variables.
 * Fallback values are provided for development only — in production,
 * these MUST be configured via environment variables.
 *
 * Required env vars:
 *   NEXT_PUBLIC_PAYMENT_BANK_NAME
 *   NEXT_PUBLIC_PAYMENT_BANK_TITLE
 *   NEXT_PUBLIC_PAYMENT_BANK_ACCOUNT
 *   NEXT_PUBLIC_PAYMENT_BANK_IBAN
 *   NEXT_PUBLIC_PAYMENT_BANK_BRANCH
 *   NEXT_PUBLIC_PAYMENT_JAZZCASH_NAME
 *   NEXT_PUBLIC_PAYMENT_JAZZCASH_NUMBER
 *   NEXT_PUBLIC_PAYMENT_EASYPAISA_NAME
 *   NEXT_PUBLIC_PAYMENT_EASYPAISA_NUMBER
 *   NEXT_PUBLIC_PAYMENT_RAAST_ID
 */

const isDev = process.env.NODE_ENV !== "production"

// In production, show a "not configured" placeholder instead of personal details
const devFallback = (value: string) => isDev ? value : "Not configured"

export const PAYMENT_CONFIG = {
  bankName: process.env.NEXT_PUBLIC_PAYMENT_BANK_NAME || devFallback("Meezan Bank"),
  bankTitle: process.env.NEXT_PUBLIC_PAYMENT_BANK_TITLE || devFallback("MUHAMMAD KASHIF"),
  bankAccount: process.env.NEXT_PUBLIC_PAYMENT_BANK_ACCOUNT || devFallback("11330109676650"),
  bankIban: process.env.NEXT_PUBLIC_PAYMENT_BANK_IBAN || devFallback("PK26MEZN0011330109676650"),
  bankBranch: process.env.NEXT_PUBLIC_PAYMENT_BANK_BRANCH || devFallback("BHUBTIAN BRANCH, LAHORE"),
  jazzcashName: process.env.NEXT_PUBLIC_PAYMENT_JAZZCASH_NAME || devFallback("Muhammad Kashif"),
  jazzcashNumber: process.env.NEXT_PUBLIC_PAYMENT_JAZZCASH_NUMBER || devFallback("03020718182"),
  easypaisaName: process.env.NEXT_PUBLIC_PAYMENT_EASYPAISA_NAME || devFallback("Muhammad Kashif"),
  easypaisaNumber: process.env.NEXT_PUBLIC_PAYMENT_EASYPAISA_NUMBER || devFallback("03020718182"),
  raastId: process.env.NEXT_PUBLIC_PAYMENT_RAAST_ID || devFallback("03020718182"),
} as const
