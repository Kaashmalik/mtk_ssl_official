import React from "react"
import { LegalPage } from "@/components/public/legal-page"
import type { ProseBlock } from "@/components/public/prose"
import { OPERATOR } from "@/lib/legal"
import { buildPageMetadata } from "@/lib/site-metadata"

export const metadata = buildPageMetadata({
  title: "Privacy Policy",
  description: `How ${OPERATOR.company} collects, uses and protects personal data, including cookies and Google advertising, and how to exercise your privacy rights.`,
  path: "/privacy",
})

const mail = `[${OPERATOR.email}](mailto:${OPERATOR.email})`

const BLOCKS: readonly ProseBlock[] = [
  { type: "h2", text: "Who we are" },
  { type: "p", text: `This website and the cricket league platform behind it (the "Service") are operated by **${OPERATOR.company}**, ${OPERATOR.city}, ${OPERATOR.country} ("we", "us"). Individual cricket leagues use the Service under their own names; for the personal data described here, ${OPERATOR.company} is the operator you can contact at ${mail}.` },

  { type: "h2", text: "Information we collect" },
  { type: "h3", text: "Information you give us" },
  { type: "ul", items: [
    "**Account details**: your name, email address and, if you provide it, phone number, used to sign in and secure your account.",
    "**League and match data**: teams, squads, fixtures, venues, scores and statistics entered by league organizers and scorers. This can include players' names, photos and performance records.",
    "**Applications, registrations and messages**: information you submit when applying for a league, registering a team or contacting us.",
    "**Payment records**: when a plan or registration fee is paid, we keep the amount, date and reference. Card details are handled by the payment provider and are not stored by us.",
  ] },
  { type: "h3", text: "Information collected automatically" },
  { type: "ul", items: [
    "**Usage and device data**: pages visited, browser and device type, approximate location derived from IP address, and timestamps, used to run, secure and improve the Service.",
    "**Error reports**: technical details when something goes wrong, so we can fix it.",
    "**Cookies and similar technologies**, described below.",
  ] },

  { type: "h2", text: "How we use information" },
  { type: "ul", items: [
    "To provide the Service: accounts, league management, live scoring, standings and public match pages.",
    "To keep the Service secure, prevent abuse and fraud, and enforce our [Terms of Service](/terms).",
    "To communicate with you about your account, your league or your requests.",
    "To understand how the Service is used and improve it.",
    "To show advertising on public pages, as described below.",
    "To comply with legal obligations.",
  ] },

  { type: "h2", text: "Public information" },
  { type: "p", text: "Leagues choose what to publish. Published tournaments, fixtures, scorecards, standings and leaderboards are public and may be indexed by search engines. Drafts and unpublished competitions are never shown publicly. Individual public career profiles appear only where the player's consent is recorded. If you believe information about you has been published in error, contact the league organizer or email us." },

  { type: "h2", text: "Cookies", id: "cookies" },
  { type: "p", text: "Cookies are small files stored by your browser. We use:" },
  { type: "ul", items: [
    "**Essential cookies** to keep you signed in, protect forms and remember settings such as theme and language. The Service cannot work without them.",
    "**Advertising cookies** set by Google and its partners on public pages, described in the next section. Where the law requires it (for example in the European Economic Area, the United Kingdom and Switzerland), these are only used after you give consent through the consent message shown on the site.",
  ] },
  { type: "p", text: "You can change your choice at any time using the **Cookie settings** link in the footer, and you can block or delete cookies in your browser settings. Blocking essential cookies will stop sign-in from working." },

  { type: "h2", text: "Advertising and Google AdSense" },
  { type: "p", text: "We use Google AdSense to show ads on public reading pages, such as our guides and public cricket pages. Ads are never shown inside the league management dashboard or the scorer's screen." },
  { type: "ul", items: [
    "Third-party vendors, including Google, use cookies to serve ads based on a user's prior visits to this website or other websites.",
    "Google's use of advertising cookies enables it and its partners to serve ads to users based on their visit to this site and/or other sites on the Internet.",
    "You may opt out of personalized advertising by visiting [Google Ads Settings](https://www.google.com/settings/ads). You can also opt out of some third-party vendors' use of cookies for personalized advertising at [www.aboutads.info/choices](https://www.aboutads.info/choices).",
    "Learn more in [How Google uses information from sites or apps that use its services](https://policies.google.com/technologies/partner-sites).",
  ] },
  { type: "p", text: "Where consent is required, Google's certified consent message lets you accept, reject or customize advertising cookies. If you decline, you may still see non-personalized ads." },

  { type: "h2", text: "Service providers we share data with" },
  { type: "p", text: "We do not sell personal data. We share it only with providers that help us run the Service, under contracts that limit their use of it:" },
  { type: "ul", items: [
    "Authentication and account security (Clerk).",
    "Database and hosting infrastructure (Supabase and our hosting provider).",
    "Image and media storage (Cloudinary).",
    "Error monitoring (Sentry).",
    "Email and SMS delivery providers for notifications you request.",
    "Payment providers, when you make a payment.",
    "Google, for advertising on public pages, as described above.",
  ] },
  { type: "p", text: "We may also disclose information if required by law, or to protect the rights, safety and property of our users, the public or ourselves." },

  { type: "h2", text: "International transfers" },
  { type: "p", text: `Our providers may process data in countries other than ${OPERATOR.country}, including the United States and the European Union. Where we transfer data internationally, we rely on providers that apply recognized safeguards.` },

  { type: "h2", text: "How long we keep data" },
  { type: "p", text: "We keep account data while your account is active. Match records and statistics form a league's historical record and are kept while the league uses the Service, unless the league or you ask us to remove them and no legal reason requires us to keep them. Logs and error reports are kept for a limited period for security and troubleshooting." },

  { type: "h2", text: "Security" },
  { type: "p", text: "We use encryption in transit (HTTPS), access controls that isolate each league's data, and restricted administrative access. No system is perfectly secure, so please use a strong, unique password and tell us straight away if you suspect unauthorized access." },

  { type: "h2", text: "Your rights" },
  { type: "p", text: `Depending on where you live, you may have the right to access, correct, delete or export your personal data, to object to or restrict certain processing, and to withdraw consent. To make a request, email ${mail} from the address linked to your account. We will respond within a reasonable time and may need to verify your identity. If you are in the EEA or UK you may also complain to your local data protection authority.` },

  { type: "h2", text: "Children" },
  { type: "p", text: "The Service is not directed at children under 13, and they should not create accounts. Junior cricketers may appear in league records entered by their club or league; organizers are responsible for obtaining a parent or guardian's permission before publishing a minor's information. A parent or guardian can ask us to remove a child's information at any time." },

  { type: "h2", text: "Changes to this policy" },
  { type: "p", text: "We will update this page when our practices change and revise the date at the top. For significant changes we will give notice on the site or by email." },

  { type: "h2", text: "Contact" },
  { type: "p", text: `Questions or requests about privacy: ${mail}, or see our [contact page](/contact). ${OPERATOR.company}, ${OPERATOR.city}, ${OPERATOR.country}.` },
]

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy Policy"
      intro="This policy explains what personal data we collect, why we collect it, how cookies and advertising work on this site, and the choices you have."
      blocks={BLOCKS}
    />
  )
}
