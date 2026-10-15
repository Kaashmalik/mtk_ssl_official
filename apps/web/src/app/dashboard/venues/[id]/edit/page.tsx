import React from "react"
import { notFound } from "next/navigation"
import { unstable_noStore as noStore } from "next/cache"
import { requireVenueReadContext, readVenue } from "@/lib/venue-reads"
import { VenueForm } from "@/components/venues/venue-form"

export default async function EditVenuePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  noStore()
  const context = await requireVenueReadContext("venue:manage")
  const { id } = await params
  const venue = await readVenue(context.tenantId, id)
  if (!venue) notFound()

  return <VenueForm venue={{
    id: venue.id,
    name: venue.name,
    address: venue.address,
    city: venue.city,
    state: venue.state,
    country: venue.country,
    capacity: venue.capacity,
    groundType: venue.groundType,
  }} />
}
