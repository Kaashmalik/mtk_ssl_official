"use client";

import { TrendingUp, TrendingDown, DollarSign, BarChart3, PieChart, Users } from "lucide-react";

interface RevenueMetricsProps {
  data: any;
  loading: boolean;
  stats?: any;
}

const METRICS = (data: any) => [
  {
    key: "mrr",
    label: "MRR",
    desc: "Monthly Recurring",
    value: `₨ ${(data?.mrr || 0).toLocaleString()}`,
    change: "+12.5%",
    up: true,
    icon: DollarSign,
    accent: "from-violet-500/20 to-violet-500/5",
    iconBg: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  },
  {
    key: "arr",
    label: "ARR",
    desc: "Annual Recurring",
    value: `₨ ${(data?.arr || 0).toLocaleString()}`,
    change: "+12.5%",
    up: true,
    icon: BarChart3,
    accent: "from-indigo-500/20 to-indigo-500/5",
    iconBg: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
  },
  {
    key: "total",
    label: "Total Revenue",
    desc: "All-time",
    value: `₨ ${(data?.totalRevenue || 0).toLocaleString()}`,
    change: "+8.2%",
    up: true,
    icon: PieChart,
    accent: "from-sky-500/20 to-sky-500/5",
    iconBg: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  },
  {
    key: "churn",
    label: "Churn Rate",
    desc: "Monthly churn",
    value: `${(data?.churnRate || 0).toFixed(2)}%`,
    change: "-2.1%",
    up: false,
    icon: Users,
    accent: "from-emerald-500/20 to-emerald-500/5",
    iconBg: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  },
];

export function RevenueMetrics({ data, loading }: RevenueMetricsProps) {
  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="h-3 w-20 rounded-full bg-muted animate-pulse" />
              <div className="h-9 w-9 rounded-lg bg-muted animate-pulse" />
            </div>
            <div className="h-7 w-28 rounded-lg bg-muted animate-pulse mb-2" />
            <div className="h-3 w-14 rounded-full bg-muted animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  const metrics = METRICS(data);

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((m) => {
        const Icon = m.icon;
        const TrendIcon = m.up ? TrendingUp : TrendingDown;
        const trendColor = m.up ? "text-emerald-600 dark:text-emerald-400" : "text-red-500";
        const trendBg   = m.up ? "bg-emerald-500/10" : "bg-red-500/10";
        return (
          <div
            key={m.key}
            className="group relative overflow-hidden rounded-xl border border-border/50 bg-card shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-border"
          >
            {/* Gradient accent strip */}
            <div className={`absolute inset-x-0 top-0 h-0.5 bg-linear-to-r ${m.accent.replace("/20", "").replace("/5", "/0")}`}
              style={{ background: `linear-gradient(to right, ${m.accent.includes("violet") ? "oklch(0.6 0.25 280)" : m.accent.includes("indigo") ? "oklch(0.58 0.22 264)" : m.accent.includes("sky") ? "oklch(0.6 0.2 220)" : "oklch(0.58 0.17 148)"}, transparent)` }}
            />
            <div className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{m.desc}</p>
                  <p className="mt-0.5 text-[11px] font-semibold text-foreground/60">{m.label}</p>
                </div>
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${m.iconBg}`}>
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-3">
                <p className="text-2xl font-bold tracking-tight text-foreground tabular-nums">{m.value}</p>
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${trendBg} ${trendColor}`}>
                  <TrendIcon className="h-2.5 w-2.5" />
                  {m.change}
                </span>
                <span className="text-[11px] text-muted-foreground">vs last month</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

