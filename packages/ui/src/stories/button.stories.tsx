import type { Meta, StoryObj } from "@storybook/react"
import { ArrowRight, Trash2 } from "lucide-react"
import { Button } from "../components/ui/button"

const meta = {
  title: "Primitives/Button",
  component: Button,
  args: { children: "Start your league" },
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "destructive", "outline", "secondary", "ghost", "link", "subtle", "neo-glass", "gradient-shine", "magnetic"],
    },
    size: { control: "select", options: ["default", "sm", "lg", "xl", "icon"] },
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Primary: Story = {}

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>Default</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="subtle">Subtle</Button>
      <Button variant="link">Link</Button>
      <Button variant="destructive"><Trash2 /> Delete</Button>
    </div>
  ),
}

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm">Small</Button>
      <Button>Default</Button>
      <Button size="lg">Large</Button>
      <Button size="xl">Match day <ArrowRight /></Button>
    </div>
  ),
}

/** Pending writes keep the button's width and announce the busy state. */
export const Loading: Story = { args: { isLoading: true, children: "Saving ball" } }

export const Disabled: Story = { args: { disabled: true, children: "Create tournament" } }
