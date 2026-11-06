"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

// Listas largas por tandas: en el celular se muestra una primera parte y un botón "Ver más"
// al final, en lugar de un scroll interminable. En escritorio las tandas son más grandes.

const MOBILE_QUERY = "(max-width: 760px)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** true en pantallas de celular. En el servidor se asume celular para no mostrar listas largas de entrada. */
export function useIsMobile() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(MOBILE_QUERY).matches, () => true);
}

export function useShowMore<T>(items: T[], { mobile, desktop = Infinity, resetKey }: { mobile: number; desktop?: number; resetKey?: unknown }) {
  const isMobile = useIsMobile();
  const pageSize = isMobile ? mobile : desktop;
  const [pages, setPages] = useState(1);

  // Al cambiar el filtro, la búsqueda o el tamaño de pantalla, se vuelve a la primera tanda.
  useEffect(() => { setPages(1); }, [resetKey, pageSize]);

  const limit = Number.isFinite(pageSize) ? pageSize * pages : items.length;
  const hidden = Math.max(0, items.length - limit);
  return {
    visible: hidden ? items.slice(0, limit) : items,
    hidden,
    nextCount: Math.min(hidden, Number.isFinite(pageSize) ? pageSize : hidden),
    showMore: () => setPages((current) => current + 1),
  };
}

export function ShowMoreButton({ hidden, nextCount, onClick, noun = "elementos" }: { hidden: number; nextCount: number; onClick: () => void; noun?: string }) {
  if (hidden <= 0) return null;
  return <button type="button" className="show-more-button" onClick={onClick}>
    <span>Ver más</span>
    <small>{nextCount < hidden ? `${nextCount} de ${hidden} ${noun} restantes` : `${hidden} ${noun} restantes`}</small>
    <ChevronDown size={16} aria-hidden="true" />
  </button>;
}
