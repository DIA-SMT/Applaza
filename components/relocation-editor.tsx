"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronUp, Crosshair, LoaderCircle, LocateFixed, MapPin, Trash2, X } from "lucide-react";
import type { GeoPoint, SpaceRecord } from "@/types/domain";

const pointLabels = ["Inicio", "Medio", "Fin"];

export function pointLabel(index: number, total: number) {
  if (total <= 1) return "Punto";
  if (total === 2) return index === 0 ? "Inicio" : "Fin";
  return pointLabels[index] ?? `Punto ${index + 1}`;
}

export function DraftPointsList({ points, onRemovePoint, onReorderPoint }: { points: GeoPoint[]; onRemovePoint: (index: number) => void; onReorderPoint: (index: number, direction: number) => void }) {
  if (!points.length) return null;
  return <ul className="draft-points-list">
    {points.map((point, index) => <li key={`${point.latitude}-${point.longitude}-${index}`}>
      <i>{index + 1}</i>
      <div><strong>{pointLabel(index, points.length)}</strong><span>{point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}</span></div>
      {points.length > 1 && <span className="draft-point-reorder">
        <button onClick={() => onReorderPoint(index, -1)} disabled={index === 0} aria-label={`Mover punto ${index + 1} hacia arriba`}><ArrowUp size={13} /></button>
        <button onClick={() => onReorderPoint(index, 1)} disabled={index === points.length - 1} aria-label={`Mover punto ${index + 1} hacia abajo`}><ArrowDown size={13} /></button>
      </span>}
      <button onClick={() => onRemovePoint(index)} aria-label={`Quitar punto ${index + 1}`}><Trash2 size={14} /></button>
    </li>)}
  </ul>;
}

export function RelocationEditor({ space, points, isLinear, busy, error, geoBusy, geoError, warning, onUseMyLocation, onRemovePoint, onReorderPoint, onSave, onClose }: { space: SpaceRecord; points: GeoPoint[]; isLinear: boolean; busy: boolean; error: string; geoBusy: boolean; geoError: string; warning: string; onUseMyLocation: () => void; onRemovePoint: (index: number) => void; onReorderPoint: (index: number, direction: number) => void; onSave: () => void; onClose: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const draft = points[points.length - 1];
  const ready = isLinear ? points.length >= 2 : points.length >= 1;
  return <aside className="location-editor relocation-editor">
    <div className="location-editor-head"><div><span>CORRECCIÓN TERRITORIAL</span><strong>{collapsed ? space.name : isLinear ? "Retrazar platabanda" : "Reubicar espacio"}</strong></div><div className="location-editor-head-actions"><button className="icon-button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "Expandir editor" : "Minimizar editor"}>{collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button><button className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={18} /></button></div></div>
    {collapsed ? <div className="location-editor-mini"><span>{isLinear ? `${points.length} de 3 puntos marcados` : draft ? `${draft.latitude.toFixed(5)}, ${draft.longitude.toFixed(5)}` : "Tocá el mapa para marcar el punto"}</span><button disabled={!points.length || busy} onClick={onSave}>{busy ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}Guardar</button></div> : <div className="location-editor-body">
      <div className="location-space"><MapPin /><div><small>{space.source_type || space.type}</small><h2>{space.name}</h2><p>{space.address}</p><span>{space.neighborhood || "Barrio sin informar"}</span></div></div>
      {!isLinear && <div className="coordinate-comparison"><div><small>Ubicación actual</small><strong>{space.latitude != null && space.longitude != null ? `${space.latitude.toFixed(6)}, ${space.longitude.toFixed(6)}` : "Sin coordenadas"}</strong></div><Crosshair size={17} /><div><small>Nueva ubicación</small><strong>{draft ? `${draft.latitude.toFixed(6)}, ${draft.longitude.toFixed(6)}` : "Seleccioná un punto"}</strong></div></div>}
      <div className={`pick-instruction ${ready ? "ready" : ""}`}>{ready ? <Check /> : <Crosshair />}<div><strong>{isLinear ? `${points.length} de 3 puntos marcados` : draft ? "Nuevo punto seleccionado" : "Hacé clic en el mapa"}</strong><span>{isLinear ? "Marcá inicio y fin del tramo (y un punto medio si hace curva). Tocá el mapa o usá tu ubicación." : draft ? "Revisá visualmente el punto antes de confirmar." : "Elegí el centro real del espacio según la dirección."}</span></div></div>
      {isLinear && <DraftPointsList points={points} onRemovePoint={onRemovePoint} onReorderPoint={onReorderPoint} />}
      <button className="use-my-location" disabled={geoBusy} onClick={onUseMyLocation}>{geoBusy ? <LoaderCircle className="spin" /> : <LocateFixed />}{isLinear ? "Agregar punto con mi ubicación" : "Usar mi ubicación actual"}</button>
      {geoBusy && <p className="location-hint">Si el navegador pregunta por tu ubicación, elegí “Permitir”.</p>}
      {geoError && <p className="location-error">{geoError}</p>}
      {isLinear && points.length === 1 && <p className="location-warning">Con un solo punto queda como marcador. Agregá el punto final para dibujar el tramo.</p>}
      {warning && <p className="location-warning">{warning}</p>}
      {error && <p className="location-error">{error}</p>}
      <button className="save-location" disabled={!points.length || busy} onClick={onSave}>{busy ? <LoaderCircle className="spin" /> : <Check />}Confirmar nueva ubicación</button>
      <button className="relocation-cancel" onClick={onClose}>Cancelar sin cambios</button>
    </div>}
  </aside>;
}
