import type { Metadata } from "next";
import { AdminLayout } from "@/components/layout/admin-layout";
import { NewVenueForm } from "./new-venue-form";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "New Venue",
  description: "Add a new cricket venue with location, capacity, and ground type details.",
  path: "/venues/new",
});

export default function NewVenuePage() {
  return <AdminLayout><NewVenueForm /></AdminLayout>;
}
