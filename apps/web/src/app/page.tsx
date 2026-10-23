import React from "react";
import { HomeContent } from "@/components/home-content";
import { StructuredData } from "@/components/structured-data";
import { readRequestBrand } from "@/lib/request-brand";
import { resolveBrandName } from "@/lib/white-label-metadata";

export default async function HomePage() {
  // Batch 125: the visible hero brand is white-label too — the SAME
  // request-local brand read the head metadata uses, platform name as
  // the sanitized fallback for unconfigured hosts.
  const brand = await readRequestBrand();
  return (
    <>
      <StructuredData />
      <HomeContent brandName={resolveBrandName(brand)} />
    </>
  );
}
