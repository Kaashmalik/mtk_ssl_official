import { useEffect, useRef } from "react";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@clerk/clerk-expo";
import { registerForPushNotifications } from "@/services/notifications";

const isExpoGo = Constants.appOwnership === "expo";

const getNotifications = () => {
  return require("expo-notifications") as any;
};

const log = (...args: unknown[]) => {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
};

const warn = (...args: unknown[]) => {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.warn(...args);
  }
};

export function usePushNotifications() {
  const router = useRouter();
  const notificationListener = useRef<any>(null);
  const responseListener = useRef<any>(null);
  // ENH-06-02: registration requires an ACTUAL session - a token is always
  // attributable to the signed-in account, and re-runs when the session
  // appears (sign-in after launch). The hook is mounted inside
  // ClerkProvider (see app/_layout.tsx) so useAuth() is legal here.
  const { isSignedIn } = useAuth();

  useEffect(() => {
    if (!isSignedIn) return;
    if (Platform.OS === "web") return;
    if (isExpoGo) {
      warn(
        "Push notifications are not supported in Expo Go. Use a development build."
      );
      return;
    }

    const Notifications = getNotifications();

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });

    registerForPushNotificationsAsync().catch((e) =>
      warn("Push notification setup failed:", e)
    );

    // Handle notifications received while app is foregrounded
    notificationListener.current =
      Notifications.addNotificationReceivedListener((notification: any) => {
        log("Notification received:", notification);
      });

    // Handle user tapping on notification
    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response: any) => {
        log("Notification tapped:", response);
        // Handle deep linking here
        const data = response.notification.request.content.data;
        if (data?.matchId) {
          // Navigate to match screen
          router.push(`/match/${data.matchId}`);
        }
      });

    return () => {
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
    };
  }, [isSignedIn]);

  return {
    sendLocalNotification: async (title: string, body: string, data?: any) => {
      if (isExpoGo) return;
      const Notifications = getNotifications();
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data,
          sound: true,
        },
        trigger: null, // Show immediately
      });
    },
  };
}

async function registerForPushNotificationsAsync() {
  if (!Device.isDevice) {
    warn("Must use physical device for Push Notifications");
    return;
  }

  if (isExpoGo) {
    warn("Push notifications are not supported in Expo Go");
    return;
  }

  const Notifications = getNotifications();

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    warn("Failed to get push token for push notification!");
    return;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#16a34a",
    });
  }

  // B162: token fetch + server registration happen in the push service, which
  // rides the Clerk-authenticated mobile intake (never a client-asserted id).
  await registerForPushNotifications();
}

