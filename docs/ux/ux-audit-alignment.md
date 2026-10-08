# Platform UI/UX Audit & Screen Alignment Report

This document audits the entire UI/UX plane of the Shakir Super League platform (Admin, Web, and Mobile apps), confirming readiness and detail alignment for all pages, sub-pages, components, and panels.

---

## 1. ADMIN SUPER-ADMIN PANEL (@mtk/admin)

| Screen / Sub-page | Key Components | UX Status | Optimization / Fix |
|-------------------|----------------|------------|--------------------|
| **Dashboard Overview** | `RevenueMetrics`, `LeaguesList`, `SystemStatus` | Ready | Integrated dynamic fetches for DB pool and Redis latency metrics. |
| **User Impersonation UI** | `UsersManagement`, session overrides | Ready | Added a persistent floating banner: "Impersonating User: X (Click to Exit)" for visual safety. |
| **Leagues Management** | `LeaguesManagement` list, action drawers | Ready | Added double-confirmation modal before suspending active leagues. |
| **Live Scoring Overrides**| `LiveScoringClient`, overrides drawer | Ready | Added manual score editor for admin overrides (correcting scorer mistakes). |
| **System Health** | `SystemHealthDashboard` chart, log console | Ready | Plotted DB execution delays and Redis operations rates. |

---

## 2. WEB PORTAL & LEAGUE CONSOLE (@mtk/web)

### 2.1 Tournament Setup Wizard (7 Steps)
We audited and aligned the complete `TournamentWizard` setup flow:
1. **Details**: Title, dates, structure forms with date normalization.
2. **Format**: Knockout, Round Robin, or Double Elimination selector.
3. **Match Type**: T20, One Day, or custom overs validations.
4. **Branding**: League logo uploads and theme color pickers.
5. **Schedule**: Match scheduler auto-calculator (distributes matchups).
6. **Seeding**: Custom team placement in seedings groups.
7. **Registration**: Configures player/team fees and limits.

### 2.2 Analytics & Scoring Visualizations
- **Manhattan Chart**: Bar graph showing runs scored per over, overlaying wickets fallen.
- **Worm Chart**: Line graph tracking cumulative runs comparison between Team A and Team B over by over.
- **Wagon Wheel**: Interactive SVG plotting scoring directions of each ball (fours, sixes, singles).

---

## 3. MOBILE APP (@mtk/mobile)

### 3.1 RTL Urdu Layout Alignment
Tested and aligned Urdu translations for all core screens:
- **Standings (Points Table)**: Columns (`W`, `L`, `PTS`, `NRR`) mirrored correctly to RTL order.
- **Match Detail**: Live scoreboard numbers and overs details keep standard left-to-right numbers but layout texts align right.
- **Settings Screen**: Clean Urdu option switch instantly toggles layout margins and text direction.

### 3.2 Offline Scoring Queue Panel
- **Offline Banner**: Floating indicator that matches offline status.
- **Sync Queue Panel**: Displays number of pending balls (`matchBalls`) waiting to sync with PostgreSQL database, and an manual trigger sync action.
- **User Authentication**: Standard Clerk React Native sign-in wrapper handles session security.
