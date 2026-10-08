"use client"

import { useState } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@mtk/ui/components/ui/table"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Button } from "@mtk/ui/components/ui/button"
import { Input } from "@mtk/ui/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import { Search, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { updateUserRole, toggleUserStatus } from "@/app/actions/users"
import { UserRole } from "@/lib/rbac"

interface User {
  id: string
  email: string
  displayName: string | null
  avatarUrl: string | null
  role: string
  isActive: boolean
  createdAt: Date
}

interface UserListTableProps {
  initialUsers: User[]
  currentUserId?: string | null
}

const ROLE_OPTIONS = [
  { value: "league_owner", label: "League Owner" },
  { value: "team_manager", label: "Team Manager" },
  { value: "coach", label: "Coach" },
  { value: "scorer", label: "Scorer" },
  { value: "player", label: "Player" },
  { value: "fan", label: "Fan" },
]

export function UserListTable({ initialUsers, currentUserId }: UserListTableProps) {
  const [usersList, setUsersList] = useState<User[]>(initialUsers)
  const [search, setSearch] = useState("")
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const handleRoleChange = async (userId: string, newRole: string) => {
    setUpdatingId(userId)
    try {
      const res = await updateUserRole(userId, newRole as UserRole)
      if (res.success) {
        setUsersList(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u))
        toast.success("User role updated successfully")
      } else {
        toast.error("Failed to update user role")
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to update user role")
    } finally {
      setUpdatingId(null)
    }
  }

  const handleStatusToggle = async (userId: string, currentStatus: boolean) => {
    setUpdatingId(userId)
    const newStatus = !currentStatus
    try {
      const res = await toggleUserStatus(userId, newStatus)
      if (res.success) {
        setUsersList(prev => prev.map(u => u.id === userId ? { ...u, isActive: newStatus } : u))
        toast.success(`User ${newStatus ? "enabled" : "disabled"} successfully`)
      } else {
        toast.error("Failed to toggle user status")
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to toggle user status")
    } finally {
      setUpdatingId(null)
    }
  }

  const filteredUsers = usersList.filter(u => {
    const term = search.toLowerCase()
    return (
      u.email.toLowerCase().includes(term) ||
      (u.displayName && u.displayName.toLowerCase().includes(term))
    )
  })

  return (
    <div className="space-y-4">
      {/* Search and Filters */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Users Table */}
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredUsers.map((user) => {
              const isSelf = user.id === currentUserId
              const isSuperAdmin = user.role === "super_admin"
              const isPendingUpdate = updatingId === user.id

              return (
                <TableRow key={user.id} className="hover:bg-muted/10">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">
                        {user.displayName ? user.displayName.charAt(0) : user.email.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <span className="font-semibold text-sm block">
                          {user.displayName || "No Display Name"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Joined {new Date(user.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm font-medium">{user.email}</TableCell>
                  <TableCell>
                    {isSuperAdmin ? (
                      <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20">
                        Super Admin
                      </Badge>
                    ) : (
                      <div className="max-w-[160px]">
                        <Select
                          disabled={isSelf || isPendingUpdate}
                          defaultValue={user.role}
                          onValueChange={(val) => handleRoleChange(user.id, val)}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select role" />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLE_OPTIONS.map(opt => (
                              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs ${user.isActive ? "bg-success/5 text-success border-success/20" : "bg-muted text-muted-foreground border-border"}`}>
                      {user.isActive ? "Active" : "Disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {isPendingUpdate ? (
                      <Loader2 className="h-4 w-4 animate-spin inline-block text-muted-foreground" />
                    ) : (
                      !isSuperAdmin && !isSelf && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className={user.isActive ? "text-destructive hover:text-destructive hover:bg-destructive/10" : "text-success hover:text-success hover:bg-success/10"}
                          onClick={() => handleStatusToggle(user.id, user.isActive)}
                        >
                          {user.isActive ? "Disable" : "Enable"}
                        </Button>
                      )
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
            {filteredUsers.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground text-sm">
                  No users found matching your search.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
