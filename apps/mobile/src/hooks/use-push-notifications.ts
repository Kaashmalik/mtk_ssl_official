import { useEffect, useRef } from "react";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { useRouter } from "expo-router";

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

  useEffect(() => {
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
  }, []);

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

  const projectId = process.env.EXPO_PUBLIC_PROJECT_ID;
  if (!projectId) {
    warn("EXPO_PUBLIC_PROJECT_ID not set, skipping push token registration");
    return;
  }

  const token = await Notifications.getExpoPushTokenAsync({ projectId });

  log("Push token:", token.data);

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#16a34a",
    });
  }

  return token.data;
}

