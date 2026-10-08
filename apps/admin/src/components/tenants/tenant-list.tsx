"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Eye, Edit2, Trash2, Building2, Trophy, Users2 } from "lucide-react";
import { toast } from "sonner";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: "free" | "pro" | "enterprise";
  is_active: boolean;
  created_at: string;
  tournaments: { count: number }[];
  teams: { count: number }[];
  users: { count: number }[];
}

const PLAN_STYLES: Record<string, string> = {
  free:       "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  pro:        "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  enterprise: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

function TenantAvatar({ name }: { name: string }) {
  const initials = name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
      {initials}
    </div>
  );
}

export function TenantList() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => { fetchTenants(); }, []);

  async function fetchTenants() {
    try {
      const res = await fetch("/api/tenants");
      const data = await res.json();
      setTenants(data.tenants || []);
    } catch {
      toast.error("Failed to load tenants");
    } finally {
      setLoading(false);
    }
  }

  async function deleteTenant(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/tenants/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Tenant deleted");
        fetchTenants();
      } else {
        toast.error("Failed to delete tenant");
      }
    } catch {
      toast.error("Failed to delete tenant");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 px-6 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Tenants
            {!loading && (
              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {tenants.length}
              </span>
            )}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Manage all platform tenants</p>
        </div>
        <Link
          href="/tenants/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-95"
        >
          <Plus className="h-3.5 w-3.5" />
          New Tenant
        </Link>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/40 bg-muted/30">
              {["Tenant", "Plan", "Status", "Tournaments", "Teams", "Created", ""].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {[1, 2, 3, 4, 5, 6, 7].map((c) => (
                    <td key={c} className="px-4 py-3.5">
                      <div className="h-3 rounded-full bg-muted animate-pulse" style={{ width: `${60 + (c * 13) % 40}%` }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : tenants.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <Building2 className="h-10 w-10 text-muted-foreground/30" />
                    <p className="text-sm font-medium text-muted-foreground">No tenants yet</p>
                    <Link
                      href="/tenants/new"
                      className="text-xs text-primary hover:underline"
                    >
                      Create your first tenant
                    </Link>
                  </div>
                </td>
              </tr>
            ) : (
              tenants.map((t) => (
                <tr key={t.id} className="group transition-colors hover:bg-muted/20">
                  {/* Name */}
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <TenantAvatar name={t.name} />
                      <div>
                        <p className="font-medium text-foreground leading-none">{t.name}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground font-mono">{t.slug}</p>
                      </div>
                    </div>
                  </td>
                  {/* Plan */}
                  <td className="px-4 py-3.5">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${PLAN_STYLES[t.plan] ?? PLAN_STYLES.free}`}>
                      {t.plan}
                    </span>
                  </td>
                  {/* Status */}
                  <td className="px-4 py-3.5">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${t.is_active ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${t.is_active ? "bg-emerald-500" : "bg-red-500"}`} />
                      {t.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  {/* Tournaments */}
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Trophy className="h-3 w-3" />
                      <span>{t.tournaments?.[0]?.count ?? 0}</span>
                    </div>
                  </td>
                  {/* Teams */}
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Users2 className="h-3 w-3" />
                      <span>{t.teams?.[0]?.count ?? 0}</span>
                    </div>
                  </td>
                  {/* Created */}
                  <td className="px-4 py-3.5 text-xs text-muted-foreground tabular-nums">
                    {new Date(t.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                  </td>
                  {/* Actions */}
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Link
                        href={`/tenants/${t.id}`}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        title="View"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Link>
                      <Link
                        href={`/tenants/${t.id}/edit`}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        title="Edit"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Link>
                      <button
                        onClick={() => deleteTenant(t.id, t.name)}
                        disabled={deleting === t.id}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 disabled:opacity-40"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
