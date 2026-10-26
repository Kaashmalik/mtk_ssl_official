import type { Meta, StoryObj } from "@storybook/react"
import { AlertTriangle, CalendarRange, RefreshCw } from "lucide-react"
import { Button } from "../components/ui/button"
import { EmptyState } from "../components/ui/empty-state"
import { Skeleton } from "../components/ui/skeleton"

/**
 * The three non-happy states every data surface must handle (UI plan, phase
 * 3): loading, empty and error. No screen should ever be blank.
 */
const meta = {
  title: "Patterns/Loading, empty and error states",
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Loading: Story = {
  render: () => (
    <div className="max-w-xl space-y-3" aria-busy="true" aria-label="Loading matches">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-4 rounded-xl border border-border p-4">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  ),
}

export const Empty: Story = {
  render: () => (
    <EmptyState
      title="No matches scheduled"
      description="Generate fixtures for a tournament, or schedule a single match."
      icon={<CalendarRange className="h-8 w-8" />}
      action={{ label: "Schedule match", onClick: () => {} }}
    />
  ),
}

export const Error: Story = {
  render: () => (
    <div role="alert" className="max-w-xl rounded-2xl border border-warning/30 bg-warning/10 p-6">
      <div className="flex gap-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
        <div className="space-y-3">
          <div>
            <h3 className="font-semibold">Matches could not load</h3>
            <p className="mt-1 text-sm text-muted-foreground">Nothing was changed. Check your connection and try again.</p>
          </div>
          <Button size="sm"><RefreshCw /> Try again</Button>
        </div>
      </div>
    </div>
  ),
}
