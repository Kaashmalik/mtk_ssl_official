"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Button } from "@mtk/ui/components/ui/button"
import { Input } from "@mtk/ui/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import { Search, ArrowUpDown } from "lucide-react"

interface Player {
  id: string
  name: string
  role: string | null
  jerseyNumber: number | null
  battingStyle: string | null
  teamName: string | null
  city: string | null
  status: string
  photoUrl: string | null
}

interface PlayerListTableProps {
  initialPlayers: Player[]
}

const ROLE_LABELS: Record<string, string> = {
  batsman: "Batsman",
  bowler: "Bowler",
  all_rounder: "All-Rounder",
  wicket_keeper: "Wicket Keeper",
  wicket_keeper_batsman: "WK-Batsman",
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-success/10 text-success border-success/20",
  injured: "bg-warning/10 text-warning border-warning/20",
  retired: "bg-muted text-muted-foreground border-border",
  suspended: "bg-destructive/10 text-destructive border-destructive/20",
  inactive: "bg-muted text-muted-foreground border-border",
}

const ROLE_COLORS: Record<string, string> = {
  batsman: "bg-info/10 text-info border-info/20",
  bowler: "bg-destructive/10 text-destructive border-destructive/20",
  all_rounder: "bg-primary/10 text-primary border-primary/20",
  wicket_keeper: "bg-warning/10 text-warning border-warning/20",
  wicket_keeper_batsman: "bg-warning/10 text-warning border-warning/20",
}

export function PlayerListTable({ initialPlayers }: PlayerListTableProps) {
  const [search, setSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState<string>("all")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [sortField, setSortField] = useState<"name" | "jerseyNumber" | "teamName" | "role">("name")
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc")

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc")
    } else {
      setSortField(field)
      setSortOrder("asc")
    }
  }

  const filteredAndSortedPlayers = useMemo(() => {
    let result = [...initialPlayers]

    // Searching
    if (search.trim() !== "") {
      const term = search.toLowerCase()
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(term) ||
          (p.city && p.city.toLowerCase().includes(term)) ||
          (p.teamName && p.teamName.toLowerCase().includes(term))
      )
    }

    // Role filtering
    if (roleFilter !== "all") {
      result = result.filter((p) => p.role === roleFilter)
    }

    // Status filtering
    if (statusFilter !== "all") {
      result = result.filter((p) => p.status === statusFilter)
    }

    // Sorting
    result.sort((a, b) => {
      let aVal: any = ""
      let bVal: any = ""

      if (sortField === "name") {
        aVal = a.name.toLowerCase()
        bVal = b.name.toLowerCase()
      } else if (sortField === "jerseyNumber") {
        aVal = a.jerseyNumber ?? 9999
        bVal = b.jerseyNumber ?? 9999
      } else if (sortField === "teamName") {
        aVal = (a.teamName || "zzz").toLowerCase()
        bVal = (b.teamName || "zzz").toLowerCase()
      } else if (sortField === "role") {
        aVal = (a.role || "zzz").toLowerCase()
        bVal = (b.role || "zzz").toLowerCase()
      }

      if (aVal < bVal) return sortOrder === "asc" ? -1 : 1
      if (aVal > bVal) return sortOrder === "asc" ? 1 : -1
      return 0
    })

    return result
  }, [initialPlayers, search, roleFilter, statusFilter, sortField, sortOrder])

  return (
    <div className="space-y-4">
      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, team, city..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="w-full sm:w-[180px]">
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All Roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="batsman">Batsman</SelectItem>
              <SelectItem value="bowler">Bowler</SelectItem>
              <SelectItem value="all_rounder">All-Rounder</SelectItem>
              <SelectItem value="wicket_keeper">Wicket Keeper</SelectItem>
              <SelectItem value="wicket_keeper_batsman">WK-Batsman</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-full sm:w-[180px]">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="injured">Injured</SelectItem>
              <SelectItem value="retired">Retired</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Results Table */}
      <div className="rounded-xl border bg-card overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="px-4 py-3 text-left">
                  <button onClick={() => handleSort("jerseyNumber")} className="flex items-center gap-1.5 font-semibold text-xs text-muted-foreground uppercase tracking-wider">
                    # <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-4 py-3 text-left">
                  <button onClick={() => handleSort("name")} className="flex items-center gap-1.5 font-semibold text-xs text-muted-foreground uppercase tracking-wider">
                    Player <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-4 py-3 text-left">
                  <button onClick={() => handleSort("role")} className="flex items-center gap-1.5 font-semibold text-xs text-muted-foreground uppercase tracking-wider">
                    Role <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-4 py-3 text-left">
                  <button onClick={() => handleSort("teamName")} className="flex items-center gap-1.5 font-semibold text-xs text-muted-foreground uppercase tracking-wider">
                    Team <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-4 py-3 text-left font-semibold text-xs text-muted-foreground uppercase tracking-wider">City</th>
                <th className="px-4 py-3 text-left font-semibold text-xs text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-right font-semibold text-xs text-muted-foreground uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredAndSortedPlayers.map((player) => (
                <tr key={player.id} className="hover:bg-muted/20 transition-colors group">
                  <td className="px-4 py-3 font-mono text-muted-foreground">
                    {player.jerseyNumber != null ? `#${player.jerseyNumber}` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/players/${player.id}`} className="flex items-center gap-3 group-hover:text-primary transition-colors">
                      {player.photoUrl ? (
                        <img src={player.photoUrl} alt={player.name} className="h-9 w-9 rounded-full object-cover border" />
                      ) : (
                        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
                          {player.name.charAt(0)}
                        </div>
                      )}
                      <div>
                        <p className="font-semibold text-sm">{player.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {player.battingStyle === "left" ? "Left-hand" : player.battingStyle === "right" ? "Right-hand" : "—"} bat
                        </p>
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {player.role ? (
                      <Badge variant="outline" className={`text-xs ${ROLE_COLORS[player.role] ?? ""}`}>
                        {ROLE_LABELS[player.role] ?? player.role}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {player.teamName ?? <span className="text-muted-foreground font-normal">Unassigned</span>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{player.city ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className={`text-xs capitalize ${STATUS_COLORS[player.status] ?? ""}`}>
                      {player.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/dashboard/players/${player.id}`}>
                      <Button variant="ghost" size="sm" className="text-xs">View</Button>
                    </Link>
                  </td>
                </tr>
              ))}
              {filteredAndSortedPlayers.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">
                    No players found matching current search/filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
