import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Switch, Alert } from "react-native";
import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useAuth, useClerk } from "@clerk/clerk-expo";
import { useRouter } from "expo-router";
import { useOfflineStore } from "@/store/offline-store";
import { deregisterPushNotifications, getStoredPushToken } from "@/services/notifications";

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const [language, setLanguage] = useState(i18n.language);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const { isOnline } = useOfflineStore();
  // ENH-06-02: the native sign-out surface - previously the app had NO way
  // to sign out at all. Sign-out deregisters this device's push token while
  // the session is still valid, then ends the Clerk session.
  const { isSignedIn, userId } = useAuth();
  const { signOut } = useClerk();
  const router = useRouter();

  const confirmSignOut = () => {
    Alert.alert(t("account.signOut"), t("account.signOutConfirm"), [
      { text: t("account.cancel"), style: "cancel" },
      {
        text: t("account.signOut"),
        style: "destructive",
        onPress: async () => {
          const token = await getStoredPushToken();
          if (token) await deregisterPushNotifications(token);
          await signOut();
        },
      },
    ]);
  };

  const openSignIn = () => router.push("/sign-in");

  useEffect(() => {
    // Load persisted settings
    const loadSettings = async () => {
      try {
        const lang = await AsyncStorage.getItem("language");
        if (lang) {
          setLanguage(lang);
        }
        const notif = await AsyncStorage.getItem("notificationsEnabled");
        if (notif !== null) {
          setNotificationsEnabled(notif === "true");
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("Failed to load settings:", e);
      }
    };
    loadSettings();
  }, []);

  const changeLanguage = async (lang: "en" | "ur") => {
    await i18n.changeLanguage(lang);
    await AsyncStorage.setItem("language", lang);
    setLanguage(lang);
  };

  const toggleNotifications = async (value: boolean) => {
    try {
      setNotificationsEnabled(value);
      await AsyncStorage.setItem("notificationsEnabled", value ? "true" : "false");
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Failed to save notification settings:", e);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t("settings")}</Text>
        <Text style={styles.headerSubtitle}>Preferences and app information</Text>
      </View>

      {/* Account (ENH-06-02) */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        {isSignedIn ? (
          <>
            <View style={styles.settingRow}>
              <Ionicons name="person-circle-outline" size={22} color="#16a34a" />
              <View style={styles.settingInfo}>
                <Text style={styles.settingTitle}>{t("account.signedIn")}</Text>
                {userId && <Text style={styles.settingDescription}>{userId.slice(0, 24)}…</Text>}
              </View>
            </View>
            <TouchableOpacity
              style={styles.signOutButton}
              onPress={confirmSignOut}
              accessibilityRole="button"
              accessibilityLabel={t("account.signOut")}
            >
              <Ionicons name="log-out-outline" size={18} color="#dc2626" />
              <Text style={styles.signOutText}>{t("account.signOut")}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.settingDescription}>{t("account.signedOut")}</Text>
            <TouchableOpacity
              style={styles.signInButton}
              onPress={openSignIn}
              accessibilityRole="button"
              accessibilityLabel={t("account.signIn")}
            >
              <Ionicons name="log-in-outline" size={18} color="#ffffff" />
              <Text style={styles.signInText}>{t("account.signIn")}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Language Settings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("settings.language")}</Text>
        <View style={styles.options}>
          <TouchableOpacity
            style={[styles.option, language === "en" && styles.activeOption]}
            onPress={() => changeLanguage("en")}
          >
            <Text style={[styles.optionText, language === "en" && styles.activeOptionText]}>
              English
            </Text>
            {language === "en" && <Ionicons name="checkmark" size={20} color="#16a34a" />}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.option, language === "ur" && styles.activeOption]}
            onPress={() => changeLanguage("ur")}
          >
            <Text style={[styles.optionText, language === "ur" && styles.activeOptionText]}>
              اردو
            </Text>
            {language === "ur" && <Ionicons name="checkmark" size={20} color="#16a34a" />}
          </TouchableOpacity>
        </View>
      </View>

      {/* Notifications */}
      <View style={styles.section}>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingTitle}>{t("settings.notifications")}</Text>
            <Text style={styles.settingDescription}>
              Receive notifications for wickets and match updates
            </Text>
          </View>
          <Switch
            value={notificationsEnabled}
            onValueChange={toggleNotifications}
            trackColor={{ false: "#d1d5db", true: "#16a34a" }}
            thumbColor="#fff"
          />
        </View>
      </View>

      {/* Offline Status */}
      <View style={styles.section}>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingTitle}>{t("settings.offlineMode")}</Text>
            <Text style={styles.settingDescription}>
              {isOnline ? t("online") : t("offline")}
            </Text>
          </View>
          <Ionicons
            name={isOnline ? "cloud" : "cloud-offline"}
            size={24}
            color={isOnline ? "#16a34a" : "#6b7280"}
          />
        </View>
      </View>

      {/* About */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("settings.about")}</Text>
        <View style={styles.aboutCard}>
          <Text style={styles.appName}>Shakir Super League</Text>
          <Text style={styles.appVersion}>Version 1.0.0</Text>
          <Text style={styles.appDescription}>
            Pakistan's #1 Cricket Tournament & League Management Platform
          </Text>
          <Text style={styles.appAuthor}>Built by Malik Tech (MTK)</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f6f7fb",
  },
  content: {
    paddingBottom: 24,
  },
  header: {
    backgroundColor: "#16a34a",
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 16,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#fff",
  },
  headerSubtitle: {
    marginTop: 6,
    fontSize: 14,
    color: "#dcfce7",
  },
  section: {
    backgroundColor: "#fff",
    marginTop: 16,
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#eef2f7",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#111827",
    marginBottom: 16,
  },
  options: {
    gap: 8,
  },
  option: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
  },
  activeOption: {
    backgroundColor: "#dcfce7",
    borderWidth: 2,
    borderColor: "#16a34a",
  },
  optionText: {
    fontSize: 16,
    color: "#111827",
  },
  activeOptionText: {
    color: "#16a34a",
    fontWeight: "600",
  },
  settingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 14,
    color: "#6b7280",
  },
  aboutCard: {
    alignItems: "center",
    padding: 20,
  },
  appName: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#111827",
    marginBottom: 8,
  },
  appVersion: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 12,
  },
  appDescription: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    marginBottom: 8,
  },
  appAuthor: {
    fontSize: 12,
    color: "#9ca3af",
  },
  signOutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#fef2f2",
  },
  signOutText: {
    color: "#dc2626",
    fontSize: 15,
    fontWeight: "600",
  },
  signInButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#16a34a",
  },
  signInText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
});

