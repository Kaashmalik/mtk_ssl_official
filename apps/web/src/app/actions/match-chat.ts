"use server"

import {
  dismissChatReports,
  moderateChatMessage,
  muteChatUser,
  reportChatMessage,
  sendMatchChatMessage,
  updateLeagueChatSettings,
} from "@/lib/match-chat"

/**
 * Thin delegates over the locked ENH-10 chat writer. Identity, league scope,
 * moderator authority, content rules, slow mode and idempotency all live in
 * the writer - this tier only forwards. Unexpected failures surface as a
 * generic error, never as internal detail.
 */

function failure(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : ""
  if (message.startsWith("Unauthorized")) return { ok: false as const, error: "Sign in to join the chat." }
  if (message.startsWith("Forbidden")) return { ok: false as const, error: "You don't have access to do that." }
  return { ok: false as const, error: fallback }
}

export async function sendChatMessageAction(input: unknown) {
  try {
    return await sendMatchChatMessage(input)
  } catch (error) {
    return { ...failure(error, "That message could not be sent."), reason: "invalid" as const }
  }
}

export async function moderateChatMessageAction(input: unknown) {
  try {
    return await moderateChatMessage(input)
  } catch (error) {
    return failure(error, "That action could not be completed.")
  }
}

export async function muteChatUserAction(input: unknown) {
  try {
    return await muteChatUser(input)
  } catch (error) {
    return failure(error, "That action could not be completed.")
  }
}

export async function reportChatMessageAction(input: unknown) {
  try {
    return await reportChatMessage(input)
  } catch (error) {
    return failure(error, "That report could not be sent.")
  }
}

export async function dismissChatReportsAction(input: unknown) {
  try {
    return await dismissChatReports(input)
  } catch (error) {
    return failure(error, "That action could not be completed.")
  }
}

export async function updateLeagueChatSettingsAction(input: unknown) {
  try {
    return { ok: true as const, settings: await updateLeagueChatSettings(input) }
  } catch (error) {
    return failure(error, "Chat settings could not be saved.")
  }
}
