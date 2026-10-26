import type { Meta, StoryObj } from "@storybook/react"
import { Input } from "../components/ui/input"
import { Label } from "../components/ui/label"
import { Textarea } from "../components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs"

const meta = {
  title: "Primitives/Forms and tabs",
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const FormFields: Story = {
  render: () => (
    <form className="max-w-md space-y-4" onSubmit={(e) => e.preventDefault()}>
      <div className="space-y-2">
        <Label htmlFor="story-name">Tournament name</Label>
        <Input id="story-name" placeholder="e.g. Summer Cup 2026" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="story-invalid">Max teams</Label>
        <Input id="story-invalid" defaultValue="1" aria-invalid="true" aria-describedby="story-invalid-msg" />
        <p id="story-invalid-msg" className="text-sm text-destructive">A tournament needs at least two teams.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="story-desc">Description</Label>
        <Textarea id="story-desc" placeholder="Rules, prizes, contacts…" />
      </div>
    </form>
  ),
}

export const ScoringTabs: Story = {
  render: () => (
    <Tabs defaultValue="scorecard" className="max-w-md">
      <TabsList>
        <TabsTrigger value="scorecard">Scorecard</TabsTrigger>
        <TabsTrigger value="commentary">Commentary</TabsTrigger>
        <TabsTrigger value="charts">Charts</TabsTrigger>
      </TabsList>
      <TabsContent value="scorecard" className="text-sm text-muted-foreground">Batting and bowling figures.</TabsContent>
      <TabsContent value="commentary" className="text-sm text-muted-foreground">Ball-by-ball commentary.</TabsContent>
      <TabsContent value="charts" className="text-sm text-muted-foreground">Manhattan, worm and wagon wheel.</TabsContent>
    </Tabs>
  ),
}
