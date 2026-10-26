import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import * as Localization from "expo-localization";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Translations
const resources = {
  en: {
    translation: {
      // Navigation
      home: "Home",
      matches: "Matches",
      live: "Live",
      upcoming: "Upcoming",
      completed: "Completed",
      players: "Players",
      profile: "Profile",
      settings: "Settings",
      
      // Match
      match: "Match",
      liveScore: "Live Score",
      scorecard: "Scorecard",
      commentary: "Commentary",
      "match.start": "Match Started",
      "match.wicket": "Wicket!",
      "match.over": "Over",
      "match.runs": "Runs",
      "match.wickets": "Wickets",
      "match.overs": "Overs",
      "match.required": "Required",
      "match.target": "Target",
      "match.currentRunRate": "Current RR",
      "match.requiredRunRate": "Required RR",
      
      // Player
      "player.profile": "Player Profile",
      "player.stats": "Statistics",
      "player.matches": "Matches",
      "player.runs": "Runs",
      "player.wickets": "Wickets",
      "player.average": "Average",
      "player.strikeRate": "Strike Rate",
      "player.economy": "Economy",
      
      // Common
      loading: "Loading...",
      error: "Error",
      retry: "Retry",
      offline: "Offline",
      online: "Online",
      sync: "Sync",
      "sync.pending": "Syncing pending data...",
      "sync.complete": "Sync complete",

      // Account (ENH-06-02: the native session lifecycle)
      "account.signedIn": "Signed in",
      "account.signedOut": "Signed out - sign in to see your league",
      "account.signOut": "Sign out",
      "account.signOutConfirm": "Sign out of this device? Push notifications stop until you sign in again.",
      "account.cancel": "Cancel",
      "account.signIn": "Sign in",
      
      // Notifications
      "notification.wicket": "Wicket! {{batsman}} out",
      "notification.matchStart": "Match started: {{team1}} vs {{team2}}",
      "notification.matchUpdate": "{{team}} is now {{score}}",
      
      // Settings
      "settings.language": "Language",
      "settings.notifications": "Notifications",
      "settings.offlineMode": "Offline Mode",
      "settings.about": "About",

      // Match chat (ENH-10)
      "chat.title": "Match chat",
      "chat.open": "Open match chat",
      "chat.placeholder": "Say something about the match…",
      "chat.send": "Send message",
      "chat.empty": "No messages yet. Say something about the match.",
      "chat.loading": "Loading chat…",
      "chat.unavailable": "Chat is unavailable right now. It will reconnect automatically.",
      "chat.off": "Chat is turned off for this league.",
      "chat.closed": "Chat is closed for this match.",
      "chat.signIn": "Sign in to join the match chat.",
      "chat.notMember": "Join this league as a fan to take part in the match chat.",
      "chat.blocked": "You can't post in this league's chat.",
      "chat.muted": "A moderator paused your chat. Try again in {{minutes}} min.",
      "chat.slowMode": "Slow mode: wait {{seconds}}s",
      "chat.newMessages": "{{count}} new messages",
      "chat.report": "Report",
      "chat.reportTitle": "Report this message?",
      "chat.reported": "Thanks. A moderator will review it.",
      "chat.reason.abusive": "Abusive",
      "chat.reason.spam": "Spam",
      "chat.reason.inappropriate": "Inappropriate",
      "chat.reason.other": "Other",
      "chat.mod": "Mod",
      "chat.announcement": "Announcement",
      "chat.cancel": "Cancel",
    },
  },
  ur: {
    translation: {
      // Navigation
      home: "ہوم",
      matches: "میچز",
      live: "لائیو",
      upcoming: "آنے والے",
      completed: "مکمل",
      players: "کھلاڑی",
      profile: "پروفائل",
      settings: "ترتیبات",
      
      // Match
      match: "میچ",
      liveScore: "لائیو اسکور",
      scorecard: "اسکور کارڈ",
      commentary: "کمنٹری",
      "match.start": "میچ شروع",
      "match.wicket": "وکٹ!",
      "match.over": "اوور",
      "match.runs": "رنز",
      "match.wickets": "وکٹیں",
      "match.overs": "اوورز",
      "match.required": "درکار",
      "match.target": "ہدف",
      "match.currentRunRate": "موجودہ رن ریٹ",
      "match.requiredRunRate": "درکار رن ریٹ",
      
      // Player
      "player.profile": "کھلاڑی پروفائل",
      "player.stats": "شماریات",
      "player.matches": "میچز",
      "player.runs": "رنز",
      "player.wickets": "وکٹیں",
      "player.average": "اوسط",
      "player.strikeRate": "سٹرائیک ریٹ",
      "player.economy": "اکانومی",
      
      // Common
      loading: "لوڈ ہو رہا ہے...",
      error: "خرابی",
      retry: "دوبارہ کوشش",
      offline: "آف لائن",
      online: "آن لائن",
      sync: "سینک",
      "sync.pending": "پینڈنگ ڈیٹا سینک ہو رہا ہے...",
      "sync.complete": "سینک مکمل",

      // Account (ENH-06-02)
      "account.signedIn": "سائن اِن",
      "account.signedOut": "سائن آؤٹ - اپنی لیگ دیکھنے کے لیے سائن اِن کریں",
      "account.signOut": "سائن آؤٹ",
      "account.signOutConfirm": "اس ڈیوائس سے سائن آؤٹ کریں؟ دوبارہ سائن اِن تک اطلاعات بند رہیں گیب۔",
      "account.cancel": "منسوخ کریں",
      "account.signIn": "سائن اِن کریں",
      
      // Notifications
      "notification.wicket": "وکٹ! {{batsman}} آؤٹ",
      "notification.matchStart": "میچ شروع: {{team1}} بمقابلہ {{team2}}",
      "notification.matchUpdate": "{{team}} اب {{score}} پر ہے",
      
      // Settings
      "settings.language": "زبان",
      "settings.notifications": "اطلاعات",
      "settings.offlineMode": "آف لائن موڈ",
      "settings.about": "کے بارے میں",

      // Match chat (ENH-10)
      "chat.title": "میچ چیٹ",
      "chat.open": "میچ چیٹ کھولیں",
      "chat.placeholder": "میچ کے بارے میں کچھ کہیں…",
      "chat.send": "پیغام بھیجیں",
      "chat.empty": "ابھی کوئی پیغام نہیں۔ میچ کے بارے میں کچھ کہیں۔",
      "chat.loading": "چیٹ لوڈ ہو رہی ہے…",
      "chat.unavailable": "چیٹ ابھی دستیاب نہیں۔ یہ خود دوبارہ جڑ جائے گی۔",
      "chat.off": "اس لیگ کے لیے چیٹ بند ہے۔",
      "chat.closed": "اس میچ کے لیے چیٹ بند ہے۔",
      "chat.signIn": "میچ چیٹ میں شامل ہونے کے لیے سائن ان کریں۔",
      "chat.notMember": "میچ چیٹ میں حصہ لینے کے لیے اس لیگ میں بطور فین شامل ہوں۔",
      "chat.blocked": "آپ اس لیگ کی چیٹ میں پیغام نہیں بھیج سکتے۔",
      "chat.muted": "ماڈریٹر نے آپ کی چیٹ روک دی ہے۔ {{minutes}} منٹ بعد کوشش کریں۔",
      "chat.slowMode": "سلو موڈ: {{seconds}} سیکنڈ انتظار کریں",
      "chat.newMessages": "{{count}} نئے پیغامات",
      "chat.report": "رپورٹ",
      "chat.reportTitle": "اس پیغام کی رپورٹ کریں؟",
      "chat.reported": "شکریہ۔ ماڈریٹر اس کا جائزہ لے گا۔",
      "chat.reason.abusive": "گالی گلوچ",
      "chat.reason.spam": "اسپام",
      "chat.reason.inappropriate": "نامناسب",
      "chat.reason.other": "دیگر",
      "chat.mod": "ماڈ",
      "chat.announcement": "اعلان",
      "chat.cancel": "منسوخ",
    },
  },
};

let defaultLang = "en";
try {
  const locales = Localization.getLocales();
  if (locales && locales.length > 0) {
    defaultLang = locales[0]?.languageCode || "en";
  }
} catch (error) {
  // eslint-disable-next-line no-console
  console.warn("Failed to get locales from expo-localization:", error);
}

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: defaultLang,
    fallbackLng: "en",
    interpolation: {
      escapeValue: false,
    },
    compatibilityJSON: "v3",
  });

// Load saved language preference
AsyncStorage.getItem("language").then((lang) => {
  if (lang && (lang === "en" || lang === "ur")) {
    i18n.changeLanguage(lang);
  }
});

export default i18n;

