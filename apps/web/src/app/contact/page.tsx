import React from "react"
import { Mail, MapPin } from "lucide-react"
import { LegalPage } from "@/components/public/legal-page"
import { JsonLd } from "@/components/json-ld"
import type { ProseBlock } from "@/components/public/prose"
import { OPERATOR } from "@/lib/legal"
import { appUrl, buildPageMetadata } from "@/lib/site-metadata"

export const metadata = buildPageMetadata({
  title: "Contact us",
  description: `Contact ${OPERATOR.company} about running your cricket league, technical support, privacy requests or partnerships. Email ${OPERATOR.email}.`,
  path: "/contact",
})

const BLOCKS: readonly ProseBlock[] = [
  { type: "h2", text: "How we can help" },
  { type: "ul", items: [
    "**Start a league**: tell us your league's name, city, number of teams and the format you play. You can also apply directly after [signing in](/sign-in).",
    "**Technical support**: include the page address, what you expected to happen, what happened instead, and a screenshot if possible.",
    "**Score or record corrections**: please contact your league organizer first; they can correct match records. Email us if you cannot reach them.",
    "**Privacy requests**: to access, correct or delete your data, email us from the address linked to your account. See our [Privacy Policy](/privacy).",
    "**Partnerships, sponsorship and advertising** enquiries are welcome too.",
  ] },
  { type: "p", text: "We read every message and reply as soon as we can, normally within a few working days." },
]

export default function ContactPage() {
  const base = appUrl()
  const contactPage = {
    "@context": "https://schema.org",
    "@type": "ContactPage",
    url: `${base}/contact`,
    name: "Contact us",
    mainEntity: {
      "@type": "Organization",
      name: OPERATOR.company,
      email: OPERATOR.email,
      address: { "@type": "PostalAddress", addressLocality: OPERATOR.city, addressCountry: "PK" },
      contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: OPERATOR.email, availableLanguage: ["English", "Urdu"] },
    },
  }
  return (
    <>
      <JsonLd data={contactPage} />
      <LegalPage
        eyebrow="Contact"
        title="Contact us"
        intro="Questions about running a league, a problem with the app, or a privacy request? We would like to hear from you."
        blocks={BLOCKS}
        showUpdated={false}
      >
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <a
            href={`mailto:${OPERATOR.email}`}
            className="group flex items-start gap-4 rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/40"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Mail className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold">Email</span>
              <span className="mt-1 block break-all text-primary group-hover:underline">{OPERATOR.email}</span>
            </span>
          </a>
          <div className="flex items-start gap-4 rounded-2xl border border-border bg-card p-6">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MapPin className="h-5 w-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block font-semibold">{OPERATOR.company}</span>
              <span className="mt-1 block text-muted-foreground">
                {OPERATOR.city}, {OPERATOR.country}
              </span>
            </span>
          </div>
        </div>
      </LegalPage>
    </>
  )
}
