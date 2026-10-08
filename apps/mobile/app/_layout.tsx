import { Stack } from "expo-router";
import { useEffect, Component, type ReactNode } from "react";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { View, Text } from "react-native";
import "react-native-url-polyfill/auto";
import "../src/lib/i18n";
import { useOfflineSync } from "@/hooks/use-offline-sync";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { OfflineBanner } from "@/components/OfflineBanner";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: "" };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24, backgroundColor: "#f3f4f6" }}>
          <Text style={{ fontSize: 18, fontWeight: "bold", color: "#dc2626", marginBottom: 8 }}>Something went wrong</Text>
          <Text style={{ fontSize: 13, color: "#6b7280", textAlign: "center" }}>{this.state.error}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function RootLayout() {
  useOfflineSync();
  usePushNotifications();
  const router = useRouter();

  useEffect(() => {
    // Handle deep linking
    const handleDeepLink = (event: { url: string }) => {
      const { path } = Linking.parse(event.url);
      
      // Handle ssl.cricket/match/abc format
      if (path?.includes("/match/")) {
        const matchId = path.split("/match/")[1];
        if (matchId) {
          router.push(`/match/${matchId}`);
        }
      }
    };

    // Check if app was opened via deep link
    Linking.getInitialURL().then((url) => {
      if (url) {
        handleDeepLink({ url });
      }
    });

    // Listen for deep links while app is running
    const subscription = Linking.addEventListener("url", handleDeepLink);

    return () => {
      subscription.remove();
    };
  }, [router]);

  return (
    <ErrorBoundary>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <OfflineBanner />
        <Stack
          screenOptions={{
            headerStyle: {
              backgroundColor: "#16a34a",
            },
            headerTintColor: "#fff",
            headerTitleStyle: {
              fontWeight: "bold",
            },
          }}
        >
          <Stack.Screen
            name="(tabs)"
            options={{
              headerShown: false,
            }}
          />
          <Stack.Screen
            name="results"
            options={{
              title: "Results",
            }}
          />
          <Stack.Screen
            name="teams"
            options={{
              title: "Teams",
            }}
          />
          <Stack.Screen
            name="players"
            options={{
              title: "Players",
            }}
          />
          <Stack.Screen
            name="news"
            options={{
              title: "News",
            }}
          />
          <Stack.Screen
            name="match/[matchId]"
            options={{
              title: "Match",
            }}
          />
          <Stack.Screen
            name="player/[playerId]"
            options={{
              title: "Player Profile",
            }}
          />
          <Stack.Screen
            name="team/[teamId]"
            options={{
              title: "Team Details",
            }}
          />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

