"use client";

import { Check, ChevronLeft, ChevronRight, LoaderCircle, MapPin, X } from "lucide-react";
import type { SpaceRecord } from "@/types/domain";

type LocationEditorProps = {
  space: SpaceRecord;
  index: number;
  total: number;
  draft?: { latitude: number; longitude: number };
  busy: boolean;
  error: string;
  onPrevious: () => void;
  onNext: () => void;
  onSave: () => void;
  onClose: () => void;
};

export function LocationEditor({ space, index, total, draft, busy, error, onPrevious, onNext, onSave, onClose }: LocationEditorProps) {
  return (
    <aside className="location-editor" aria-label="Georreferenciacion manual">
      <div className="location-editor-head">
        <div>
          <span>Georreferenciacion manual</span>
          <strong>{index + 1} de {total} pendientes</strong>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
      </div>

      <div className="location-editor-body">
        <div className="location-space">
          <MapPin size={18} />
          <div>
            <small>{space.source_type || space.type}</small>
            <h2>{space.name}</h2>
            <p>{space.address}</p>
            <span>{space.neighborhood || "Barrio sin informar"} · Seccion {space.section_code || "-"}</span>
          </div>
        </div>

        <div className={`pick-instruction ${draft ? "ready" : ""}`}>
          {draft ? <Check size={18} /> : <MapPin size={18} />}
          <div>
            <strong>{draft ? "Punto seleccionado" : "Toca el mapa para marcar el punto"}</strong>
            <span>{draft ? `${draft.latitude.toFixed(6)}, ${draft.longitude.toFixed(6)}` : "Ubica el centro aproximado del espacio. Podes ajustar tocando otro punto."}</span>
          </div>
        </div>

        {error && <p className="location-error">{error}</p>}

        <div className="location-editor-actions">
          <button className="save-location" disabled={!draft || busy} onClick={onSave}>
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
    </aside>
  );
}
