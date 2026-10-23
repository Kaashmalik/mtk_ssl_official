import { HomeContent } from "@/components/home-content";
import { StructuredData } from "@/components/structured-data";

export default async function HomePage() {
  return (
    <>
      <StructuredData />
      <HomeContent />
    </>
  );
}

