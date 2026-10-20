/**
 * @mtk/contracts - the portable cross-surface contract vocabulary (ENH-03-01).
 *
 * Shared by the web app, the Expo/React Native app and service adapters.
 * Dependency policy baked into the package: the ONLY runtime dependency is
 * zod (used by the command schemas). No Next, no DOM, no node built-ins, no
 * database, no server-secret-reading code - enforced by a package test that
 * fails if that ever changes, so nothing here can become un-buildable for
 * native by accident.
 */

export const CONTRACTS_VERSION = "0.1.0" as const

export * from "./status"
export * from "./scoring"
export * from "./public-reads"
export * from "./mobile-bff"
export * from "./pagination"
export * from "./errors"
export * from "./capabilities"
