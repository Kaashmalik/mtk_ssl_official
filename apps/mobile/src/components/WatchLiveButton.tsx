import { View, Text, TouchableOpacity, StyleSheet, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import type { Match } from "@/types";

const WEB_APP_URL =
  Constants.expoConfig?.extra?.webAppUrl ||
  process.env.EXPO_PUBLIC_WEB_APP_URL ||
  "https://ssl.mtkcodex.site";

type PlaybackState = NonNullable<Match["playbackState"]>;

/**
 * Opens the web live/replay page for a match.
 *
 * Mobile ships no native video module, so deep-linking to the responsive web
 * live page (embed + live overlay + commentary) is the supported path. A native
 * player can replace this later without changing the call sites.
 *
 * ENH-08-03: the label follows a server-provided playback state when present.
 * Without it, only the legacy `live` status PLUS a stream URL is actionable -
 * an `ended` status is NOT treated as a replay because a raw stream URL is not
 * a durable archive.
 */
export function WatchLiveButton({ match }: { match: Match }) {
  const streamUrl = match.liveStreamUrl ?? match.live_stream_url ?? null;
  const streamStatus = match.streamStatus ?? match.stream_status ?? "idle";
  const playbackState = match.playbackState ?? match.playback_state;
  const hasReplay = match.hasReplay ?? match.has_replay ?? false;

  const state: PlaybackState =
    playbackState ??
    (streamStatus === "live" && streamUrl
      ? "live"
      : streamStatus === "ended" && hasReplay
        ? "replay"
        : "unavailable");

  if (state !== "live" && state !== "replay") return null;

  const isReplay = state === "replay";
  const open = () => {
    Linking.openURL(`${WEB_APP_URL}/matches/${match.id}/live`).catch(() => {
      /* no handler installed */
    });
  };

  return (
    <TouchableOpacity
      style={[styles.button, isReplay ? styles.replayButton : null]}
      onPress={open}
      activeOpacity={0.85}
      accessibilityRole="link"
      accessibilityLabel={isReplay ? "Watch match replay" : "Watch match live"}
    >
      {!isReplay && <View style={styles.liveDot} />}
      <Ionicons name="play-circle" size={20} color="#fff" />
      <Text style={styles.label}>{isReplay ? "Watch Replay" : "Watch Live"}</Text>
      <Ionicons name="open-outline" size={16} color="#fff" style={{ marginLeft: "auto" }} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#dc2626",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginTop: 12,
  },
  replayButton: {
    backgroundColor: "#334155",
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#fff",
  },
  label: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
});
