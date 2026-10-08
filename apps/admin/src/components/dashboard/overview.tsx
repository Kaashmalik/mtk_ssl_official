"use client";

import { useEffect, useState } from "react";
import { RevenueMetrics } from "./revenue-metrics";
import { LeaguesList } from "./leagues-list";
import { SystemStatus } from "./system-status";
import { Activity, RefreshCw } from "lucide-react";

export function DashboardOverview() {
  const [revenue, setRevenue] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchData(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    try {
      const [revRes, healthRes] = await Promise.all([
        fetch("/api/revenue"),
        fetch("/api/system-health"),
      ]);
      const [revData, healthData] = await Promise.all([revRes.json(), healthRes.json()]);
      setRevenue(revData);
      setHealth(healthData);
    } catch (error) {
      console.error("Dashboard fetch failed:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { fetchData(); }, []);

  const overallStatus = health?.status ?? "unknown";
  const statusColor =
    overallStatus === "healthy" ? "text-emerald-500" :
    overallStatus === "degraded" ? "text-amber-500" : "text-red-500";
  const statusDot =
    overallStatus === "healthy" ? "bg-emerald-500" :
    overallStatus === "degraded" ? "bg-amber-500" : "bg-red-500";

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Platform Overview
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Real-time metrics and platform health for SSL Super League.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Status pill */}
          <div className="hidden sm:flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1.5 shadow-sm">
            <span className={`h-2 w-2 rounded-full ${statusDot} animate-pulse`} />
            <span className={`text-xs font-medium capitalize ${statusColor}`}>
              {overallStatus}
            </span>
            <Activity className="h-3 w-3 text-muted-foreground" />
          </div>
          {/* Refresh */}
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Revenue KPIs */}
      <RevenueMetrics data={revenue} loading={loading} stats={health?.stats} />

      {/* Bottom grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <LeaguesList />
        <SystemStatus healthData={health} loading={loading} />
      </div>
    </div>
  );
}

