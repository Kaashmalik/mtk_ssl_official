"use client";

import { CheckCircle2, AlertTriangle, XCircle, Loader2, Cpu } from "lucide-react";

interface SystemStatusProps {
  healthData?: any;
  loading?: boolean;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "healthy")
    return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "degraded")
    return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  if (status === "down")
    return <XCircle className="h-4 w-4 text-red-500" />;
  return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
}

function statusLabel(status: string) {
  if (status === "healthy")  return { text: "Healthy",  cls: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" };
  if (status === "degraded") return { text: "Degraded", cls: "text-amber-600  dark:text-amber-400  bg-amber-500/10" };
  if (status === "down")     return { text: "Down",     cls: "text-red-600    dark:text-red-400    bg-red-500/10" };
  return { text: "Unknown", cls: "text-muted-foreground bg-muted" };
}

export function SystemStatus({ healthData, loading }: SystemStatusProps) {
  const services = healthData?.services
    ? Object.entries(healthData.services).slice(0, 5)
    : [];

  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 px-5 py-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">System Health</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Live service status</p>
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
          <Cpu className="h-4 w-4" />
        </div>
      </div>

      <div className="px-5 py-4 space-y-3">
        {loading ? (
          [0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="h-3 w-24 rounded-full bg-muted animate-pulse" />
              <div className="h-5 w-16 rounded-full bg-muted animate-pulse" />
            </div>
          ))
        ) : (
          <>
            {/* Overall */}
            <div className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-2">
                <StatusIcon status={healthData?.status ?? "unknown"} />
                <span className="text-sm font-semibold text-foreground">Overall</span>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${statusLabel(healthData?.status ?? "unknown").cls}`}>
                {statusLabel(healthData?.status ?? "unknown").text}
              </span>
            </div>

            {/* Services */}
            {services.length > 0 ? (
              services.map(([name, svc]: [string, any]) => (
                <div key={name} className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <StatusIcon status={svc?.status ?? "unknown"} />
                    <span className="text-sm capitalize text-foreground">{name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {svc?.latency != null && (
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {svc.latency}ms
                      </span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${statusLabel(svc?.status ?? "unknown").cls}`}>
                      {statusLabel(svc?.status ?? "unknown").text}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground py-2 text-center">No service data</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

