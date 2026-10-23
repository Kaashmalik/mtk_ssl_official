"use client";

import { useEffect } from "react";
import type { BrandPresentation } from "@/lib/brand-presentation";

/** Colors/fonts are server-rendered on the body; titles and the tenant icon
 * are now SERVER-rendered via the root generateMetadata (Batch 115 white
 * label). This owns only the favicon swap for tenants whose icon asset lives
 * outside the metadata-icons path — and deliberately no longer clobbers
 * document.title: that erased per-page titles (match centres, leaderboards)
 * on branded tenants and was invisible to crawlers. */
export function TenantBrandingProvider({ branding }: { branding: BrandPresentation | null }) {
  useEffect(() => {
    const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]') );
    const originals = links.map(link => ({ link, href: link.getAttribute("href") }));
    let added: HTMLLinkElement | undefined;
    if (branding?.faviconUrl) {
      if (links.length) links.forEach(link => { link.href = branding.faviconUrl!; });
      else { added = document.createElement("link"); added.rel = "icon"; added.href = branding.faviconUrl; document.head.appendChild(added); }
    }
    return () => {
      for (const { link, href } of originals) {
        if (href === null) link.removeAttribute("href"); else link.setAttribute("href", href);
      }
      added?.remove();
    };
  }, [branding]);
  return null;
}

/** Legacy helper only; this provider does NOT treat regex filtering as a CSS sandbox. */
export function sanitizeCss(css: string): string {
  if (!css) return "";
  return css.replace(/expression\s*\(.*?\)/gi, "")
    .replace(/behavior\s*:/gi, "").replace(/-moz-binding/gi, "")
    .replace(/@import\s+/gi, "").replace(/javascript\s*:/gi, "")
    .replace(/url\s*\(\s*['"]?javascript:.*?\)/gi, "")
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
}
