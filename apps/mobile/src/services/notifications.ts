import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import i18n from "@/lib/i18n";
import { authedFetch } from "@/lib/app-api";

const isExpoGo = Constants.appOwnership === "expo";

const getNotifications = () => {
  return require("expo-notifications") as any;
};

/**
 * B162: register this device's Expo push token with the platform.
 *
 * SCORE-08 discipline: the device talks ONLY to the web app's mobile intake
 * (`/api/mobile/push/register`), authenticated with the Clerk session bearer
 * token via authedFetch - never an ad-hoc API, and never a client-asserted
 * user id (the server takes the identity from the verified session). The
 * server's per-league consent + quiet-hours gates decide whether a token is
 * ever USED; registration here only makes delivery possible.
 *
 * Returns the token on success, null when registration could not complete
 * (no session, unconfigured URL, or a refused payload) - callers treat null
 * as "push unavailable", never as an error to retry-spam.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (isExpoGo) {
    return null;
  }
  try {
    const Notifications = getNotifications();
    const projectId =
      process.env.EXPO_PUBLIC_PROJECT_ID || Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      // eslint-disable-next-line no-console
      console.warn("Push registration skipped: no EAS project id configured");
      return null;
    }
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token?.data) return null;

    const response = await authedFetch("/api/mobile/push/register", {
      method: "POST",
      body: JSON.stringify({
        token: token.data,
        platform: Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : null,
        deviceId: Constants.sessionId ? String(Constants.sessionId).slice(0, 128) : null,
        active: true,
      }),
    });
    if (!response.ok) {
      // eslint-disable-next-line no-console
      console.warn("Push registration refused:", response.status);
      return null;
    }
    return token.data;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("Push registration unavailable:", error);
    return null;
  }
}

/**
 * Deregister this device's token (e.g. on sign-out): the server soft-deletes
 * so the token can never fan a notification to a signed-out device.
 */
export async function deregisterPushNotifications(token: string): Promise<boolean> {
  try {
    const response = await authedFetch("/api/mobile/push/register", {
      method: "DELETE",
      body: JSON.stringify({ token }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Send local notification for wicket
 */
export async function notifyWicket(batsmanName: string) {
  if (isExpoGo) return;
  const Notifications = getNotifications();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: i18n.t("match.wicket"),
      body: i18n.t("notification.wicket", { batsman: batsmanName }),
      sound: true,
      data: { type: "wicket" },
    },
    trigger: null,
  });
}

/**
 * Send local notification for match start
 */
export async function notifyMatchStart(team1Name: string, team2Name: string, matchId: string) {
  if (isExpoGo) return;
  const Notifications = getNotifications();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: i18n.t("match.start"),
      body: i18n.t("notification.matchStart", { team1: team1Name, team2: team2Name }),
      sound: true,
      data: { type: "match_start", matchId },
    },
    trigger: null,
  });
}

/**
 * Send local notification for match update
 */
export async function notifyMatchUpdate(teamName: string, score: string) {
  if (isExpoGo) return;
  const Notifications = getNotifications();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: i18n.t("liveScore"),
      body: i18n.t("notification.matchUpdate", { team: teamName, score }),
      sound: false,
      data: { type: "match_update" },
    },
    trigger: null,
  });
}

