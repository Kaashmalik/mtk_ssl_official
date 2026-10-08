import { siteConfig } from "@/lib/seo";

export function OrganizationJsonLd() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Malik Tech",
    url: "https://maliktech.dev",
    logo: `${siteConfig.url}/icon.svg`,
    sameAs: [],
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "technical support",
      email: "admin@maliktech.dev",
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export function WebApplicationJsonLd() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: siteConfig.fullName,
    description: siteConfig.description,
    url: siteConfig.url,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "PKR",
    },
    author: {
      "@type": "Organization",
      name: "Malik Tech",
      url: "https://maliktech.dev",
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
