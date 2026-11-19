"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { Camera, ChevronLeft, ChevronRight, MapPin, Pause, Play } from "lucide-react";
import { photoTypeLabel } from "@/lib/photo-label";

// Carrusel de las últimas evidencias del panel. Pasa solo cada INTERVAL_MS, pero se detiene
// cuando la persona lo usa (mouse encima, foco, toque), cuando la pestaña no está visible y
// siempre que el sistema pida reducir el movimiento. Tiene botón de pausa (WCAG 2.2.2).

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

const INTERVAL_MS = 5000;
const MAX_PHOTOS = 12;
const SWIPE_PX = 40;

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

export function EvidenceCarousel({ photos, onOpenSpace }: { photos: CarouselPhoto[]; onOpenSpace: (spaceId: string) => void }) {
  const items = photos.slice(0, MAX_PHOTOS);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false); // pausa elegida con el botón
  const [holding, setHolding] = useState(false); // mouse encima, foco o toque
  const [hidden, setHidden] = useState(false);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
  const touchStart = useRef<number | null>(null);
  const thumbs = useRef<HTMLDivElement>(null);

  const count = items.length;
  const current = items[Math.min(index, Math.max(count - 1, 0))];
  const wrap = useCallback((value: number) => ((value % count) + count) % count, [count]);
  const goTo = useCallback((target: number) => setIndex(wrap(target)), [wrap]);
  // Relativo al valor vigente: dos toques seguidos avanzan dos fotos.
  const step = useCallback((delta: number) => setIndex((value) => wrap(value + delta)), [wrap]);
  const running = count > 1 && !paused && !holding && !hidden && !reducedMotion;

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => step(1), INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [running, index, step]);

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // La miniatura activa queda a la vista sin mover la página.
  useEffect(() => {
    const strip = thumbs.current;
    const active = strip?.children[index] as HTMLElement | undefined;
    if (strip && active) strip.scrollTo({ left: active.offsetLeft - strip.clientWidth / 2 + active.clientWidth / 2, behavior: reducedMotion ? "auto" : "smooth" });
  }, [index, reducedMotion]);

  if (!current) {
    return <section className="evidence-showcase is-empty" id="ultimas-evidencias" aria-labelledby="evidence-showcase-title">
      <h2 className="section-heading" id="evidence-showcase-title">Últimas evidencias</h2>
      <p className="dashboard-empty"><Camera size={18} /> Todavía no hay fotos cargadas.</p>
    </section>;
  }

  const next = items[(index + 1) % count];

  return <section className="evidence-showcase" id="ultimas-evidencias" aria-roledescription="carrusel" aria-labelledby="evidence-showcase-title"
    onMouseEnter={() => setHolding(true)} onMouseLeave={() => setHolding(false)}
    onFocus={() => setHolding(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setHolding(false); }}
    onKeyDown={(event) => { if (event.key === "ArrowLeft") step(-1); if (event.key === "ArrowRight") step(1); }}>
    <div className="evidence-showcase-head">
      <h2 className="section-heading" id="evidence-showcase-title">Últimas evidencias</h2>
      <span className="evidence-showcase-count">{index + 1} de {count}</span>
      {count > 1 && !reducedMotion && <button type="button" className="evidence-showcase-play" onClick={() => setPaused((value) => !value)} aria-label={paused ? "Reanudar el carrusel" : "Pausar el carrusel"}>
        {paused ? <Play size={15} /> : <Pause size={15} />}
      </button>}
    </div>

    <div className="evidence-stage"
      onTouchStart={(event) => { touchStart.current = event.touches[0].clientX; setHolding(true); }}
      onTouchEnd={(event) => {
        const start = touchStart.current;
        touchStart.current = null;
        setHolding(false);
        if (start === null) return;
        const delta = event.changedTouches[0].clientX - start;
        if (Math.abs(delta) > SWIPE_PX) step(delta < 0 ? 1 : -1);
      }}>
      <button type="button" className="evidence-slide" key={current.id} onClick={() => onOpenSpace(current.spaceId)}
        aria-roledescription="diapositiva" aria-label={`${current.spaceName}, ${photoTypeLabel(current.photo_type)}, ${when(current.created_at)}. Abrir la ficha del espacio.`}>
        <Image src={current.image_url} alt="" fill sizes="(max-width: 760px) 100vw, 1100px" priority={index === 0} unoptimized={current.image_url.startsWith("blob:")} />
        <span className="evidence-slide-caption">
          <span className="evidence-slide-tag">{photoTypeLabel(current.photo_type)}</span>
          <strong>{current.spaceName}</strong>
          <small>{current.neighborhood ? <><MapPin size={12} aria-hidden="true" />{current.neighborhood} · </> : null}{when(current.created_at)}</small>
        </span>
        <span className="evidence-slide-open" aria-hidden="true">Ver ficha <ChevronRight size={14} /></span>
      </button>
      {/* La siguiente foto se precarga para que el cambio no muestre un hueco. */}
      {next && next.id !== current.id && <Image className="evidence-preload" src={next.image_url} alt="" width={16} height={9} sizes="(max-width: 760px) 100vw, 1100px" unoptimized={next.image_url.startsWith("blob:")} aria-hidden="true" />}
      {count > 1 && <>
        <button type="button" className="evidence-nav previous" onClick={() => step(-1)} aria-label="Foto anterior"><ChevronLeft size={20} /></button>
        <button type="button" className="evidence-nav next" onClick={() => step(1)} aria-label="Foto siguiente"><ChevronRight size={20} /></button>
        {running && <span className="evidence-progress" key={`p-${index}`} style={{ animationDuration: `${INTERVAL_MS}ms` }} aria-hidden="true" />}
      </>}
    </div>

    {count > 1 && <div className="evidence-thumbs" ref={thumbs} role="tablist" aria-label="Elegir foto">
      {items.map((photo, i) => <button type="button" key={photo.id} role="tab" aria-selected={i === index} aria-label={`${photo.spaceName}, ${when(photo.created_at)}`} className={i === index ? "active" : ""} onClick={() => goTo(i)}>
        <Image src={photo.image_url} alt="" width={112} height={72} unoptimized={photo.image_url.startsWith("blob:")} />
      </button>)}
    </div>}
  </section>;
}
