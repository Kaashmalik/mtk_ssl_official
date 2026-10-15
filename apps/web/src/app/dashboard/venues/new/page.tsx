import React from "react"
import { unstable_noStore as noStore } from "next/cache"
import { requireVenueReadContext } from "@/lib/venue-reads"
import { VenueForm } from "@/components/venues/venue-form"

export default async function NewVenuePage() {
  noStore()
  await requireVenueReadContext("venue:manage")
  return <VenueForm />
}
