"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Trophy, ArrowRight, Building2 } from "lucide-react";

const planColors: Record<string, string> = {
  free:       "bg-slate-500/10 text-slate-600 dark:text-slate-400",
  pro:        "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  enterprise: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

export function LeaguesList() {
  const [leagues, setLeagues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/leagues")
      .then((r) => r.json())
      .then((d) => setLeagues(d.leagues?.slice(0, 5) || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 px-5 py-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Active Leagues</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Recently created tenants</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <Trophy className="h-4 w-4" />
          </div>
          <Link
            href="/leagues"
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      <div className="px-5 py-4">
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="space-y-1.5">
                  <div className="h-3 w-32 rounded-full bg-muted animate-pulse" />
                  <div className="h-2.5 w-20 rounded-full bg-muted animate-pulse" />
                </div>
                <div className="h-5 w-14 rounded-full bg-muted animate-pulse" />
              </div>
            ))}
          </div>
        ) : leagues.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <Building2 className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No leagues yet</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {leagues.map((league) => (
              <div
                key={league.id}
                className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5 transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{league.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{league.slug}</p>
                </div>
                <div className="ml-3 flex items-center gap-2 shrink-0">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${planColors[league.plan] ?? planColors.free}`}>
                    {league.plan}
                  </span>
                  <span className={`h-1.5 w-1.5 rounded-full ${league.is_active ? "bg-emerald-500" : "bg-red-500"}`} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

