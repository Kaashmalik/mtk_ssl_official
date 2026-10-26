import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  MATCH_CHAT_POLL_MS,
  mergeChatMessages,
  type MatchChatMessage,
  type MatchChatPoll,
} from "@mtk/contracts";
import { pollChat } from "@/lib/chat-client";

export type MatchChatStatus = "loading" | "ready" | "off" | "signin" | "forbidden" | "unavailable" | "error";

const MAX_BACKOFF_MS = 30_000;

/**
 * ENH-10: native chat state for one match. Mirrors the web panel:
 * - cursor polling (ADR 003) with the shared `mergeChatMessages` rule;
 * - polling pauses while the app is backgrounded and resumes immediately on
 *   return; errors back off up to 30s and never clear what is on screen;
 * - terminal states (signed out, not a member, missing room, chat off) stop
 *   polling instead of hammering the server.
 * `onNewWhileAway` fires with the count of unseen messages so the screen can
 * show a "new messages" pill and announce a short summary.
 */
export function useMatchChat(matchId: string | undefined, onNewWhileAway?: (count: number) => void) {
  const [status, setStatus] = useState<MatchChatStatus>("loading");
  const [messages, setMessages] = useState<MatchChatMessage[]>([]);
  const [meta, setMeta] = useState<Omit<MatchChatPoll, "messages" | "removedIds"> | null>(null);

  const messagesRef = useRef<MatchChatMessage[]>([]);
  const cursorRef = useRef(0);
  const sinceRef = useRef<string | null>(null);
  const backoffRef = useRef(MATCH_CHAT_POLL_MS);
  const loadedRef = useRef(false);
  const awayCallback = useRef(onNewWhileAway);
  awayCallback.current = onNewWhileAway;

  /** Apply a poll or a just-sent message; returns how many ids were new. */
  const apply = useCallback((incoming: MatchChatMessage[], removed: string[] = []) => {
    const { messages: next, added } = mergeChatMessages(messagesRef.current, incoming, removed);
    messagesRef.current = next;
    setMessages(next);
    return added;
  }, []);

  const tick = useCallback(async (): Promise<boolean> => {
    if (!matchId) return false;
    const outcome = await pollChat(matchId, cursorRef.current, sinceRef.current);
    if (outcome.kind === "ok") {
      const { messages: incoming, removedIds, ...rest } = outcome.poll;
      if (!rest.enabled) {
        setStatus("off");
        return false;
      }
      const added = apply(incoming, removedIds);
      // The first page is history, not news: only later polls notify.
      if (added > 0 && loadedRef.current) awayCallback.current?.(added);
      loadedRef.current = true;
      cursorRef.current = rest.cursor;
      sinceRef.current = rest.serverTime;
      setMeta(rest);
      setStatus("ready");
      backoffRef.current = MATCH_CHAT_POLL_MS;
      return true;
    }
    if (outcome.kind === "error") {
      setStatus((s) => (s === "ready" ? s : "error"));
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
      return true;
    }
    setStatus(outcome.kind);
    return false;
  }, [apply, matchId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = AppState.currentState === "active";

    const loop = async () => {
      if (cancelled || !active) return;
      const keepGoing = await tick();
      if (!cancelled && keepGoing && active) timer = setTimeout(loop, backoffRef.current);
    };
    const sub = AppState.addEventListener("change", (state) => {
      const wasActive = active;
      active = state === "active";
      if (active && !wasActive) {
        clearTimeout(timer);
        loop();
      } else if (!active) {
        clearTimeout(timer);
      }
    });
    loop();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      sub.remove();
    };
  }, [tick]);

  return { status, messages, meta, apply };
}
