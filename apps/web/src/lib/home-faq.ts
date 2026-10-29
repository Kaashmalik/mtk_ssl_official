/**
 * Home page FAQ: rendered visibly by HomeContent AND emitted as FAQPage
 * JSON-LD by StructuredData, from this one list, because Google requires
 * structured-data answers to match what the visitor sees. Every answer
 * describes a shipped capability (same honesty rules as the landing page);
 * no numbers, prices or rankings.
 */
export const HOME_FAQ = [
  {
    question: "What does this cricket league app do?",
    answer:
      "It runs a cricket league end to end: set up tournaments and venues, open team registrations, generate fixtures and knockouts, score every ball live, and publish points tables, net run rate and player leaderboards.",
  },
  {
    question: "Can I score a cricket match live on my phone?",
    answer:
      "Yes. The scorer view has large one-hand controls that stay readable in sunlight, with undo, wicket details and extras. Every ball reaches fans as soon as it is scored.",
  },
  {
    question: "What happens if the internet drops during a match?",
    answer:
      "Scoring carries on offline. Balls recorded without signal wait in a visible queue and sync in order when the connection returns, so nothing is lost.",
  },
  {
    question: "Are points tables and net run rate calculated automatically?",
    answer:
      "Yes. Standings, net run rate and player batting and bowling records update from real scored results, with no spreadsheets to maintain.",
  },
  {
    question: "Can players and fans follow scores without an account?",
    answer:
      "Yes. Published matches, scorecards, standings and leaderboards are public pages that anyone can open and share with one link.",
  },
  {
    question: "How do I start my own cricket league?",
    answer:
      "Apply for your league. Once it is approved your workspace is ready: add teams, open registrations, generate the schedule and assign scorers.",
  },
] as const
