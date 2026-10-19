"use client";

import { useEffect } from "react";
import type { BrandPresentation } from "@/lib/brand-presentation";

/** Colors/fonts are server-rendered on the body. This owns only reversible browser metadata. */
export function TenantBrandingProvider({ branding }: { branding: BrandPresentation | null }) {
  useEffect(() => {
    const originalTitle = document.title;
    const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'));
    const originals = links.map(link => ({ link, href: link.getAttribute("href") }));
    let added: HTMLLinkElement | undefined;
    if (branding?.appName) document.title = branding.appName;
    if (branding?.faviconUrl) {
      if (links.length) links.forEach(link => { link.href = branding.faviconUrl!; });
      else { added = document.createElement("link"); added.rel = "icon"; added.href = branding.faviconUrl; document.head.appendChild(added); }
    }
    return () => {
      document.title = originalTitle;
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
