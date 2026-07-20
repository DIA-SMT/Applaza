"use client";

import { Check, Crosshair, LoaderCircle, LocateFixed, MapPin, X } from "lucide-react";
import type { SpaceRecord } from "@/types/domain";

export function RelocationEditor({ space, draft, busy, error, geoBusy, geoError, warning, onUseMyLocation, onSave, onClose }: { space: SpaceRecord; draft?: { latitude: number; longitude: number }; busy: boolean; error: string; geoBusy: boolean; geoError: string; warning: string; onUseMyLocation: () => void; onSave: () => void; onClose: () => void }) {
  return <aside className="location-editor relocation-editor">
    <div className="location-editor-head"><div><span>CORRECCIÓN TERRITORIAL</span><strong>Reubicar espacio</strong></div><button className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={18} /></button></div>
    <div className="location-editor-body">
      <div className="location-space"><MapPin /><div><small>{space.source_type || space.type}</small><h2>{space.name}</h2><p>{space.address}</p><span>{space.neighborhood || "Barrio sin informar"}</span></div></div>
      <div className="coordinate-comparison"><div><small>Ubicación actual</small><strong>{space.latitude != null && space.longitude != null ? `${space.latitude.toFixed(6)}, ${space.longitude.toFixed(6)}` : "Sin coordenadas"}</strong></div><Crosshair size={17} /><div><small>Nueva ubicación</small><strong>{draft ? `${draft.latitude.toFixed(6)}, ${draft.longitude.toFixed(6)}` : "Seleccioná un punto"}</strong></div></div>
      <div className={`pick-instruction ${draft ? "ready" : ""}`}>{draft ? <Check /> : <Crosshair />}<div><strong>{draft ? "Nuevo punto seleccionado" : "Hacé clic en el mapa"}</strong><span>{draft ? "Revisá visualmente el punto antes de confirmar." : "Elegí el centro real del espacio según la dirección."}</span></div></div>
      <button className="use-my-location" disabled={geoBusy} onClick={onUseMyLocation}>{geoBusy ? <LoaderCircle className="spin" /> : <LocateFixed />}Usar mi ubicación actual</button>
      {geoError && <p className="location-error">{geoError}</p>}
      {warning && <p className="location-warning">{warning}</p>}
      {error && <p className="location-error">{error}</p>}
      <button className="save-location" disabled={!draft || busy} onClick={onSave}>{busy ? <LoaderCircle className="spin" /> : <Check />}Confirmar nueva ubicación</button>
      <button className="relocation-cancel" onClick={onClose}>Cancelar sin cambios</button>
    </div>
  </aside>;
}
