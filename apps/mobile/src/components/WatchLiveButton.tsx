import { View, Text, TouchableOpacity, StyleSheet, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import type { Match } from "@/types";

const WEB_APP_URL =
  Constants.expoConfig?.extra?.webAppUrl ||
  process.env.EXPO_PUBLIC_WEB_APP_URL ||
  "https://ssl.mtkcodex.site";

/**
 * Opens the web live page for a match.
 *
 * Mobile ships no native video module, so deep-linking to the responsive web
 * live page (embed + live overlay + commentary) is the supported path. A native
 * player can replace this later without changing the call sites.
 */
export function WatchLiveButton({ match }: { match: Match }) {
  const streamUrl = match.liveStreamUrl ?? match.live_stream_url ?? null;
  const streamStatus = match.streamStatus ?? match.stream_status ?? "idle";
  const isLive = streamStatus === "live" && !!streamUrl;

  if (!isLive) return null;

  const open = () => {
    Linking.openURL(`${WEB_APP_URL}/matches/${match.id}/live`).catch(() => {
      /* no handler installed */
    });
  };

  return (
    <TouchableOpacity style={styles.button} onPress={open} activeOpacity={0.85}>
      <View style={styles.liveDot} />
      <Ionicons name="play-circle" size={20} color="#fff" />
      <Text style={styles.label}>Watch Live</Text>
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