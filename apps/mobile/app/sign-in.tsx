import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuth, useClerk, useSignIn } from "@clerk/clerk-expo";

/** Shape of Clerk's email_code first factor (from @clerk/types). */
type EmailCodeFactor = { strategy: "email_code"; emailAddressId: string; safeIdentifier: string; primary?: boolean };

/**
 * SCORE-08: the native sign-in gate for scoring. Email-code first factor;
 * when the account has a second factor enrolled, Clerk's step-up response
 * surfaces a second step — never silently downgraded.
 */
export default function SignInScreen() {
  const { signIn, isLoaded } = useSignIn();
  const { setActive } = useClerk();
  const router = useRouter();

  const [emailAddress, setEmailAddress] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code" | "done">("email");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const startSignIn = async () => {
    if (!isLoaded || !signIn) return;
    setBusy(true);
    setError("");
    try {
      await signIn.create({ identifier: emailAddress.trim() });
      const emailFactor = signIn.supportedFirstFactors?.find(
        (factor) => factor.strategy === "email_code",
      ) as EmailCodeFactor | undefined;
      if (!emailFactor) {
        setError("This account signs in with a password. Use the web app once to confirm sign-in, then try again.");
        return;
      }
      await signIn.prepareFirstFactor({ strategy: "email_code", emailAddressId: emailFactor.emailAddressId });
      setStage("code");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in could not start");
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    if (!isLoaded || !signIn) return;
    setBusy(true);
    setError("");
    try {
      const result = await signIn.attemptFirstFactor({ strategy: "email_code", code: code.trim() });
      if (result.status === "complete" && result.createdSessionId) {
        await setActive!({ session: result.createdSessionId });
        setStage("done");
        router.replace("/");
      } else {
        setError("That code did not complete sign-in. Request a fresh code and try again.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in was not completed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sign in to score</Text>
      <Text style={styles.hint}>
        Scoring writes are tied to your account and league. Offline deliveries
        stay on this device and sync only for the account that recorded them.
      </Text>
      {stage === "email" && (
        <>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="Email address"
            placeholderTextColor="#6b7280"
            value={emailAddress}
            onChangeText={setEmailAddress}
          />
          <Pressable style={[styles.button, busy && styles.buttonDisabled]} disabled={busy} onPress={startSignIn}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Email me a code</Text>}
          </Pressable>
        </>
      )}
      {stage === "code" && (
        <>
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            placeholder="6-digit code"
            placeholderTextColor="#6b7280"
            value={code}
            onChangeText={setCode}
          />
          <Pressable style={[styles.button, busy && styles.buttonDisabled]} disabled={busy} onPress={verifyCode}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify and sign in</Text>}
          </Pressable>
        </>
      )}
      {error !== "" && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, paddingTop: 80, backgroundColor: "#f6f7fb" },
  title: { fontSize: 24, fontWeight: "bold", color: "#111827", marginBottom: 8 },
  hint: { color: "#4b5563", marginBottom: 24 },
  input: {
    backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12,
    padding: 14, marginBottom: 12, color: "#111827",
  },
  button: { backgroundColor: "#16a34a", borderRadius: 12, height: 52, alignItems: "center", justifyContent: "center" },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontWeight: "bold", fontSize: 16 },
  error: { color: "#dc2626", marginTop: 12 },
});
