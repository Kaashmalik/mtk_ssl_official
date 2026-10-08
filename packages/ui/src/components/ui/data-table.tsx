"use client"

import * as React from "react"
import { Input } from "./input"
import { Button } from "./button"
import { Skeleton } from "./skeleton"
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Search, X } from "lucide-react"

// ─── Types ────────────────────────────────────────────────────

export interface Column<T> {
  key: string
  header: string
  cell: (row: T) => React.ReactNode
  sortable?: boolean
  className?: string
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  pagination?: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  onPageChange?: (page: number) => void
  onSearch?: (query: string) => void
  searchPlaceholder?: string
  isLoading?: boolean
  emptyMessage?: string
  emptyIcon?: React.ReactNode
  actions?: React.ReactNode
  filters?: React.ReactNode
}

// ─── Component ────────────────────────────────────────────────

export function DataTable<T extends { id?: string }>({
  columns,
  data,
  pagination,
  onPageChange,
  onSearch,
  searchPlaceholder = "Search...",
  isLoading,
  emptyMessage = "No data found",
  emptyIcon,
  actions,
  filters,
}: DataTableProps<T>) {
  const [searchQuery, setSearchQuery] = React.useState("")

  const handleSearch = React.useCallback((value: string) => {
    setSearchQuery(value)
    onSearch?.(value)
  }, [onSearch])

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="rounded-xl border bg-card overflow-hidden">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4 border-b last:border-0">
              <Skeleton className="h-10 w-10 rounded-full" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24 ml-auto" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        {onSearch && (
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-9 pr-9"
            />
            {searchQuery && (
              <button onClick={() => handleSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
              </button>
            )}
          </div>
        )}
        {filters}
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                {columns.map((col) => (
                  <th key={col.key} className={`px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider ${col.className ?? ""}`}>
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      {emptyIcon && <div className="text-muted-foreground/40">{emptyIcon}</div>}
                      <p className="text-sm text-muted-foreground">{emptyMessage}</p>
                    </div>
                  </td>
                </tr>
              ) : (
                data.map((row, idx) => (
                  <tr key={(row as Record<string, unknown>).id as string ?? idx} className="hover:bg-muted/20 transition-colors">
                    {columns.map((col) => (
                      <td key={col.key} className={`px-4 py-3 text-sm ${col.className ?? ""}`}>
                        {col.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between px-2">
          <p className="text-sm text-muted-foreground">
            Showing {((pagination.page - 1) * pagination.pageSize) + 1}–{Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total}
          </p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => onPageChange?.(1)} disabled={pagination.page <= 1} className="h-8 w-8 p-0">
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => onPageChange?.(pagination.page - 1)} disabled={pagination.page <= 1} className="h-8 w-8 p-0">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm px-3 tabular-nums">{pagination.page} / {pagination.totalPages}</span>
            <Button variant="outline" size="sm" onClick={() => onPageChange?.(pagination.page + 1)} disabled={pagination.page >= pagination.totalPages} className="h-8 w-8 p-0">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => onPageChange?.(pagination.totalPages)} disabled={pagination.page >= pagination.totalPages} className="h-8 w-8 p-0">
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
