import { create } from "zustand";

export type CommentaryLanguage = "english" | "urdu" | "punjabi" | "pashto" | "sindhi";

/**
 * What produced an entry.
 *
 * `ball` is the default. `intro` / `summary` are match-lifecycle commentary
 * published by ai-commentary-service when it consumes `ssl.match.events`; those
 * have no associated delivery, so their `ballId` is an empty string.
 */
export type CommentaryKind = "ball" | "intro" | "summary";

export interface CommentaryEntry {
  matchId: string;
  /** Empty string for `intro` / `summary`; required so existing consumers compile. */
  ballId: string;
  english: string;
  urdu: string;
  punjabi: string;
  pashto: string;
  sindhi: string;
  timestamp: string;
  generatedBy: "openai" | "cached" | "fallback";
  kind?: CommentaryKind;
}

interface CommentaryState {
  entries: CommentaryEntry[];
  language: CommentaryLanguage;
  setLanguage: (lang: CommentaryLanguage) => void;
  addEntry: (entry: CommentaryEntry) => void;
  clear: () => void;
}

const MAX_ENTRIES = 100;

/** Defaults to "ball" so payloads published before `kind` existed still work. */
const kindOf = (entry: CommentaryEntry): CommentaryKind => entry.kind ?? "ball";

export const useCommentaryStore = create<CommentaryState>()((set) => ({
  entries: [],
  language: "english",
  setLanguage: (language) => set({ language }),
  addEntry: (entry) =>
    set((s) => {
      // `kind` is part of the identity: an intro and a summary share an empty
      // `ballId`, so keying on ballId alone would let one suppress the other
      // whenever their timestamps collided.
      const key = `${kindOf(entry)}:${entry.ballId}:${entry.timestamp}`;
      if (s.entries.some((e) => `${kindOf(e)}:${e.ballId}:${e.timestamp}` === key)) return s;
      return { entries: [entry, ...s.entries].slice(0, MAX_ENTRIES) };
    }),
  clear: () => set({ entries: [] }),
}));
