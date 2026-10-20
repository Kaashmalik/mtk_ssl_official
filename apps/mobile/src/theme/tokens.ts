import { useColorScheme } from "react-native";

/**
 * ENH-04-01: THE native theme tokens. Runtime-neutral values only - no
 * build-time imports from web/admin CSS, no platform conditionals outside
 * this file. Components consume `useThemeColors()` and never hardcode hex
 * values, so light/dark/system follows the OS and tenant accent changes
 * stay a one-file decision.
 *
 * Values mirror the web token palette that already survived review
 * (apps/web/src/app/globals.css): neutral grays + the league green, with
 * the dark variant chosen for good contrast against dark surfaces.
 */

export type ThemeColors = {
  background: string
  surface: string
  text: string
  textMuted: string
  border: string
  tint: string
  onTint: string
  danger: string
}

export const themeTokens: Record<"light" | "dark", ThemeColors> = {
  light: {
    background: "#ffffff",
    surface: "#f9fafb",
    text: "#111827",
    textMuted: "#6b7280",
    border: "#e5e7eb",
    tint: "#16a34a",
    onTint: "#ffffff",
    danger: "#ef4444",
  },
  dark: {
    background: "#111827",
    surface: "#1f2937",
    text: "#f9fafb",
    textMuted: "#9ca3af",
    border: "#374151",
    tint: "#22c55e",
    onTint: "#052e16",
    danger: "#f87171",
  },
};

/**
 * Follows the OS light/dark setting (system is the default; RN returns
 * null for unthemed platforms, which we treat as light).
 */
export function useThemeColors(): ThemeColors {
  const scheme = useColorScheme();
  return themeTokens[scheme === "dark" ? "dark" : "light"];
}
