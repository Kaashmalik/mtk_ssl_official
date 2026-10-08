"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { Card, CardContent } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Input } from "@mtk/ui/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import { Search, MapPin, Users, ArrowRight } from "lucide-react"

interface Team {
  id: string
  name: string
  shortName: string | null
  primaryColor: string | null
  logoUrl: string | null
  city: string | null
  isActive: boolean
  playerCount: number
  wins: number
  losses: number
  played: number
}

interface TeamListGridProps {
  initialTeams: Team[]
}

export function TeamListGrid({ initialTeams }: TeamListGridProps) {
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [cityFilter, setCityFilter] = useState<string>("all")

  const cities = useMemo(() => {
    const list = new Set(initialTeams.map((t) => t.city).filter(Boolean))
    return Array.from(list) as string[]
  }, [initialTeams])

  const filteredTeams = useMemo(() => {
    let result = [...initialTeams]

    // Searching
    if (search.trim() !== "") {
      const term = search.toLowerCase()
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(term) ||
          (t.shortName && t.shortName.toLowerCase().includes(term)) ||
          (t.city && t.city.toLowerCase().includes(term))
      )
    }

    // Status filter
    if (statusFilter !== "all") {
      const active = statusFilter === "active"
      result = result.filter((t) => t.isActive === active)
    }

    // City filter
    if (cityFilter !== "all") {
      result = result.filter((t) => t.city === cityFilter)
    }

    return result
  }, [initialTeams, search, statusFilter, cityFilter])

  return (
    <div className="space-y-4">
      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by team name or short name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="w-full sm:w-[180px]">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {cities.length > 0 && (
          <div className="w-full sm:w-[180px]">
            <Select value={cityFilter} onValueChange={setCityFilter}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All Cities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Cities</SelectItem>
                {cities.map((city) => (
                  <SelectItem key={city} value={city}>
                    {city}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredTeams.map((team) => (
          <Link key={team.id} href={`/dashboard/teams/${team.id}`}>
            <Card className="hover:shadow-lg hover:-translate-y-1 transition-all cursor-pointer group overflow-hidden h-full flex flex-col justify-between">
              <div>
                {/* Team Color Bar */}
                <div className="h-1.5 w-full" style={{ backgroundColor: team.primaryColor ?? "var(--color-primary)" }} />
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Team Avatar */}
                      {team.logoUrl ? (
                        <img
                          src={team.logoUrl}
                          alt={team.name}
                          className="h-10 w-10 rounded-xl object-cover border"
                        />
                      ) : (
                        <div
                          className="h-10 w-10 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0"
                          style={{ backgroundColor: team.primaryColor ?? "var(--color-primary)" }}
                        >
                          {team.shortName?.slice(0, 2).toUpperCase() ?? team.name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <h3 className="font-bold text-sm truncate group-hover:text-primary transition-colors">{team.name}</h3>
                        {team.shortName && <p className="text-xs text-muted-foreground">{team.shortName}</p>}
                      </div>
                    </div>
                    {!team.isActive && (
                      <Badge variant="outline" className="text-xs bg-muted text-muted-foreground">Inactive</Badge>
                    )}
                  </div>

                  {team.city && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-3">
                      <MapPin className="h-3 w-3" />
                      <span>{team.city}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-center py-2 rounded-lg bg-muted/30">
                      <p className="text-sm font-bold tabular-nums">{team.playerCount}</p>
                      <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5"><Users className="h-2.5 w-2.5" />Players</p>
                    </div>
                    <div className="text-center py-2 rounded-lg bg-success/10">
                      <p className="text-sm font-bold tabular-nums text-success">{team.wins}</p>
                      <p className="text-[10px] text-muted-foreground">Won</p>
                    </div>
                    <div className="text-center py-2 rounded-lg bg-destructive/10">
                      <p className="text-sm font-bold tabular-nums text-destructive">{team.losses}</p>
                      <p className="text-[10px] text-muted-foreground">Lost</p>
                    </div>
                  </div>
                </CardContent>
              </div>
              <CardContent className="pt-0 pb-4 flex justify-end">
                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </CardContent>
            </Card>
          </Link>
        ))}
        {filteredTeams.length === 0 && (
          <div className="col-span-full py-8 text-center text-muted-foreground">
            No teams found matching current search/filter.
          </div>
        )}
      </div>
    </div>
  )
}
