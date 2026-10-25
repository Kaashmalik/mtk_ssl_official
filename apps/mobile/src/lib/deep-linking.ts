import * as Linking from "expo-linking";
import { useRouter } from "expo-router";

/**
 * Batch 149: web deep links resolve against the hosts the platform actually
 * serves — www.cricketleague.tech (live) and the apex — while the RETIRED
 * ssl.mtkcodex.site stays accepted so links already shared to it keep
 * opening the right screen. The custom `ssl://` scheme is unchanged.
 */
const DEEP_LINK_HOSTS = [
  "www.cricketleague.tech",
  "cricketleague.tech",
  "ssl.mtkcodex.site",
];

export function useDeepLinking() {
  const router = useRouter();

  const handleDeepLink = (url: string) => {
    const parsed = Linking.parse(url);
    const host = (parsed.hostname || "").toLowerCase();

    // Web URLs only count when they belong to the platform; foreign hosts
    // (a malicious lookalike, a random link) never navigate the app.
    if (host && !DEEP_LINK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
      return;
    }

    const { path } = parsed;

    // Handle <web>/match/abc or ssl://match/abc
    if (path?.includes("/match/") || path?.startsWith("match/")) {
      const matchId = path.split("/match/")[1] || path.split("match/")[1];
      if (matchId) {
        router.push(`/match/${matchId}`);
      }
    }

    // Handle <web>/player/abc
    if (path?.includes("/player/") || path?.startsWith("player/")) {
      const playerId = path.split("/player/")[1] || path.split("player/")[1];
      if (playerId) {
        router.push(`/player/${playerId}`);
      }
    }
  };

  return { handleDeepLink };
}
