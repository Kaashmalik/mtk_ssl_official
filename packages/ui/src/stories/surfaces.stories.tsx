import type { Meta, StoryObj } from "@storybook/react"
import { Trophy, Users } from "lucide-react"
import { Badge } from "../components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card"
import { StatCard } from "../components/ui/stat-card"

const meta = {
  title: "Surfaces/Cards and badges",
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Badges: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge>Live</Badge>
      <Badge variant="secondary">Scheduled</Badge>
      <Badge variant="outline">Draft</Badge>
      <Badge variant="soft">Registration open</Badge>
      <Badge variant="destructive">Cancelled</Badge>
    </div>
  ),
}

export const CardVariants: Story = {
  render: () => (
    <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
      {(["default", "glass", "neo", "ghost"] as const).map((variant) => (
        <Card key={variant} variant={variant}>
          <CardHeader>
            <CardTitle>Falcons vs Strikers</CardTitle>
            <CardDescription>Variant: {variant}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Sample data for layout review.</CardContent>
        </Card>
      ))}
    </div>
  ),
}

export const StatCards: Story = {
  render: () => (
    <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
      <StatCard title="Published competitions" value={12} previousValue={9} icon={<Trophy className="h-5 w-5" />} trendLabel="vs last season" />
      <StatCard title="Active teams" value={48} previousValue={52} icon={<Users className="h-5 w-5" />} trendLabel="vs last season" />
    </div>
  ),
}
