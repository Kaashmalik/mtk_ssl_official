"use client"

import * as React from "react"
import { Command } from "cmdk"
import { Search, Trophy, Users, CalendarDays, Settings, BarChart2 } from "lucide-react"
import { useRouter } from "next/navigation"

import { cn } from "../../lib/utils"

// Named sub-component exports (safe re-exports using wrapper components)
export const CommandInput = Command.Input
export const CommandList = Command.List
export const CommandEmpty = Command.Empty
export const CommandGroup = Command.Group
export const CommandItem = Command.Item

// CommandShortcut component for keyboard shortcuts
export function CommandShortcut({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span className={cn("ml-auto text-xs tracking-widest text-muted-foreground", className)}>
      {children}
    </span>
  )
}

// Safe CommandDialog wrapper — does NOT import CommandDialog from cmdk
// (cmdk v1+ removed the named CommandDialog export)
export function CommandDialog({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-background/80 backdrop-blur-sm"
      onClick={() => onOpenChange?.(false)}
    >
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  )
}

export interface CommandPaletteProps {
  // router prop kept for backwards compat but no longer required
  router?: { push: (path: string) => void }
}

export function CommandPalette(_props: CommandPaletteProps = {}) {
  const [open, setOpen] = React.useState(false)
  const [mounted, setMounted] = React.useState(false)
  
  // Safely get router with error handling
  let router: any = null
  try {
    router = useRouter()
  } catch (e) {
    // Router not available, will use window.location as fallback
    console.warn("Router not available in CommandPalette")
  }

  React.useEffect(() => {
    setMounted(true)
  }, [])

  // Toggle on Ctrl+K / ⌘K
  React.useEffect(() => {
    if (!mounted) return
    
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
      if (e.key === "Escape") {
        setOpen(false)
      }
    }
    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [mounted])

  const runCommand = React.useCallback((command: () => void) => {
    setOpen(false)
    command()
  }, [])

  const navigate = React.useCallback((path: string) => {
    if (router && router.push) {
      router.push(path)
    } else {
      window.location.href = path
    }
  }, [router])

  if (!open || !mounted) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-background/80 backdrop-blur-sm animate-in fade-in-0 duration-200"
      onClick={() => setOpen(false)}
    >
      <Command
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "relative z-50 flex h-full w-full max-w-[640px] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl",
          "animate-in zoom-in-95 duration-200",
          "sm:h-[420px]"
        )}
      >
        <div className="flex items-center border-b px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Command.Input
            placeholder="Search commands..."
            className="flex h-12 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            autoFocus
          />
          <kbd className="ml-2 hidden sm:flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 text-muted-foreground">
            ESC
          </kbd>
        </div>

        <Command.List className="max-h-[340px] overflow-y-auto overflow-x-hidden p-2">
          <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
            No results found.
          </Command.Empty>

          <Command.Group
            heading="Navigation"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
          >
            <Command.Item
              value="dashboard"
              onSelect={() => runCommand(() => navigate("/dashboard"))}
              className="relative flex cursor-default select-none items-center rounded-sm px-2 py-2 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
            >
              <Trophy className="mr-2 h-4 w-4" />
              Dashboard
              <CommandShortcut>⌘D</CommandShortcut>
            </Command.Item>

            <Command.Item
              value="teams"
              onSelect={() => runCommand(() => navigate("/dashboard/teams"))}
              className="relative flex cursor-default select-none items-center rounded-sm px-2 py-2 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
            >
              <Users className="mr-2 h-4 w-4" />
              Teams
            </Command.Item>

            <Command.Item
              value="matches"
              onSelect={() => runCommand(() => navigate("/dashboard/matches"))}
              className="relative flex cursor-default select-none items-center rounded-sm px-2 py-2 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
            >
              <CalendarDays className="mr-2 h-4 w-4" />
              Matches
            </Command.Item>

            <Command.Item
              value="analytics"
              onSelect={() => runCommand(() => navigate("/dashboard/analytics"))}
              className="relative flex cursor-default select-none items-center rounded-sm px-2 py-2 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
            >
              <BarChart2 className="mr-2 h-4 w-4" />
              Analytics
            </Command.Item>

            <Command.Item
              value="settings"
              onSelect={() => runCommand(() => navigate("/dashboard/settings"))}
              className="relative flex cursor-default select-none items-center rounded-sm px-2 py-2 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
            >
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Command.Item>
          </Command.Group>
        </Command.List>

        <div className="border-t px-3 py-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">↑↓</kbd> Navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">↵</kbd> Select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">ESC</kbd> Close
          </span>
        </div>
      </Command>
    </div>
  )
}
