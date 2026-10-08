import type { Metadata } from "next";
import { AdminLayout } from "@/components/layout/admin-layout";
import { SubscriptionLifecycle } from "@/components/subscriptions/subscription-lifecycle";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Subscriptions",
  description: "Monitor subscription countdowns, extend periods, and override plan tiers across all leagues.",
  path: "/subscriptions",
});

export default function SubscriptionsPage() {
  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Subscriptions</h1>
          <p className="text-muted-foreground mt-2">
            Time remaining for every league, with grace-period and plan override controls.
          </p>
        </div>
        <SubscriptionLifecycle />
      </div>
    </AdminLayout>
  );
}

export const dynamic = "force-dynamic";