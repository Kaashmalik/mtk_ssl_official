import * as React from "react"
import type { Preview } from "@storybook/react"
import "./preview.css"

/**
 * Light/dark switch in the toolbar. Toggles the same `.dark` class the apps
 * use, so every story is reviewed against both token sets.
 */
const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Color theme",
      toolbar: {
        title: "Theme",
        icon: "mirror",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: "light" },
  parameters: {
    layout: "padded",
    controls: { expanded: true },
    a11y: { test: "error" },
  },
  decorators: [
    (Story, context) => {
      const dark = context.globals.theme === "dark"
      React.useEffect(() => {
        document.documentElement.classList.toggle("dark", dark)
      }, [dark])
      return (
        <div className="bg-background p-6 text-foreground">
          <Story />
        </div>
      )
    },
  ],
}

export default preview
