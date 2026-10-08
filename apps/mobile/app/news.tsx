import { View, Text, StyleSheet, FlatList, RefreshControl } from "react-native";
import { useEffect, useState, useCallback } from "react";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { ErrorView } from "@/components/ErrorView";

interface NewsItem {
  id: string;
  title: string;
  summary?: string | null;
  publishedAt?: string | null;
}

export default function NewsScreen() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNews = useCallback(async () => {
    try {
      setError(null);
      const { data, error: fetchError } = await supabase
        .from("announcements")
        .select("id, title, summary:message, publishedAt:created_at")
        .order("created_at", { ascending: false })
        .limit(20);

      if (fetchError) throw fetchError;
      setNews((data || []) as NewsItem[]);
    } catch (e: any) {
      setError(e.message || "Failed to fetch news");
      setNews([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchNews();
  }, [fetchNews]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchNews();
  };

  if (loading) {
    return <LoadingSpinner message="Loading news..." />;
  }

  if (error) {
    return <ErrorView message={error} onRetry={fetchNews} />;
  }

  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>News</Text>
      <Text style={styles.headerSubtitle}>Tournament updates</Text>
    </View>
  );

  return (
    <FlatList
      data={news}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={renderHeader}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={["#16a34a"]} />
      }
      ListEmptyComponent={
        <View style={styles.emptyContainer}>
          <Ionicons name="newspaper-outline" size={64} color="#d1d5db" />
          <Text style={styles.emptyText}>No news yet</Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.newsCard}>
          <Text style={styles.newsTitle}>{item.title}</Text>
          {item.summary && <Text style={styles.newsSummary}>{item.summary}</Text>}
          {item.publishedAt && (
            <Text style={styles.newsDate}>
              {new Date(item.publishedAt).toLocaleString()}
            </Text>
          )}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 24,
    backgroundColor: "#f6f7fb",
  },
  header: {
    backgroundColor: "#16a34a",
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 16,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    marginBottom: 12,
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
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    color: "#6b7280",
    marginTop: 16,
  },
  newsCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
    borderWidth: 1,
    borderColor: "#eef2f7",
  },
  newsTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  newsSummary: {
    fontSize: 13,
    color: "#6b7280",
    marginTop: 6,
  },
  newsDate: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 8,
  },
});
