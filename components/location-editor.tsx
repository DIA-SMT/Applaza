"use client";
import { useState } from "react";
import { Check, ChevronLeft, ChevronRight, LoaderCircle, LocateFixed, MapPin, Search, X } from "lucide-react";
import type { SpaceRecord } from "@/types/domain";

function normalizeSearch(value: string) { return value.toLocaleLowerCase("es").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim(); }

export function LocationEditor({ space, index, total, pendingSpaces, suggestions, draft, busy, error, geoBusy, geoError, warning, onPrevious, onNext, onSelectSpace, onUseMyLocation, onSave, onClose }: { space: SpaceRecord; index: number; total: number; pendingSpaces: SpaceRecord[]; suggestions: SpaceRecord[]; draft?: { latitude: number; longitude: number }; busy: boolean; error: string; geoBusy: boolean; geoError: string; warning: string; onPrevious: () => void; onNext: () => void; onSelectSpace: (space: SpaceRecord) => void; onUseMyLocation: () => void; onSave: () => void; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const term = normalizeSearch(search);
  const results = term ? pendingSpaces.filter((item) => normalizeSearch([item.name, item.address, item.neighborhood, item.source_type].filter(Boolean).join(" ")).includes(term)).slice(0, 6) : [];
  return <aside className="location-editor"><div className="location-editor-head"><div><span>GEOREFERENCIACIÓN MANUAL</span><strong>{index + 1} de {total} pendientes</strong></div><button className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={18} /></button></div><div className="location-editor-body">
    <div className="location-picker-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar otro espacio pendiente…" />{search && <button onClick={() => setSearch("")} aria-label="Limpiar búsqueda"><X size={13} /></button>}
      {term && <div className="location-picker-results">{results.map((item) => <button key={item.id} onClick={() => { onSelectSpace(item); setSearch(""); }}><span>{item.name}</span><small>{item.address || item.neighborhood || item.source_type || "Sin referencia"}</small></button>)}{!results.length && <p>No hay pendientes que coincidan.</p>}</div>}
    </div>
    {!term && suggestions.filter((item) => item.id !== space.id).length > 0 && <div className="location-suggestions"><small>Pendientes cerca de tu ubicación</small>{suggestions.filter((item) => item.id !== space.id).map((item) => <button key={item.id} onClick={() => onSelectSpace(item)}><span>{item.name}</span><small>{item.neighborhood || item.address || "Sin referencia"}</small></button>)}</div>}
    <div className="location-space"><MapPin /><div><small>{space.source_type || space.type}</small><h2>{space.name}</h2><p>{space.address}</p><span>{space.neighborhood || "Barrio sin informar"} · Sección {space.section_code || "—"}</span></div></div>
    <div className={`pick-instruction ${draft ? "ready" : ""}`}>{draft ? <Check /> : <MapPin />}<div><strong>{draft ? "Punto seleccionado" : "Marcá el punto en el mapa"}</strong><span>{draft ? `${draft.latitude.toFixed(6)}, ${draft.longitude.toFixed(6)}` : "Hacé clic sobre el mapa o usá tu ubicación actual."}</span></div></div>
    <button className="use-my-location" disabled={geoBusy} onClick={onUseMyLocation}>{geoBusy ? <LoaderCircle className="spin" /> : <LocateFixed />}Usar mi ubicación actual</button>
    {geoBusy && <p className="location-hint">Si el navegador pregunta por tu ubicación, elegí “Permitir”.</p>}
    {geoError && <p className="location-error">{geoError}</p>}
    {warning && <p className="location-warning">{warning}</p>}
    {error && <p className="location-error">{error}</p>}
    <button className="save-location" disabled={!draft || busy} onClick={onSave}>{busy ? <LoaderCircle className="spin" /> : <Check />}Guardar ubicación</button>
    <div className="location-navigation"><button onClick={onPrevious}><ChevronLeft />Anterior</button><button onClick={onNext}>Omitir por ahora<ChevronRight /></button></div>
  </div></aside>;
}
