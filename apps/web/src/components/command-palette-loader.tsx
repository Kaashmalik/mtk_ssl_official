"use client";

import { lazy, Suspense, useEffect, useState } from "react";

const CommandPalette = lazy(() =>
  import("@mtk/ui/components/ui/command-palette").then((mod) => ({
    default: mod.CommandPalette,
  }))
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
