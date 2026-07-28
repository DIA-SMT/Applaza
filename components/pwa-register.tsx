"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())));

      if ("caches" in window) {
        void caches.keys()
          .then((names) => Promise.all(names.filter((name) => name.startsWith("applaza-sw-")).map((name) => caches.delete(name))));
      }
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch(() => { /* sin soporte o bloqueado: la app sigue funcionando online */ });
  }, []);
  return null;
}
