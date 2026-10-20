import { View, ActivityIndicator, StyleSheet, Text } from "react-native";
import { useThemeColors } from "@/theme/tokens";

interface LoadingSpinnerProps {
  message?: string;
}

export function LoadingSpinner({ message }: LoadingSpinnerProps) {
  const colors = useThemeColors();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ENH-04-03: assistive tech hears this state instead of a frozen
          screen; the message is the announcement. */}
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={message ?? "Loading"}
      >
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
      {message && <Text style={[styles.message, { color: colors.textMuted }]}>{message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  message: {
    marginTop: 16,
    fontSize: 16,
  },
});
