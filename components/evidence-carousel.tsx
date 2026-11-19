"use client";

import { useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { Camera, MapPin, Pause, Play } from "lucide-react";
import { photoTypeLabel } from "@/lib/photo-label";

// Cinta de las últimas evidencias del panel: las fotos pasan solas de derecha a izquierda, sin
// cortes (la lista va dos veces y la animación mueve exactamente una vuelta). Se frena con el
// mouse encima o con foco, tiene botón de pausa (WCAG 2.2.2) y, si el sistema pide reducir el
// movimiento, queda quieta y se recorre deslizando.

export interface CarouselPhoto {
  id: string;
  image_url: string;
  photo_type: string;
  created_at: string;
  uploaded_at?: string | null;
  spaceId: string;
  spaceName: string;
  neighborhood?: string | null;
}

const MAX_PHOTOS = 12;
const SECONDS_PER_PHOTO = 4;

const dayFormat = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", timeZone: "UTC" });
function when(value: string) {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  if (days <= 0) return "Hoy";
  if (days === 1) return "Ayer";
  if (days < 7) return `Hace ${days} días`;
  return dayFormat.format(new Date(value));
}

function subscribeReducedMotion(callback: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function EvidenceCard({ photo, copy, onOpenSpace }: { photo: CarouselPhoto; copy: boolean; onOpenSpace: (spaceId: string) => void }) {
  // Un nombre "S/N" no dice nada: en ese caso se muestra el barrio como título.
  const unnamed = /^s\/?n$/i.test(photo.spaceName.trim());
  const title = unnamed && photo.neighborhood ? photo.neighborhood : photo.spaceName;
  return <button type="button" className="evidence-card-slide" onClick={() => onOpenSpace(photo.spaceId)} tabIndex={copy ? -1 : undefined} aria-hidden={copy || undefined}
    aria-label={copy ? undefined : `${title}, ${photoTypeLabel(photo.photo_type)}, ${when(photo.created_at)}. Abrir la ficha del espacio.`}>
    <Image src={photo.image_url} alt="" width={300} height={196} sizes="300px" unoptimized={photo.image_url.startsWith("blob:")} />
    <span className="evidence-card-tag">{photoTypeLabel(photo.photo_type)}</span>
    <span className="evidence-card-caption">
      <strong>{title}</strong>
      <small>{!unnamed && photo.neighborhood ? <><MapPin size={11} aria-hidden="true" />{photo.neighborhood} · </> : null}{when(photo.created_at)}</small>
    </span>
  </button>;
}

export function EvidenceCarousel({ photos, onOpenSpace }: { photos: CarouselPhoto[]; onOpenSpace: (spaceId: string) => void }) {
  const items = photos.slice(0, MAX_PHOTOS);
  const [paused, setPaused] = useState(false);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
  // Con pocas fotos no se llena la cinta: no se anima.
  const moving = !reducedMotion && items.length >= 4;

  return <section className="evidence-showcase" id="ultimas-evidencias" aria-labelledby="evidence-showcase-title">
    <div className="evidence-showcase-head">
      <h2 className="section-heading" id="evidence-showcase-title">Últimas evidencias</h2>
      {moving && <button type="button" className="evidence-showcase-play" onClick={() => setPaused((value) => !value)} aria-label={paused ? "Reanudar las fotos" : "Pausar las fotos"} title={paused ? "Reanudar" : "Pausar"}>
        {paused ? <Play size={14} /> : <Pause size={14} />}
      </button>}
    </div>
    {items.length ? <div className={`evidence-marquee${moving ? " is-moving" : ""}${paused ? " is-paused" : ""}`}>
      <div className="evidence-track" style={moving ? { animationDuration: `${items.length * SECONDS_PER_PHOTO}s` } : undefined}>
        {items.map((photo) => <EvidenceCard key={photo.id} photo={photo} copy={false} onOpenSpace={onOpenSpace} />)}
        {moving && items.map((photo) => <EvidenceCard key={`copia-${photo.id}`} photo={photo} copy onOpenSpace={onOpenSpace} />)}
      </div>
    </div> : <p className="dashboard-empty evidence-empty"><Camera size={18} /> Todavía no hay fotos cargadas.</p>}
  </section>;
}
