import { beforeEach, describe, expect, it } from "vitest";
import { useCommentaryStore, type CommentaryEntry } from "@/stores/commentary-store";

/**
 * `ballId` is an empty string for match-lifecycle commentary (intro / summary),
 * which is what made the original identity check unsafe: two different entries
 * sharing an empty ballId and a timestamp would suppress each other.
 */
function entry(overrides: Partial<CommentaryEntry> = {}): CommentaryEntry {
  return {
    matchId: "match-1",
    ballId: "ball-1",
    english: "Run!",
    urdu: "Run!",
    punjabi: "",
    pashto: "",
    sindhi: "",
    timestamp: "2026-10-07T00:00:00.000Z",
    generatedBy: "openai",
    ...overrides,
  };
}

describe("commentary store dedup", () => {
  beforeEach(() => {
    useCommentaryStore.getState().clear();
  });

  it("stores a normal ball entry", () => {
    useCommentaryStore.getState().addEntry(entry());
    expect(useCommentaryStore.getState().entries).toHaveLength(1);
  });

  it("drops an exact redelivery", () => {
    const e = entry();
    useCommentaryStore.getState().addEntry(e);
    useCommentaryStore.getState().addEntry(e);
    expect(useCommentaryStore.getState().entries).toHaveLength(1);
  });

  it("keeps distinct balls at the same timestamp", () => {
    const ts = "2026-10-07T00:00:00.000Z";
    useCommentaryStore.getState().addEntry(entry({ ballId: "ball-1", timestamp: ts }));
    useCommentaryStore.getState().addEntry(entry({ ballId: "ball-2", timestamp: ts }));
    expect(useCommentaryStore.getState().entries).toHaveLength(2);
  });

  it("keeps an intro and a summary that share a timestamp and an empty ballId", () => {
    const ts = "2026-10-07T00:00:00.000Z";
    useCommentaryStore.getState().addEntry(entry({ ballId: "", kind: "intro", timestamp: ts }));
    useCommentaryStore.getState().addEntry(entry({ ballId: "", kind: "summary", timestamp: ts }));

    // Regression: with ballId-only identity these collapsed into one entry.
    expect(useCommentaryStore.getState().entries).toHaveLength(2);
  });

  it("still drops a redelivered intro", () => {
    const intro = entry({ ballId: "", kind: "intro" });
    useCommentaryStore.getState().addEntry(intro);
    useCommentaryStore.getState().addEntry({ ...intro });
    expect(useCommentaryStore.getState().entries).toHaveLength(1);
  });

  it("treats a missing kind as 'ball' so pre-kind payloads dedupe correctly", () => {
    const legacy = entry({ ballId: "ball-9" });
    delete (legacy as { kind?: unknown }).kind;

    useCommentaryStore.getState().addEntry(legacy);
    useCommentaryStore.getState().addEntry({ ...legacy, kind: "ball" });

    expect(useCommentaryStore.getState().entries).toHaveLength(1);
  });

  it("caps history at 100 entries, newest first", () => {
    for (let i = 0; i < 105; i += 1) {
      useCommentaryStore.getState().addEntry(
        entry({ ballId: `ball-${i}`, timestamp: new Date(i * 1000).toISOString() }),
      );
    }
    const { entries } = useCommentaryStore.getState();
    expect(entries).toHaveLength(100);
    expect(entries[0].ballId).toBe("ball-104");
  });

  it("clears", () => {
    useCommentaryStore.getState().addEntry(entry());
    useCommentaryStore.getState().clear();
    expect(useCommentaryStore.getState().entries).toHaveLength(0);
  });
});