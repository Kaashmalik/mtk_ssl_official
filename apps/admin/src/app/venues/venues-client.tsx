"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { toast } from "sonner";
import {
  Card, CardContent, CardHeader, CardTitle,
  Button, Badge,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  Skeleton,
} from "@mtk/ui";

interface Venue {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  country: string;
  capacity: number;
  ground_type: string;
  is_active: boolean;
  tenants: { name: string };
}

export function VenuesClient() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/venues")
      .then((r) => r.json())
      .then((d) => setVenues(d.venues || []))
      .catch(() => toast.error("Failed to load venues"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Card><CardContent className="p-6 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Venues</h1>
          <p className="text-muted-foreground mt-2">Manage cricket venues and grounds.</p>
        </div>
        <Link href="/venues/new"><Button>Add Venue</Button></Link>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="w-5 h-5" />All Venues ({venues.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Venue</TableHead><TableHead>Tenant</TableHead>
                <TableHead>Location</TableHead><TableHead>Capacity</TableHead>
                <TableHead>Ground Type</TableHead><TableHead>Status</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {venues.map((venue) => (
                <TableRow key={venue.id}>
                  <TableCell>
                    <div className="font-medium">{venue.name}</div>
                    {venue.address && <div className="text-xs text-muted-foreground">{venue.address}</div>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{venue.tenants?.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {[venue.city, venue.state, venue.country].filter(Boolean).join(", ") || "-"}
                  </TableCell>
                  <TableCell>{venue.capacity ? venue.capacity.toLocaleString() : "-"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">{venue.ground_type || "-"}</Badge>
                  </TableCell>
                  <TableCell>
                    {venue.is_active
                      ? <Badge className="bg-green-500">Active</Badge>
                      : <Badge variant="secondary">Inactive</Badge>}
                  </TableCell>
                  <TableCell>
                    <Link href={`/venues/${venue.id}`}><Button variant="ghost" size="sm">View</Button></Link>
                  </TableCell>
                </TableRow>
              ))}
              {venues.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No venues found. Add your first venue to get started.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
