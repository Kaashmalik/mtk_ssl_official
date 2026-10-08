"use client";

import { useEffect } from "react";

interface WorkboxEvent {
  type: string;
}

interface Workbox {
  addEventListener: (event: string, handler: (event: WorkboxEvent) => void) => void;
  register: () => void;
}

declare global {
  interface Window {
    workbox?: Workbox;
  }
}

export function PWARegister() {
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      window.workbox !== undefined
    ) {
      const wb = window.workbox;
      // Add event listeners to handle PWA lifecycle
      wb.addEventListener("installed", (event: WorkboxEvent) => {
        console.log(`Event ${event.type} is triggered.`);
      });

      wb.addEventListener("controlling", (event: WorkboxEvent) => {
        console.log(`Event ${event.type} is triggered.`);
      });

      wb.addEventListener("activated", (event: WorkboxEvent) => {
        console.log(`Event ${event.type} is triggered.`);
      });

      wb.register();
    }
  }, []);

  return null;
}
