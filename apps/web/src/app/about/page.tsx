import React from "react"
import { LegalPage } from "@/components/public/legal-page"
import { JsonLd } from "@/components/json-ld"
import type { ProseBlock } from "@/components/public/prose"
import { OPERATOR } from "@/lib/legal"
import { appUrl, buildPageMetadata } from "@/lib/site-metadata"

export const metadata = buildPageMetadata({
  title: "About us",
  description: `Who builds this cricket league platform: ${OPERATOR.company} in ${OPERATOR.city}, ${OPERATOR.country}, and why we built tools for organizers, scorers, players and fans.`,
  path: "/about",
})

const BLOCKS: readonly ProseBlock[] = [
  { type: "h2", text: "Who we are" },
  { type: "p", text: `This platform is built and operated by **${OPERATOR.company}**, a software company based in ${OPERATOR.city}, ${OPERATOR.country}. We build for the problems that show up at every level of club, school and tape-ball cricket: fixtures shared as blurry photos, scorebooks that never get added up, and points tables that arrive days late with mistakes nobody can check.` },

  { type: "h2", text: "What we built" },
  { type: "p", text: "One dependable place to run a cricket league, from the first fixture to the final score:" },
  { type: "ul", items: [
    "**Competition management**: tournaments, groups, knockouts, venues and fixtures.",
    "**Registrations**: teams apply, submit squads and pay entry fees; organizers see exactly which requirement is still open.",
    "**Ball-by-ball live scoring** designed for real grounds: large controls, undo, and scoring that keeps working offline and syncs when signal returns.",
    "**Automatic results**: points tables, net run rate, leaderboards and player career records built from every scored ball.",
    "**Public pages** for players and fans: live matches, scorecards, standings and a [public hub](/hub) of leagues that choose to be listed.",
  ] },

  { type: "h2", text: "What we believe" },
  { type: "ul", items: [
    "**Accuracy over hype.** Statistics are only shown when they come from real scored data, and drafts are never published.",
    "**Privacy by default.** Leagues decide what becomes public, and players' public profiles depend on their consent. Read our [Privacy Policy](/privacy).",
    "**Built for the ground, not the office.** Every scoring screen is designed for a phone in bright sunlight with patchy signal.",
  ] },

  { type: "h2", text: "Our guides" },
  { type: "p", text: "We publish free [cricket guides](/guides) on organizing tournaments, scoring, and rules such as extras, dismissals and net run rate. They follow the MCC Laws of Cricket, and where competitions commonly differ we say so rather than presenting one local rule as the law. If you spot a mistake, please tell us and we will correct it." },

  { type: "h2", text: "Get in touch" },
  { type: "p", text: `Want to run your league here, report a problem or work with us? Email [${OPERATOR.email}](mailto:${OPERATOR.email}) or visit our [contact page](/contact).` },
]

export default function AboutPage() {
  const base = appUrl()
  const aboutPage = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    url: `${base}/about`,
    name: "About us",
    about: {
      "@type": "Organization",
      name: OPERATOR.company,
      email: OPERATOR.email,
      address: { "@type": "PostalAddress", addressLocality: OPERATOR.city, addressCountry: "PK" },
    },
  }
  return (
    <>
      <JsonLd data={aboutPage} />
      <LegalPage
        eyebrow="About"
        title="Built by cricket people, for cricket leagues"
        intro="We make it simple to run a cricket league properly: organized fixtures, accurate live scores and results everyone can trust."
        blocks={BLOCKS}
        showUpdated={false}
      />
    </>
  )
}
