"use client";

import { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  LoaderCircle,
  LocateFixed,
  MapPin,
  Search,
  X,
} from "lucide-react";
import type { GeoPoint, SpaceRecord } from "@/types/domain";
import { DraftPointsList } from "./relocation-editor";

type LocationEditorProps = {
  space: SpaceRecord;
  index: number;
  total: number;
  pendingSpaces: SpaceRecord[];
  suggestions: SpaceRecord[];
  points: GeoPoint[];
  isLinear: boolean;
  busy: boolean;
  error: string;
  geoBusy: boolean;
  geoError: string;
  warning: string;
  onPrevious: () => void;
  onNext: () => void;
  onSelectSpace: (space: SpaceRecord) => void;
  onAddGpsPoint: () => void;
  onRemovePoint: (index: number) => void;
  onUseMyLocation: () => void;
  onSave: () => void;
  onClose: () => void;
};

function normalizeSearch(value: string) {
  return value
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function LocationEditor({
  space,
  index,
  total,
  pendingSpaces,
  suggestions,
  points,
  isLinear,
  busy,
  error,
  geoBusy,
  geoError,
  warning,
  onPrevious,
  onNext,
  onSelectSpace,
  onAddGpsPoint,
  onRemovePoint,
  onUseMyLocation,
  onSave,
  onClose,
}: LocationEditorProps) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const term = normalizeSearch(search);
  const nearbySuggestions = suggestions.filter((item) => item.id !== space.id);
  const draft = points[points.length - 1];
  const ready = isLinear ? points.length >= 2 : points.length >= 1;
  const results = term
    ? pendingSpaces
        .filter((item) => normalizeSearch([item.name, item.address, item.neighborhood, item.source_type].filter(Boolean).join(" ")).includes(term))
        .slice(0, 6)
    : [];

  return (
    <aside className="location-editor" aria-label="Georreferenciacion manual">
      <div className="location-editor-head">
        <div>
          <span>Georreferenciacion manual</span>
          <strong>{collapsed ? space.name : `${index + 1} de ${total} pendientes`}</strong>
        </div>
        <div className="location-editor-head-actions">
          <button className="icon-button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "Expandir editor" : "Minimizar editor"}>
            {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          <button className="icon-button" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
      </div>

      {collapsed ? (
        <div className="location-editor-mini">
          <span>{isLinear ? `${points.length} de 3 puntos marcados` : draft ? `${draft.latitude.toFixed(5)}, ${draft.longitude.toFixed(5)}` : "Toca el mapa para marcar el punto"}</span>
          <button disabled={!points.length || busy} onClick={onSave}>
            {busy ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}
            Guardar
          </button>
        </div>
      ) : (
        <div className="location-editor-body">
          <div className="location-picker-search">
            <Search size={15} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar otro espacio pendiente..." />
            {search && (
              <button onClick={() => setSearch("")} aria-label="Limpiar busqueda">
                <X size={13} />
              </button>
            )}
            {term && (
              <div className="location-picker-results">
                {results.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      onSelectSpace(item);
                      setSearch("");
                    }}
                  >
                    <span>{item.name}</span>
                    <small>{item.address || item.neighborhood || item.source_type || "Sin referencia"}</small>
                  </button>
                ))}
                {!results.length && <p>No hay pendientes que coincidan.</p>}
              </div>
            )}
          </div>

          {!term && nearbySuggestions.length > 0 && (
            <div className="location-suggestions">
              <small>Pendientes cerca de tu ubicacion</small>
              {nearbySuggestions.map((item) => (
                <button key={item.id} onClick={() => onSelectSpace(item)}>
                  <span>{item.name}</span>
                  <small>{item.neighborhood || item.address || "Sin referencia"}</small>
                </button>
              ))}
            </div>
          )}

          <div className="location-space">
            <MapPin size={18} />
            <div>
              <small>{space.source_type || space.type}</small>
              <h2>{space.name}</h2>
              <p>{space.address}</p>
              <span>{space.neighborhood || "Barrio sin informar"} · Seccion {space.section_code || "-"}</span>
            </div>
          </div>

          <div className={`pick-instruction ${ready ? "ready" : ""}`}>
            {ready ? <Check size={18} /> : <MapPin size={18} />}
            <div>
              <strong>{isLinear ? `${points.length} de 3 puntos marcados` : draft ? "Punto seleccionado" : "Marca el punto en el mapa"}</strong>
              <span>{isLinear ? "Marca inicio y fin del tramo (y un punto medio si hace curva). Toca el mapa o agrega tu ubicacion GPS." : draft ? `${draft.latitude.toFixed(6)}, ${draft.longitude.toFixed(6)}` : "Toca el mapa o usa tu ubicacion actual. Podes ajustar tocando otro punto."}</span>
            </div>
          </div>

          {isLinear && <DraftPointsList points={points} onRemovePoint={onRemovePoint} />}

          <button className="use-my-location" disabled={geoBusy} onClick={isLinear ? onAddGpsPoint : onUseMyLocation}>
            {geoBusy ? <LoaderCircle className="spin" size={18} /> : <LocateFixed size={18} />}
            {isLinear ? "Agregar punto con mi ubicacion" : "Usar mi ubicacion actual"}
          </button>
          {geoBusy && <p className="location-hint">Si el navegador pregunta por tu ubicacion, elegi Permitir.</p>}
          {geoError && <p className="location-error">{geoError}</p>}
          {isLinear && points.length === 1 && <p className="location-warning">Con un solo punto queda como marcador. Agrega el punto final para dibujar el tramo.</p>}
          {warning && <p className="location-warning">{warning}</p>}
          {error && <p className="location-error">{error}</p>}

          <div className="location-editor-actions">
            <button className="save-location" disabled={!points.length || busy} onClick={onSave}>
              {busy ? <LoaderCircle className="spin" size={18} /> : <Check size={18} />}
              Guardar ubicacion
            </button>
            <div className="location-navigation">
              <button onClick={onPrevious}>
                <ChevronLeft size={17} />
                Anterior
              </button>
              <button onClick={onNext}>
                Siguiente
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
