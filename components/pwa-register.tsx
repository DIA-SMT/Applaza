"use client";

import { useEffect } from "react";

function apiQuery() {
  try {
    const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
    return `?api=${encodeURIComponent(origin)}`;
  } catch {
    return "";
  }
}

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

    // El service worker recibe el dominio de la API de Supabase (Cloud o propio) para saber
    // qué datos y fotos guardar para usar sin conexión.
    navigator.serviceWorker.register(`/sw.js${apiQuery()}`).catch(() => { /* sin soporte o bloqueado: la app sigue funcionando online */ });
  }, []);
  return null;
}
