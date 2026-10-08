import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const supabaseUrl = Constants.expoConfig?.extra?.supabaseUrl || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = Constants.expoConfig?.extra?.supabaseAnonKey || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

const isWeb = Platform.OS === "web";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabaseUnavailableReason = isSupabaseConfigured
  ? null
  : "Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. Set them via EAS secrets or app.config.js.";

// Custom storage adapter using SecureStore for mobile and localStorage for Web
const ExpoSecureStoreAdapter = {
  getItem: async (key: string) => {
    if (isWeb) {
      if (typeof window !== "undefined") {
        return localStorage.getItem(key);
      }
      return null;
    }
    return await SecureStore.getItemAsync(key);
  },
  setItem: async (key: string, value: string) => {
    if (isWeb) {
      if (typeof window !== "undefined") {
        localStorage.setItem(key, value);
      }
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  removeItem: async (key: string) => {
    if (isWeb) {
      if (typeof window !== "undefined") {
        localStorage.removeItem(key);
      }
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error(`Supabase is not configured: ${supabaseUnavailableReason}`);
  }
  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: ExpoSecureStoreAdapter,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    const instance = getClient() as unknown as Record<string | symbol, unknown>;
    const value = instance[property];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(instance) : value;
  },
  has(_target, property) {
    return property in (getClient() as unknown as object);
  },
});
