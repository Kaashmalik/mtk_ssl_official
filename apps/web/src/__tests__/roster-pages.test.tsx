import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import TeamsPage from "@/app/dashboard/teams/page"
import PlayersPage from "@/app/dashboard/players/page"
import TeamDetailPage from "@/app/dashboard/teams/[id]/page"
import PlayerDetailPage from "@/app/dashboard/players/[id]/page"
import NewTeamPage from "@/app/dashboard/teams/new/page"
import NewPlayerPage from "@/app/dashboard/players/new/page"
import EditTeamPage from "@/app/dashboard/teams/[id]/edit/page"
import EditPlayerPage from "@/app/dashboard/players/[id]/edit/page"
import { DeleteButton } from "@/components/shared/delete-button"
import { TeamRosterManager } from "@/components/teams/team-roster-manager"
import { PlayerIdActions } from "@/components/players/player-id-actions"
import { PlayerListTable } from "@/components/players/player-list-table"
import { TeamListGrid } from "@/components/teams/team-list-grid"
import { EditPlayerForm } from "@/components/players/edit-player-form"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), context: vi.fn(), permission: vi.fn(), team: vi.fn(), player: vi.fn(),
  squad: vi.fn(), teams: vi.fn(), players: vi.fn(), editable: vi.fn(), options: vi.fn(), teamHistory: vi.fn(), playerHistory: vi.fn(),
  follow: vi.fn(), select: vi.fn(), where: vi.fn() }))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) },
  notFound: () => { throw new Error("not-found") } }))
vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }))
vi.mock("@/lib/rbac-server", () => ({ requirePermissionServer: mocks.permission }))
vi.mock("@/lib/roster-reads", async original => ({ ...await original<typeof import("@/lib/roster-reads")>(),
  requireRosterReadContext: mocks.context, readRosterTeam: mocks.team, readRosterPlayer: mocks.player,
  readRosterSquad: mocks.squad, readRosterTeams: mocks.teams, readRosterPlayers: mocks.players,
  readEditableRosterPlayer: mocks.editable, readRosterTeamOptions: mocks.options,
}))
vi.mock("@/lib/roster-history", async original => ({ ...await original<typeof import("@/lib/roster-history")>(),
  readRosterTeamHistory: mocks.teamHistory, readRosterPlayerHistory: mocks.playerHistory, readRosterFollowState: mocks.follow,
}))
vi.mock("@/app/actions/teams", () => ({ deleteTeam: vi.fn() }))
vi.mock("@/app/actions/players", () => ({ deletePlayer: vi.fn() }))
vi.mock("@/components/shared/delete-button", () => ({ DeleteButton: () => null }))
vi.mock("@/components/shared/follow-button", () => ({ FollowButton: () => null }))
vi.mock("@/components/players/player-id-actions", () => ({ PlayerIdActions: () => null }))
vi.mock("@/components/teams/team-roster-manager", () => ({ TeamRosterManager: () => null }))
vi.mock("@/components/players/player-list-table", () => ({ PlayerListTable: () => null }))
vi.mock("@/components/teams/team-list-grid", () => ({ TeamListGrid: () => null }))
vi.mock("@/components/players/edit-player-form", () => ({ EditPlayerForm: () => null }))
vi.mock("@/components/players/new-player-form", () => ({ NewPlayerForm: () => null }))
vi.mock("@/components/teams/edit-team-form", () => ({ EditTeamForm: () => null }))
vi.mock("@/components/teams/new-team-form", () => ({ NewTeamForm: () => null }))
vi.mock("@mtk/database", async original => ({ ...await original<typeof import("@mtk/database")>(), db: { select: mocks.select } }))
const TENANT = "00000000-0000-4000-8000-000000000001"
const ACTOR = "00000000-0000-4000-8000-000000000002"
const TEAM = "00000000-0000-4000-8000-000000000003"
const PLAYER = "00000000-0000-4000-8000-000000000004"
const OTHER = "00000000-0000-4000-8000-000000000005"
const context = { tenantId: TENANT, clerkId: "clerk", actorId: ACTOR, role: "league_owner" }
const team = { id: TEAM, tenantId: TENANT, name: "Team", isActive: true, managerId: ACTOR, captainId: null,
  primaryColor: null, playerCount: 1, wins: 0, losses: 0, played: 0 }
const player = { id: PLAYER, tenantId: TENANT, teamId: TEAM, name: "Player", teamName: "Team", teamIsActive: true, isActive: true, status: "active" }
const privatePlayer = { ...player, email: "secret@example.test", phone: "secret-phone", dateOfBirth: "2000-02-29", biography: "Secret biography" }
const pagination = { page: 1, pageSize: 100, total: 101, totalPages: 2 }
const teamParams = { params: Promise.resolve({ id: TEAM }) }
const playerParams = { params: Promise.resolve({ id: PLAYER }) }
function elements(node: any): React.ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!React.isValidElement(node)) return []
  return [node as React.ReactElement<any>, ...elements((node.props as any).children)]
}
function text(node: any): string {
  if (Array.isArray(node)) return node.map(text).join(" ")
  if (React.isValidElement(node)) return text((node.props as any).children)
  return typeof node === "string" || typeof node === "number" ? String(node) : ""
}
function links(node: any) { return elements(node).map(element => element.props.href).filter(Boolean) }
const routes = [
  ["team list", () => TeamsPage({}), "team:read"], ["player list", () => PlayersPage({}), "player:read"],
  ["team detail", () => TeamDetailPage(teamParams), "team:read"], ["player detail", () => PlayerDetailPage(playerParams), "player:read"],
  ["new team", () => NewTeamPage(), "team:create"], ["new player", () => NewPlayerPage(), "player:create"],
  ["edit team", () => EditTeamPage(teamParams), "team:update"], ["edit player", () => EditPlayerPage(playerParams), "player:update"],
] as const
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk" })
  mocks.context.mockResolvedValue(context)
  mocks.permission.mockResolvedValue(undefined)
  mocks.team.mockResolvedValue(team)
  mocks.player.mockResolvedValue(player)
  mocks.squad.mockResolvedValue([player])
  mocks.teams.mockResolvedValue({ data: [team], pagination })
  mocks.players.mockResolvedValue({ data: [player], pagination })
  mocks.editable.mockResolvedValue(privatePlayer)
  mocks.options.mockResolvedValue({ teams: [{ id: TEAM, name: "Team" }], truncated: false })
  mocks.teamHistory.mockResolvedValue({ fixtures: [], names: [], innings: [] })
  mocks.playerHistory.mockResolvedValue({ batting: [], bowling: [], fixtures: [], names: [], competitions: [] })
  mocks.follow.mockResolvedValue({ following: false, followers: 0 })
  mocks.select.mockReturnValue({ from: () => ({ where: mocks.where }) })
  mocks.where.mockReturnValue({ limit: async () => [] })
})
describe.each(routes)("%s core roster dashboard route", (_label, render, permission) => {
  it("requests current explicit authority before records/forms", async () => {
    await render()
    expect(mocks.context).toHaveBeenCalledWith(permission)
    for (const reader of [mocks.team, mocks.player, mocks.teams, mocks.players, mocks.squad, mocks.options, mocks.editable]) {
      if (reader.mock.calls.length) expect(reader.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.context.mock.invocationCallOrder[0])
    }
  })
  it.each(["Forbidden", "Resolution unavailable", "Database unavailable"])("does not redirect to setup or query records on %s", async message => {
    mocks.context.mockRejectedValue(new Error(message))
    await expect(render()).rejects.toThrow(message)
    for (const reader of [mocks.team, mocks.player, mocks.teams, mocks.players, mocks.squad, mocks.options, mocks.editable,
      mocks.teamHistory, mocks.playerHistory, mocks.follow, mocks.select]) expect(reader).not.toHaveBeenCalled()
  })
})
describe("Roster page scope, limits and private-data serialization", () => {
  it.each([TeamsPage, PlayersPage])("redirects anonymous list visits before resolving context", async render => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(render({})).rejects.toThrow("redirect:/")
    expect(mocks.context).not.toHaveBeenCalled()
  })
  it("scopes lists to the authorized active league and passes only client display fields", async () => {
    mocks.players.mockResolvedValue({ data: [{ ...privatePlayer, userId: ACTOR, profileId: OTHER, createdBy: "secret" }], pagination })
    const playersTree = await PlayersPage({ searchParams: Promise.resolve({ page: "2" }) })
    const teamsTree = await TeamsPage({ searchParams: Promise.resolve({ page: "2" }) })
    expect(mocks.players).toHaveBeenCalledWith(TENANT, { page: 2, pageSize: 100 })
    expect(mocks.teams).toHaveBeenCalledWith(TENANT, { page: 2, pageSize: 100 })
    const clientPlayers = elements(playersTree).find(element => element.type === PlayerListTable)!.props.initialPlayers
    expect(JSON.stringify(clientPlayers)).not.toMatch(/secret|email|phone|dateOfBirth|userId|profileId|createdBy|biography/)
    const clientTeams = elements(teamsTree).find(element => element.type === TeamListGrid)!.props.initialTeams
    expect(clientTeams[0]).not.toHaveProperty("managerId")
    expect(clientTeams[0]).not.toHaveProperty("tenantId")
    expect(text(playersTree)).toContain("Search and filters apply to this page")
    expect(text(teamsTree)).toContain("including archived teams")
    expect(links(playersTree)).toContain("?page=1")
  })
  it.each(["team_manager", "coach", "scorer", "player", "fan"])("does not show create links to %s even in empty lists", async role => {
    mocks.context.mockResolvedValue({ ...context, role })
    mocks.teams.mockResolvedValue({ data: [], pagination })
    mocks.players.mockResolvedValue({ data: [], pagination })
    expect(links(await TeamsPage({}))).not.toContain("/dashboard/teams/new")
    expect(links(await PlayersPage({}))).not.toContain("/dashboard/players/new")
  })
  it("offers creation links only to the league owner", async () => {
    expect(links(await TeamsPage({}))).toContain("/dashboard/teams/new")
    expect(links(await PlayersPage({}))).toContain("/dashboard/players/new")
  })
  it("propagates list query failure instead of a successful empty screen", async () => {
    mocks.players.mockRejectedValue(new Error("Database unavailable"))
    mocks.teams.mockRejectedValue(new Error("Database unavailable"))
    await expect(PlayersPage({})).rejects.toThrow("Database unavailable")
    await expect(TeamsPage({})).rejects.toThrow("Database unavailable")
  })
  it("rejects invalid route pages before business lists", async () => {
    await expect(PlayersPage({ searchParams: Promise.resolve({ page: "1000001" }) })).rejects.toThrow()
    expect(mocks.players).not.toHaveBeenCalled()
  })
  it("retains a current team outside the bounded edit picker and explains truncation", async () => {
    mocks.options.mockResolvedValue({ teams: [{ id: OTHER, name: "Other" }], truncated: true })
    const tree = await EditPlayerPage(playerParams)
    const form = elements(tree).find(element => element.type === EditPlayerForm)!
    expect(mocks.editable).toHaveBeenCalledWith(context, PLAYER)
    expect(mocks.options).toHaveBeenCalledWith(TENANT)
    expect(form.props.teams).toEqual([{ id: OTHER, name: "Other" }, { id: TEAM, name: "Team" }])
    expect(text(tree)).toContain("first 100 active teams plus the current team")
    expect(text(tree)).toContain("remove them from their current roster first")
  })
  it("explains a truncated creation picker rather than silently dropping teams", async () => {
    mocks.options.mockResolvedValue({ teams: [], truncated: true })
    expect(text(await NewPlayerPage())).toContain("first 100 active teams")
  })
  it("does not convert picker failure into league-setup navigation", async () => {
    mocks.options.mockRejectedValue(new Error("Picker unavailable"))
    await expect(NewPlayerPage()).rejects.toThrow("Picker unavailable")
    await expect(EditPlayerPage(playerParams)).rejects.toThrow("Picker unavailable")
  })
  it("redirects archived or archived-team players away from edits without loading options", async () => {
    mocks.editable.mockResolvedValue({ ...privatePlayer, isActive: false })
    await expect(EditPlayerPage(playerParams)).rejects.toThrow(`redirect:/dashboard/players/${PLAYER}`)
    mocks.editable.mockResolvedValue(privatePlayer)
    mocks.team.mockResolvedValue({ ...team, isActive: false })
    await expect(EditPlayerPage(playerParams)).rejects.toThrow(`redirect:/dashboard/players/${PLAYER}`)
    expect(mocks.options).not.toHaveBeenCalled()
  })
})
describe("Detail controls and auxiliary privacy", () => {
  it.each(["team_manager", "coach", "scorer", "player", "fan"])("never fetches private player profile/ID-card data or shows edits for %s", async role => {
    mocks.context.mockResolvedValue({ ...context, role })
    const tree = await PlayerDetailPage(playerParams)
    expect(mocks.editable).not.toHaveBeenCalled()
    expect(mocks.select).not.toHaveBeenCalled()
    expect(links(tree)).not.toContain(`/dashboard/players/${PLAYER}/edit`)
    expect(elements(tree).some(element => element.type === DeleteButton || element.type === PlayerIdActions)).toBe(false)
    expect(text(tree)).not.toContain("Date of Birth")
    expect(text(tree)).not.toContain("Secret biography")
    expect(text(tree)).toContain("Statistics in this league only")
  })
  it("shows owner edit/archive controls and private profile without serializing it to other clients", async () => {
    const tree = await PlayerDetailPage(playerParams)
    expect(mocks.editable).toHaveBeenCalledWith(context, PLAYER)
    expect(links(tree)).toContain(`/dashboard/players/${PLAYER}/edit`)
    expect(text(tree)).toContain("Date of Birth")
    expect(elements(tree).find(element => element.type === DeleteButton)!.props.operation).toBe("archive")
  })
  it.each(["league_owner", "team_manager"])("shows team management for an assigned active %s", async role => {
    mocks.context.mockResolvedValue({ ...context, role })
    const tree = await TeamDetailPage(teamParams)
    expect(links(tree)).toContain(`/dashboard/teams/${TEAM}/edit`)
    expect(elements(tree).some(element => element.type === TeamRosterManager)).toBe(true)
    expect(elements(tree).some(element => element.type === DeleteButton)).toBe(role === "league_owner")
    expect(mocks.players).toHaveBeenCalledWith(TENANT, { pageSize: 100, unassigned: true, isActive: true, status: "active" })
    expect(text(tree)).toContain("up to 100")
  })
  it.each(["team_manager", "coach", "scorer", "fan"])("hides roster picker/edit/archive from an unassigned %s", async role => {
    mocks.context.mockResolvedValue({ ...context, role })
    mocks.team.mockResolvedValue({ ...team, managerId: OTHER })
    const tree = await TeamDetailPage(teamParams)
    expect(mocks.players).not.toHaveBeenCalled()
    expect(links(tree)).not.toContain(`/dashboard/teams/${TEAM}/edit`)
    expect(elements(tree).some(element => element.type === DeleteButton || element.type === TeamRosterManager)).toBe(false)
  })
  it("redirects unassigned managers away from the team edit form", async () => {
    mocks.context.mockResolvedValue({ ...context, role: "team_manager" })
    mocks.team.mockResolvedValue({ ...team, managerId: OTHER })
    await expect(EditTeamPage(teamParams)).rejects.toThrow(`redirect:/dashboard/teams/${TEAM}`)
  })
  it("keeps archived detail history readable without edit/archive/roster controls", async () => {
    mocks.team.mockResolvedValue({ ...team, isActive: false })
    const tree = await TeamDetailPage(teamParams)
    expect(text(tree)).toContain("Archived")
    expect(elements(tree).some(element => element.type === DeleteButton || element.type === TeamRosterManager)).toBe(false)
    expect(mocks.teamHistory).toHaveBeenCalledWith(TENANT, TEAM)
  })
  it("does not offer player editing when the linked team is archived or unavailable", async () => {
    mocks.player.mockResolvedValue({ ...player, teamIsActive: false })
    expect(links(await PlayerDetailPage(playerParams))).not.toContain(`/dashboard/players/${PLAYER}/edit`)
    mocks.player.mockResolvedValue({ ...player, teamId: null, teamIsActive: null })
    expect(links(await PlayerDetailPage(playerParams))).not.toContain(`/dashboard/players/${PLAYER}/edit`)
  })
  it("does not query auxiliary records for missing/foreign detail parents", async () => {
    mocks.team.mockResolvedValue(null)
    mocks.player.mockResolvedValue(null)
    await expect(TeamDetailPage(teamParams)).rejects.toThrow("not-found")
    await expect(PlayerDetailPage(playerParams)).rejects.toThrow("not-found")
    expect(mocks.squad).not.toHaveBeenCalled()
    expect(mocks.follow).not.toHaveBeenCalled()
    expect(mocks.teamHistory).not.toHaveBeenCalled()
    expect(mocks.playerHistory).not.toHaveBeenCalled()
    expect(mocks.editable).not.toHaveBeenCalled()
  })
  it("passes the authorized league, not a caller/default league, to every detail helper", async () => {
    await TeamDetailPage(teamParams)
    await PlayerDetailPage(playerParams)
    expect(mocks.team).toHaveBeenCalledWith(TENANT, TEAM)
    expect(mocks.player).toHaveBeenCalledWith(TENANT, PLAYER)
    expect(mocks.squad).toHaveBeenCalledWith(TENANT, TEAM)
    expect(mocks.teamHistory).toHaveBeenCalledWith(TENANT, TEAM)
    expect(mocks.playerHistory).toHaveBeenCalledWith(TENANT, PLAYER)
    expect(mocks.follow).toHaveBeenCalledWith(TENANT, ACTOR, "team", TEAM)
    expect(mocks.follow).toHaveBeenCalledWith(TENANT, ACTOR, "player", PLAYER)
    expect(mocks.permission).toHaveBeenCalledWith("scorecard:read", TENANT)
  })
})
