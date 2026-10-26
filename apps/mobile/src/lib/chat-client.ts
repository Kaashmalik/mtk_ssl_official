import type { MatchChatPoll, MatchChatReportReason, MatchChatSendResult } from "@mtk/contracts";
import { authedFetch, currentSessionToken } from "./app-api";

/**
 * ENH-10: native match chat transport. Same web routes and server writer as
 * the web panel (ADR 003): GET polls with a cursor, POST sends with an
 * idempotent client key, POST /report files a report. The device never talks
 * to the database and never decides who may post.
 */

export type ChatPollOutcome =
  | { kind: "ok"; poll: MatchChatPoll }
  | { kind: "signin" | "forbidden" | "unavailable" }
  | { kind: "error" };

export async function pollChat(matchId: string, after: number, since: string | null): Promise<ChatPollOutcome> {
  if (!(await currentSessionToken())) return { kind: "signin" };
  const qs = new URLSearchParams({ after: String(after) });
  if (since) qs.set("since", since);
  try {
    const res = await authedFetch(`/api/matches/${encodeURIComponent(matchId)}/chat?${qs}`);
    if (res.status === 401) return { kind: "signin" };
    if (res.status === 403) return { kind: "forbidden" };
    if (res.status === 404) return { kind: "unavailable" };
    if (!res.ok) return { kind: "error" };
    return { kind: "ok", poll: (await res.json()) as MatchChatPoll };
  } catch {
    return { kind: "error" };
  }
}

export async function sendChat(
  matchId: string,
  input: { body: string; clientKey: string; replyToId: string | null },
): Promise<MatchChatSendResult> {
  try {
    const res = await authedFetch(`/api/matches/${encodeURIComponent(matchId)}/chat`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    const data = (await res.json().catch(() => null)) as MatchChatSendResult | { error?: string } | null;
    if (data && "ok" in data) return data;
    return { ok: false, reason: "invalid", error: (data as { error?: string } | null)?.error ?? "That message could not be sent." };
  } catch {
    // Network failure: the caller keeps the same client key, so a retry can
    // never create a duplicate even if this request actually landed.
    return { ok: false, reason: "invalid", error: "No connection. Your message was not sent." };
  }
}

export async function reportChat(
  matchId: string,
  messageId: string,
  reason: MatchChatReportReason,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await authedFetch(`/api/matches/${encodeURIComponent(matchId)}/chat/report`, {
      method: "POST",
      body: JSON.stringify({ messageId, reason }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    return { ok: res.ok && data.ok === true, error: data.error };
  } catch {
    return { ok: false, error: "No connection. The report was not sent." };
  }
}

/** RFC 4122 v4 key for idempotent sends; prefers the platform generator. */
export function newChatClientKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export type ChatModeration =
  | { action: "hide"; messageId: string }
  | { action: "mute"; userId: string; minutes: number };

/** Moderator action; the server re-checks moderator authority on every call. */
export async function moderateChat(matchId: string, input: ChatModeration): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await authedFetch(`/api/matches/${encodeURIComponent(matchId)}/chat/moderate`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    return { ok: res.ok && data.ok === true, error: data.error };
  } catch {
    return { ok: false, error: "No connection. Nothing was changed." };
  }
}
