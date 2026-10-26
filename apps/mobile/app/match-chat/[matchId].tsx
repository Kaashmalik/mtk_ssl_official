import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import {
  MATCH_CHAT_MAX_LENGTH,
  MATCH_CHAT_MUTE_MINUTES,
  MATCH_CHAT_REPORT_REASONS,
  type MatchChatMessage,
  type MatchChatReportReason,
} from "@mtk/contracts";
import { useMatchChat } from "@/hooks/use-match-chat";
import { moderateChat, newChatClientKey, reportChat, sendChat, type ChatModeration } from "@/lib/chat-client";
import { useThemeColors, type ThemeColors } from "@/theme/tokens";

/**
 * ENH-10-03 native match chat. Same contract, routes and merge rule as the
 * web panel; the server decides who may post. An inverted list keeps the
 * newest message at the bottom without yanking a reader who scrolled up.
 */

const AWAY_OFFSET = 80;

function muteLabel(minutes: number) {
  return minutes >= 60 ? `${minutes / 60} h` : `${minutes} min`;
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const MessageRow = memo(function MessageRow({
  message,
  parent,
  own,
  colors,
  modLabel,
  reportLabel,
  onReply,
  onReport,
}: {
  message: MatchChatMessage;
  parent: MatchChatMessage | undefined;
  own: boolean;
  colors: ThemeColors;
  modLabel: string;
  reportLabel: string;
  onReply: (m: MatchChatMessage) => void;
  onReport: (m: MatchChatMessage) => void;
}) {
  const actions = [{ name: "activate", label: "Reply" }, ...(own ? [] : [{ name: "report", label: reportLabel }])];
  return (
    <Pressable
      onPress={() => onReply(message)}
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${message.authorName}${message.isModerator ? `, ${modLabel}` : ""}, ${timeLabel(message.createdAt)}: ${message.body}`}
      accessibilityHint="Double tap to reply"
      accessibilityActions={actions}
      onAccessibilityAction={(e) => (e.nativeEvent.actionName === "report" ? onReport(message) : onReply(message))}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}
    >
      {parent ? (
        <Text numberOfLines={1} style={[styles.parent, { color: colors.textMuted, borderLeftColor: colors.border }]}>
          {parent.authorName}: {parent.body}
        </Text>
      ) : null}
      <View style={styles.rowHeader}>
        <Text style={[styles.author, { color: colors.text }]}>{message.authorName}</Text>
        {message.isModerator ? (
          <Text style={[styles.mod, { color: colors.tint, borderColor: colors.tint }]}>{modLabel}</Text>
        ) : null}
        <Text style={[styles.time, { color: colors.textMuted }]}>{timeLabel(message.createdAt)}</Text>
        {!own ? (
          <Pressable
            onPress={() => onReport(message)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={`${reportLabel} ${message.authorName}`}
            style={styles.flag}
          >
            <Ionicons name="flag-outline" size={14} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      <Text style={[styles.body, { color: colors.text }]}>{message.body}</Text>
    </Pressable>
  );
});

export default function MatchChatScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const colors = useThemeColors();

  const listRef = useRef<FlatList<MatchChatMessage>>(null);
  const awayRef = useRef(false);
  const [unseen, setUnseen] = useState(0);

  const onNewWhileAway = useCallback((count: number) => {
    if (!awayRef.current) return;
    setUnseen((n) => n + count);
    AccessibilityInfo.announceForAccessibility(t("chat.newMessages", { count }));
  }, [t]);

  const { status, messages, meta, apply } = useMatchChat(matchId, onNewWhileAway);

  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<MatchChatMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [reporting, setReporting] = useState<MatchChatMessage | null>(null);
  const clientKeyRef = useRef(newChatClientKey());

  const mutedUntil = meta?.viewer.mutedUntil ? new Date(meta.viewer.mutedUntil).getTime() : 0;
  const waitUntil = Math.max(cooldownUntil, meta?.viewer.canModerate ? 0 : mutedUntil);
  useEffect(() => {
    if (waitUntil <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waitUntil]);

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  // Inverted list: newest first.
  const data = useMemo(() => [...messages].reverse(), [messages]);
  const secondsLeft = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  const blockedReason = !meta ? null
    : !meta.postingOpen ? t("chat.closed")
    : meta.viewer.blocked && !meta.viewer.canModerate ? t("chat.blocked")
    : mutedUntil > now && !meta.viewer.canModerate ? t("chat.muted", { minutes: Math.ceil((mutedUntil - now) / 60000) })
    : null;

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    // Inverted: offset 0 is the newest message.
    awayRef.current = e.nativeEvent.contentOffset.y > AWAY_OFFSET;
    if (!awayRef.current) setUnseen(0);
  }, []);

  const jumpToLatest = () => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    awayRef.current = false;
    setUnseen(0);
  };

  async function send() {
    const body = draft.trim();
    if (!matchId || !body || sending || blockedReason || secondsLeft > 0) return;
    setSending(true);
    setError(null);
    const result = await sendChat(matchId, { body, clientKey: clientKeyRef.current, replyToId: replyTo?.id ?? null });
    setSending(false);
    if (result.ok) {
      apply([result.message]);
      setDraft("");
      setReplyTo(null);
      clientKeyRef.current = newChatClientKey();
      jumpToLatest();
      if (meta && meta.slowModeSeconds > 0 && !meta.viewer.canModerate) {
        setCooldownUntil(Date.now() + meta.slowModeSeconds * 1000);
        setNow(Date.now());
      }
      return;
    }
    // Same client key on retry: a lost response can never double-post.
    if (result.retryAfterSeconds) {
      setCooldownUntil(Date.now() + result.retryAfterSeconds * 1000);
      setNow(Date.now());
    }
    setError(result.error);
  }

  async function report(reason: MatchChatReportReason) {
    const message = reporting;
    setReporting(null);
    if (!matchId || !message) return;
    const result = await reportChat(matchId, message.id, reason);
    const text = result.ok ? t("chat.reported") : result.error ?? "That report could not be sent.";
    setError(result.ok ? null : text);
    AccessibilityInfo.announceForAccessibility(text);
  }

  async function moderate(input: ChatModeration) {
    const message = reporting;
    setReporting(null);
    if (!matchId || !message) return;
    const result = await moderateChat(matchId, input);
    if (result.ok && input.action === "hide") apply([], [input.messageId]);
    const text = !result.ok
      ? result.error ?? "That action could not be completed."
      : input.action === "hide"
        ? t("chat.hidden")
        : t("chat.muted.done", { name: message.authorName, duration: muteLabel(input.minutes) });
    setError(result.ok ? null : text);
    AccessibilityInfo.announceForAccessibility(text);
  }

  const renderItem = useCallback(({ item }: { item: MatchChatMessage }) => (
    <MessageRow
      message={item}
      parent={item.replyToId ? byId.get(item.replyToId) : undefined}
      own={item.authorId === meta?.viewer.id}
      colors={colors}
      modLabel={t("chat.mod")}
      reportLabel={t("chat.report")}
      onReply={setReplyTo}
      onReport={setReporting}
    />
  ), [byId, colors, meta?.viewer.id, t]);

  if (status !== "ready" && status !== "error") {
    const text = {
      loading: t("chat.loading"),
      off: t("chat.off"),
      signin: t("chat.signIn"),
      forbidden: t("chat.notMember"),
      unavailable: t("chat.closed"),
    }[status];
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        {status === "loading" ? <ActivityIndicator color={colors.tint} /> : null}
        <Text style={[styles.centerText, { color: colors.textMuted }]} accessibilityLiveRegion="polite">{text}</Text>
        {status === "signin" ? (
          <Pressable onPress={() => router.push("/sign-in")} accessibilityRole="button" style={[styles.cta, { backgroundColor: colors.tint }]}>
            <Text style={{ color: colors.onTint, fontWeight: "700" }}>Sign in</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      {meta?.pinned ? (
        <View style={[styles.pinned, { backgroundColor: colors.surface, borderBottomColor: colors.border }]} accessibilityRole="summary">
          <Ionicons name="pin" size={16} color={colors.tint} />
          <Text style={[styles.pinnedText, { color: colors.text }]}>
            <Text style={{ fontWeight: "700" }}>{t("chat.announcement")}: </Text>
            {meta.pinned.body}
          </Text>
        </View>
      ) : null}

      {status === "error" && messages.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.centerText, { color: colors.textMuted }]}>{t("chat.unavailable")}</Text>
        </View>
      ) : (
        <View style={styles.flex}>
          <FlatList
            ref={listRef}
            inverted
            data={data}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            onScroll={onScroll}
            scrollEventThrottle={64}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <Text style={[styles.centerText, styles.empty, { color: colors.textMuted }]}>{t("chat.empty")}</Text>
            }
            accessibilityLabel={t("chat.title")}
          />
          {unseen > 0 ? (
            <Pressable
              onPress={jumpToLatest}
              accessibilityRole="button"
              style={[styles.pill, { backgroundColor: colors.tint }]}
            >
              <Ionicons name="arrow-down" size={14} color={colors.onTint} />
              <Text style={{ color: colors.onTint, fontWeight: "700", fontSize: 13 }}>{t("chat.newMessages", { count: unseen })}</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
        {replyTo ? (
          <View style={[styles.replyBar, { backgroundColor: colors.surface }]}>
            <Text numberOfLines={1} style={[styles.replyText, { color: colors.textMuted }]}>
              ↪ {replyTo.authorName}: {replyTo.body}
            </Text>
            <Pressable onPress={() => setReplyTo(null)} hitSlop={12} accessibilityRole="button" accessibilityLabel={t("chat.cancel")}>
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </Pressable>
          </View>
        ) : null}
        {error ? (
          <Text style={[styles.status, { color: colors.danger }]} accessibilityLiveRegion="polite">{error}</Text>
        ) : null}
        {blockedReason ? (
          <Text style={[styles.status, { color: colors.textMuted, textAlign: "center" }]}>{blockedReason}</Text>
        ) : (
          <>
            <View style={styles.inputRow}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={t("chat.placeholder")}
                placeholderTextColor={colors.textMuted}
                maxLength={MATCH_CHAT_MAX_LENGTH}
                editable={!sending}
                returnKeyType="send"
                onSubmitEditing={send}
                blurOnSubmit={false}
                accessibilityLabel={t("chat.placeholder")}
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
              />
              <Pressable
                onPress={send}
                disabled={!draft.trim() || sending || secondsLeft > 0}
                accessibilityRole="button"
                accessibilityLabel={t("chat.send")}
                accessibilityState={{ disabled: !draft.trim() || sending || secondsLeft > 0, busy: sending }}
                style={[styles.sendButton, { backgroundColor: colors.tint, opacity: !draft.trim() || sending || secondsLeft > 0 ? 0.5 : 1 }]}
              >
                {sending ? <ActivityIndicator color={colors.onTint} size="small" /> : <Ionicons name="send" size={18} color={colors.onTint} />}
              </Pressable>
            </View>
            <View style={styles.metaRow}>
              <Text style={[styles.metaText, { color: colors.textMuted }]} accessibilityLiveRegion="polite">
                {secondsLeft > 0 ? t("chat.slowMode", { seconds: secondsLeft }) : ""}
              </Text>
              <Text style={[styles.metaText, { color: colors.textMuted }]}>{draft.length}/{MATCH_CHAT_MAX_LENGTH}</Text>
            </View>
          </>
        )}
      </View>

      <Modal visible={reporting !== null} transparent animationType="fade" onRequestClose={() => setReporting(null)}>
        <Pressable style={styles.backdrop} onPress={() => setReporting(null)} accessibilityLabel={t("chat.cancel")}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.background }]} onPress={() => {}}>
            <Text style={[styles.sheetTitle, { color: colors.text }]} accessibilityRole="header">{t("chat.reportTitle")}</Text>
            {reporting ? (
              <Text numberOfLines={2} style={[styles.sheetQuote, { color: colors.textMuted }]}>
                {reporting.authorName}: {reporting.body}
              </Text>
            ) : null}
            {MATCH_CHAT_REPORT_REASONS.map((reason) => (
              <Pressable
                key={reason}
                onPress={() => report(reason)}
                accessibilityRole="button"
                style={[styles.sheetOption, { borderColor: colors.border }]}
              >
                <Text style={{ color: colors.text, fontSize: 16 }}>{t(`chat.reason.${reason}`)}</Text>
              </Pressable>
            ))}
            {meta?.viewer.canModerate && reporting ? (
              <>
                <Text style={[styles.sheetSection, { color: colors.textMuted }]} accessibilityRole="header">{t("chat.moderate")}</Text>
                <Pressable
                  onPress={() => moderate({ action: "hide", messageId: reporting.id })}
                  accessibilityRole="button"
                  style={[styles.sheetOption, { borderColor: colors.border }]}
                >
                  <Text style={{ color: colors.danger, fontSize: 16 }}>{t("chat.hide")}</Text>
                </Pressable>
                {!reporting.isModerator ? (
                  <View style={styles.muteRow}>
                    {MATCH_CHAT_MUTE_MINUTES.map((minutes) => (
                      <Pressable
                        key={minutes}
                        onPress={() => moderate({ action: "mute", userId: reporting.authorId, minutes })}
                        accessibilityRole="button"
                        accessibilityLabel={t("chat.mute", { duration: muteLabel(minutes) })}
                        style={[styles.muteChip, { borderColor: colors.border }]}
                      >
                        <Text style={{ color: colors.text, fontSize: 14 }}>{muteLabel(minutes)}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </>
            ) : null}
            <Pressable onPress={() => setReporting(null)} accessibilityRole="button" style={styles.sheetCancel}>
              <Text style={{ color: colors.textMuted, fontSize: 16 }}>{t("chat.cancel")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  centerText: { fontSize: 15, textAlign: "center", lineHeight: 22 },
  cta: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10, minHeight: 44, justifyContent: "center" },
  empty: { paddingVertical: 48, paddingHorizontal: 24 },
  listContent: { paddingVertical: 8 },
  row: { paddingHorizontal: 16, paddingVertical: 8, minHeight: 44 },
  rowHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  author: { fontSize: 14, fontWeight: "700" },
  mod: { fontSize: 10, fontWeight: "700", borderWidth: 1, borderRadius: 4, paddingHorizontal: 4, textTransform: "uppercase" },
  time: { fontSize: 12 },
  flag: { marginLeft: "auto", padding: 4 },
  body: { fontSize: 15, lineHeight: 21, marginTop: 2 },
  parent: { fontSize: 12, borderLeftWidth: 2, paddingLeft: 8, marginBottom: 4 },
  pinned: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  pinnedText: { flex: 1, fontSize: 14, lineHeight: 20 },
  pill: {
    position: "absolute", bottom: 12, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, minHeight: 36,
  },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, padding: 12, gap: 6 },
  replyBar: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  replyText: { flex: 1, fontSize: 12 },
  status: { fontSize: 13 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 15 },
  sendButton: { width: 44, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  metaRow: { flexDirection: "row", justifyContent: "space-between" },
  metaText: { fontSize: 12 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, gap: 8 },
  sheetTitle: { fontSize: 17, fontWeight: "700" },
  sheetQuote: { fontSize: 13, marginBottom: 8 },
  sheetOption: { minHeight: 48, justifyContent: "center", borderTopWidth: StyleSheet.hairlineWidth },
  sheetCancel: { minHeight: 48, justifyContent: "center", alignItems: "center", marginTop: 4 },
  sheetSection: { fontSize: 13, fontWeight: "700", textTransform: "uppercase", marginTop: 12 },
  muteRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 4 },
  muteChip: { minHeight: 44, minWidth: 64, paddingHorizontal: 12, borderWidth: 1, borderRadius: 10, alignItems: "center", justifyContent: "center" },
});
