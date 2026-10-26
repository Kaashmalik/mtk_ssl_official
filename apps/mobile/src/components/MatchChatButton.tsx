import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { pollChat } from "@/lib/chat-client";
import { useThemeColors } from "@/theme/tokens";

/**
 * ENH-10: entry point from the match screen to its chat. Checks once whether
 * this viewer can see an enabled chat for the match and renders nothing
 * otherwise, so no one is offered a dead end (chat off, signed out, not a
 * league member, or the migration not applied yet).
 */
export function MatchChatButton({ matchId }: { matchId: string }) {
  const router = useRouter();
  const { t } = useTranslation();
  const colors = useThemeColors();
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    pollChat(matchId, 0, null).then((outcome) => {
      if (!cancelled) setAvailable(outcome.kind === "ok" && outcome.poll.enabled);
    });
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  if (!available) return null;

  return (
    <Pressable
      onPress={() => router.push(`/match-chat/${matchId}`)}
      accessibilityRole="button"
      accessibilityLabel={t("chat.open")}
      style={({ pressed }) => [
        styles.button,
        { borderColor: colors.tint, backgroundColor: pressed ? colors.surface : "transparent" },
      ]}
    >
      <Ionicons name="chatbubbles-outline" size={18} color={colors.tint} />
      <Text style={[styles.label, { color: colors.tint }]}>{t("chat.title")}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    marginTop: 12,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1.5,
    borderRadius: 999,
    paddingHorizontal: 18,
    minHeight: 44,
  },
  label: { fontSize: 15, fontWeight: "700" },
});
