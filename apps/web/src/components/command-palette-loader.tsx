"use client";

import { lazy, Suspense, useEffect, useState } from "react";

const CommandPalette = lazy(() =>
  // Batch 147: a failed palette chunk degrades to null — the palette is
  // decorative and mounted in the ROOT layout, so a chunk failure must not
  // propagate to app/error.tsx and replace the page on EVERY route.
  import("@mtk/ui/components/ui/command-palette")
    .then((mod) => ({ default: mod.CommandPalette }))
    .catch(() => ({ default: () => null }))
);

export function CommandPaletteLoader() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <Suspense fallback={null}>
      <CommandPalette />
    </Suspense>
  );
}
