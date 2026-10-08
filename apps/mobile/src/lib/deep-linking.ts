import * as Linking from "expo-linking";
import { useRouter } from "expo-router";

/**
 * Handle deep links from ssl.mtkcodex.site/match/abc format
 */
export function useDeepLinking() {
  const router = useRouter();

  const handleDeepLink = (url: string) => {
    const { path } = Linking.parse(url);

    // Handle ssl.mtkcodex.site/match/abc or ssl://match/abc
    if (path?.includes("/match/") || path?.startsWith("match/")) {
      const matchId = path.split("/match/")[1] || path.split("match/")[1];
      if (matchId) {
        router.push(`/match/${matchId}`);
      }
    }

    // Handle ssl.mtkcodex.site/player/abc
    if (path?.includes("/player/") || path?.startsWith("player/")) {
      const playerId = path.split("/player/")[1] || path.split("player/")[1];
      if (playerId) {
        router.push(`/player/${playerId}`);
      }
    }
  };

  return { handleDeepLink };
}

