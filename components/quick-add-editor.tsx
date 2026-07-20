"use client";
import { useState } from "react";
import { Check, Link2, LoaderCircle, X } from "lucide-react";
import type { SpaceRecord, SpaceType } from "@/types/domain";

function fixMojibake(value: string) { try { const repaired = decodeURIComponent(escape(value)); return repaired.includes("�") ? value : repaired; } catch { return value; } }
function normalizeSearch(value: string) { return fixMojibake(value).toLocaleLowerCase("es").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim(); }

export function QuickAddEditor({ location, pendingSpaces, busy, error, onSave, onLink, onClose }: { location: { latitude: number; longitude: number }; pendingSpaces: SpaceRecord[]; busy: boolean; error: string; onSave: (input: { name: string; type: SpaceType; address: string; neighborhood: string }) => void; onLink: (space: SpaceRecord) => void; onClose: () => void }) {
  const [name, setName] = useState(""); const [type, setType] = useState<SpaceType>("espacio_verde"); const [address, setAddress] = useState(""); const [neighborhood, setNeighborhood] = useState("");
  const term = normalizeSearch(name);
  const matches = term.length >= 3 ? pendingSpaces.filter((item) => { const searchable = normalizeSearch([item.name, item.address, item.neighborhood].filter(Boolean).join(" ")); const itemName = normalizeSearch(item.name); return searchable.includes(term) || (itemName.length >= 3 && term.includes(itemName)); }).slice(0, 4) : [];
  return <aside className="location-editor quick-add-editor">
    <div className="location-editor-head"><div><span>ALTA RÁPIDA EN CAMPO</span><strong>Nuevo espacio en tu ubicación</strong></div><button className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={18} /></button></div>
    <div className="location-editor-body">
      <div className="pick-instruction ready"><Check /><div><strong>Ubicación tomada del GPS</strong><span>{location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}</span></div></div>
      <label className="quick-add-field">Nombre del espacio<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej.: Plaza Belgrano" autoFocus /></label>
      {matches.length > 0 && <div className="location-suggestions quick-add-matches"><small><Link2 size={11} /> Ya está en el padrón: tocá para asignarle esta ubicación</small>{matches.map((item) => <button key={item.id} onClick={() => onLink(item)} disabled={busy}><span>{fixMojibake(item.name)}</span><small>{fixMojibake([item.source_type || item.type, item.address || item.neighborhood].filter(Boolean).join(" · ")) || "Sin referencia"}</small></button>)}</div>}
      <label className="quick-add-field">Tipo<select value={type} onChange={(event) => setType(event.target.value as SpaceType)}><option value="plaza">Plaza / Parque</option><option value="espacio_verde">Espacio verde</option><option value="platabanda">Platabanda</option></select></label>
      <label className="quick-add-field">Dirección (opcional)<input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Calle y altura" /></label>
      <label className="quick-add-field">Barrio (opcional)<input value={neighborhood} onChange={(event) => setNeighborhood(event.target.value)} placeholder="Barrio o zona" /></label>
      {error && <p className="location-error">{error}</p>}
      <button className="save-location" disabled={!name.trim() || busy} onClick={() => onSave({ name: name.trim(), type, address: address.trim(), neighborhood: neighborhood.trim() })}>{busy ? <LoaderCircle className="spin" /> : <Check />}Guardar espacio nuevo</button>
    </div>
  </aside>;
}
