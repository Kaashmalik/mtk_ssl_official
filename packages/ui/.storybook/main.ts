import type { StorybookConfig } from "@storybook/react-vite"

/**
 * Storybook for the shared UI kit. Uses Vite (not Next) so it builds without
 * any app environment; components that import `next/*` (command palette, page
 * transition) are documented in the apps instead.
 */
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-essentials", "@storybook/addon-a11y"],
  framework: { name: "@storybook/react-vite", options: {} },
  core: { disableTelemetry: true },
  async viteFinal(viteConfig) {
    // @tailwindcss/vite is ESM-only while Storybook evaluates this file as
    // CommonJS, so it is loaded lazily here rather than imported at the top.
    const { default: tailwindcss } = await (new Function("m", "return import(m)")("@tailwindcss/vite") as Promise<
      typeof import("@tailwindcss/vite")
    >)
    viteConfig.plugins = [...(viteConfig.plugins ?? []), tailwindcss()]
    return viteConfig
  },
}

export default config
