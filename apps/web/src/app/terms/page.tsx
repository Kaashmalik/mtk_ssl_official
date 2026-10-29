import React from "react"
import { LegalPage } from "@/components/public/legal-page"
import type { ProseBlock } from "@/components/public/prose"
import { OPERATOR } from "@/lib/legal"
import { buildPageMetadata } from "@/lib/site-metadata"

export const metadata = buildPageMetadata({
  title: "Terms of Service",
  description: `The terms for using the cricket league platform operated by ${OPERATOR.company}: accounts, organizer responsibilities, acceptable use, content and liability.`,
  path: "/terms",
})

const mail = `[${OPERATOR.email}](mailto:${OPERATOR.email})`

const BLOCKS: readonly ProseBlock[] = [
  { type: "h2", text: "1. Agreement" },
  { type: "p", text: `These Terms of Service ("Terms") govern your use of this website and the cricket league platform (the "Service") operated by **${OPERATOR.company}**, ${OPERATOR.city}, ${OPERATOR.country} ("we", "us"). By using the Service you agree to these Terms. If you use it on behalf of a club or league, you confirm you are authorized to accept these Terms for that organization.` },

  { type: "h2", text: "2. The Service" },
  { type: "p", text: "The Service lets cricket leagues manage competitions, teams, registrations and fixtures, score matches ball by ball, and publish results, standings and statistics. Some features are available only on certain plans or after a league application is approved. We may add, change or remove features over time." },

  { type: "h2", text: "3. Accounts" },
  { type: "ul", items: [
    "You must give accurate information and keep it up to date.",
    "You are responsible for keeping your sign-in details secure and for activity under your account. Tell us at once if you suspect unauthorized use.",
    "You must be at least 13 years old to create an account.",
  ] },

  { type: "h2", text: "4. League organizers" },
  { type: "p", text: "If you run a league on the Service, you are responsible for:" },
  { type: "ul", items: [
    "The accuracy of the competitions, teams, players and results you enter or approve.",
    "Having a lawful basis, and any consent needed, to enter and publish players' personal information, including permission from a parent or guardian for players under 18.",
    "Your league's own rules, eligibility decisions, fees and dispute resolution. We provide the tools; we are not a party to disputes between leagues, teams and players.",
    "Choosing what to publish. Published information is visible to anyone and may be indexed by search engines.",
  ] },

  { type: "h2", text: "5. Acceptable use" },
  { type: "p", text: "You must not:" },
  { type: "ul", items: [
    "Break any law, or use the Service for betting fraud, match-fixing or to manipulate results.",
    "Upload content that is unlawful, defamatory, hateful, sexually explicit, or that infringes someone else's rights.",
    "Harass, threaten or impersonate any person.",
    "Try to access data or accounts you are not authorized to access, probe or disrupt the Service, or bypass its security or rate limits.",
    "Scrape the Service at scale, or resell it, without our written permission.",
    "Click on advertisements dishonestly or encourage others to do so.",
  ] },

  { type: "h2", text: "6. Your content" },
  { type: "p", text: "You keep ownership of the content you submit, such as team names, logos, photos and match data. You give us a worldwide, non-exclusive, royalty-free licence to host, store, display and process that content to operate, publish and improve the Service, including on public pages your league chooses to publish. This licence ends when the content is deleted, except for copies kept in backups for a limited time or where we must keep them by law." },
  { type: "p", text: "We may remove content or suspend accounts that break these Terms." },

  { type: "h2", text: "7. Our content" },
  { type: "p", text: `The Service's software, design, logos and original written content, including our [guides](/guides), belong to ${OPERATOR.company}. You may share links to them, but you may not copy them in bulk or republish them as your own.` },

  { type: "h2", text: "8. Fees" },
  { type: "p", text: "Where a plan or feature is paid, the price, billing period and any refund terms are shown before you pay. Fees that a league charges its own teams are the league's responsibility." },

  { type: "h2", text: "9. Advertising and third-party services" },
  { type: "p", text: "Public pages may show advertising served by Google and its partners, as described in our [Privacy Policy](/privacy). The Service also relies on third-party providers; links to third-party websites are provided for convenience and we are not responsible for their content." },

  { type: "h2", text: "10. Availability and disclaimers" },
  { type: "p", text: "We work hard to keep the Service available and accurate, but it is provided \"as is\" and \"as available\". We do not guarantee that it will be uninterrupted or error-free, or that statistics entered by leagues are correct. Keep your own records of anything critical to you." },

  { type: "h2", text: "11. Limitation of liability" },
  { type: "p", text: `To the extent permitted by law, ${OPERATOR.company} is not liable for indirect, incidental or consequential losses, or for loss of data, profits or goodwill, arising from your use of the Service. Our total liability for any claim is limited to the amount you paid us for the Service in the twelve months before the claim, or, if you paid nothing, a nominal amount. Nothing in these Terms limits liability that cannot be limited by law.` },

  { type: "h2", text: "12. Suspension and termination" },
  { type: "p", text: `You may stop using the Service at any time and ask us to close your account by emailing ${mail}. We may suspend or end access if you seriously or repeatedly break these Terms, or where required by law. Sections that by their nature should continue (such as content licences already granted for published records, disclaimers and limitation of liability) survive termination.` },

  { type: "h2", text: "13. Governing law" },
  { type: "p", text: `These Terms are governed by the laws of ${OPERATOR.country}. Disputes are subject to the jurisdiction of the courts of ${OPERATOR.city}, unless the law of your country gives you the right to bring proceedings where you live.` },

  { type: "h2", text: "14. Changes" },
  { type: "p", text: "We may update these Terms. We will change the date at the top and, for significant changes, give notice on the site or by email. Continuing to use the Service after changes take effect means you accept them." },

  { type: "h2", text: "15. Contact" },
  { type: "p", text: `Questions about these Terms: ${mail}, or see our [contact page](/contact).` },
]

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Terms of Service"
      intro="Please read these terms carefully. They explain your rights and responsibilities when you use the platform, whether you run a league, score matches or follow results."
      blocks={BLOCKS}
    />
  )
}
