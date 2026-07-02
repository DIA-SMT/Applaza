"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Check, ChevronDown, Crosshair, Filter, Layers3, MapPin, RotateCcw, Search, SlidersHorizontal, Trees, X } from "lucide-react";
import type { MaintenancePhoto, MaintenanceStatus, Provider, SpaceRecord, UserProfile } from "@/types/domain";
import { statusColors, statusLabels } from "./status-badge";
import { SpaceDetail } from "./space-detail";
import { LocationEditor } from "./location-editor";
import { RelocationEditor } from "./relocation-editor";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const SpaceMap = dynamic(() => import("./space-map"), { ssr: false, loading: () => <div className="gis-map-loading"><i /><span>Cargando cartografía…</span></div> });

const layerDefinitions = [
  { id: "plaza", label: "Plazas / Parques", group: "Espacios", color: "#0166ff" },
  { id: "espacio_verde", label: "Espacios verdes", group: "Espacios", color: "#16a34a" },
  { id: "platabanda", label: "Platabandas", group: "Espacios", color: "#94a3b8" },
  { id: "en_curso", label: "Mantenimientos en curso", group: "Operación", color: statusColors.en_curso },
  { id: "finalizado", label: "Mantenimientos finalizados", group: "Operación", color: statusColors.finalizado },
  { id: "vencido", label: "Mantenimientos vencidos", group: "Operación", color: statusColors.vencido },
  { id: "observado", label: "Mantenimientos observados", group: "Operación", color: statusColors.observado },
] as const;

export function OperationalMap({ spaces, providers, currentUser, dataError, setSpaces }: { spaces: SpaceRecord[]; providers: Provider[]; currentUser: UserProfile; dataError: string | null; setSpaces: Dispatch<SetStateAction<SpaceRecord[]>> }) {
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState(""); const [providerId, setProviderId] = useState("all"); const [status, setStatus] = useState("all"); const [type, setType] = useState("all"); const [neighborhood, setNeighborhood] = useState("all"); const [locationFilter, setLocationFilter] = useState("all");
  const [startDate, setStartDate] = useState(""); const [endDate, setEndDate] = useState("");
  const [activeLayers, setActiveLayers] = useState(() => new Set(["plaza", "espacio_verde", "platabanda"]));
  const [layersOpen, setLayersOpen] = useState(true); const [filtersOpen, setFiltersOpen] = useState(false);
  const [locationMode, setLocationMode] = useState(false); const [pendingIndex, setPendingIndex] = useState(0); const [draftLocation, setDraftLocation] = useState<{ latitude: number; longitude: number }>(); const [locationBusy, setLocationBusy] = useState(false); const [locationError, setLocationError] = useState("");
  const [relocatingId, setRelocatingId] = useState<string>();
  const lastAutoSelectedQuery = useRef("");

  const neighborhoods = useMemo(() => Array.from(new Set(spaces.map((space) => space.neighborhood).filter(Boolean))).sort((a, b) => a.localeCompare(b, "es")), [spaces]);
  const markerColors = useMemo(() => Object.fromEntries(spaces.map((space) => [space.id, layerColor(spaceLayerId(space))])), [spaces]);
  const filteredSpaces = useMemo(() => spaces.filter((space) => {
    const term = normalizeSearch(query);
    const task = space.task;
    const searchable = normalizeSearch([space.name, space.address, space.neighborhood, space.source_type, space.section_code, space.provider?.name, space.provider?.contact_name, space.source_key].filter(Boolean).join(" "));
    const matchesText = !term || searchable.includes(term);
    const typeLayerVisible = activeLayers.has(spaceLayerId(space));
    const statusLayerVisible = true;
    const matchesLocation = locationFilter === "all" || (locationFilter === "mapped" ? space.latitude != null && space.longitude != null : space.latitude == null || space.longitude == null);
    const matchesDates = (!startDate || Boolean(task && task.end_date >= startDate)) && (!endDate || Boolean(task && task.start_date <= endDate));
    return matchesText && typeLayerVisible && statusLayerVisible && matchesLocation && (providerId === "all" || space.provider?.id === providerId) && (status === "all" || space.status === status) && (type === "all" || spaceLayerId(space) === type) && (neighborhood === "all" || space.neighborhood === neighborhood) && matchesDates;
  }), [spaces, query, activeLayers, providerId, status, type, neighborhood, locationFilter, startDate, endDate]);

  const selected = spaces.find((space) => space.id === selectedId);
  const mappedSpaces = filteredSpaces.filter((space) => space.latitude != null && space.longitude != null);
  const pendingSpaces = spaces.filter((space) => space.latitude == null || space.longitude == null);
  const mappedTotal = spaces.length - pendingSpaces.length;
  const searchResults = query.trim() ? filteredSpaces.slice(0, 7) : [];
  const pendingSpace = pendingSpaces[Math.min(pendingIndex, Math.max(0, pendingSpaces.length - 1))];
  const relocatingSpace = spaces.find((space) => space.id === relocatingId);
  const canEditLocations = currentUser.role === "admin" || currentUser.role === "supervisor" || currentUser.role === "inspector";
  const activeFilterCount = [providerId, status, type, neighborhood, locationFilter].filter((value) => value !== "all").length + Number(Boolean(query)) + Number(Boolean(startDate)) + Number(Boolean(endDate));

  useEffect(() => {
    const term = query.trim();
    if (!term) { lastAutoSelectedQuery.current = ""; return; }
    if (lastAutoSelectedQuery.current === term) return;
    const firstMapped = filteredSpaces.find((space) => space.latitude != null && space.longitude != null);
    if (firstMapped) setSelectedId(firstMapped.id);
    lastAutoSelectedQuery.current = term;
  }, [filteredSpaces, query]);

  function layerCount(id: string) { return spaces.filter((space) => spaceLayerId(space) === id).length; }
  function toggleLayer(id: string) { setActiveLayers((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function clearFilters() { setQuery(""); setProviderId("all"); setStatus("all"); setType("all"); setNeighborhood("all"); setLocationFilter("all"); setStartDate(""); setEndDate(""); }
  function selectSearchResult(space: SpaceRecord) { setSelectedId(space.id); lastAutoSelectedQuery.current = query.trim(); }
  function movePending(direction: number) { if (!pendingSpaces.length) return; setPendingIndex((current) => (current + direction + pendingSpaces.length) % pendingSpaces.length); setDraftLocation(undefined); setLocationError(""); }
  async function saveLocation() { if (!pendingSpace || !draftLocation) return; setLocationBusy(true); setLocationError(""); const supabase = getSupabaseBrowserClient(); if (!supabase) { setLocationError("Supabase no está configurado."); setLocationBusy(false); return; } const { error } = await supabase.from("green_spaces").update({ latitude: draftLocation.latitude, longitude: draftLocation.longitude, geocoding_source: "Manual Applaza", geocoded_at: new Date().toISOString() }).eq("id", pendingSpace.id); if (error) { setLocationError(error.message); setLocationBusy(false); return; } setSpaces((current) => current.map((space) => space.id === pendingSpace.id ? { ...space, ...draftLocation } : space)); setDraftLocation(undefined); setLocationBusy(false); }
  async function saveRelocation() { if (!relocatingSpace || !draftLocation) return; setLocationBusy(true); setLocationError(""); const supabase = getSupabaseBrowserClient(); if (!supabase) { setLocationError("Supabase no está configurado."); setLocationBusy(false); return; } const { error } = await supabase.from("green_spaces").update({ latitude: draftLocation.latitude, longitude: draftLocation.longitude, geocoding_source: "Corrección manual Applaza", geocoded_at: new Date().toISOString() }).eq("id", relocatingSpace.id); if (error) { setLocationError(error.message); setLocationBusy(false); return; } setSpaces((current) => current.map((space) => space.id === relocatingSpace.id ? { ...space, ...draftLocation } : space)); setDraftLocation(undefined); setRelocatingId(undefined); setLocationBusy(false); }
  function beginRelocation(space: SpaceRecord) { setLocationMode(false); setRelocatingId(space.id); setSelectedId(undefined); setDraftLocation(undefined); setLocationError(""); }
  function addPhoto(photo: MaintenancePhoto) { setSpaces((current) => current.map((space) => space.task?.id === photo.maintenance_task_id ? { ...space, photos: [photo, ...space.photos] } : space)); }

  return <section className="gis-workspace">
    <header className="gis-toolbar">
      <div className="gis-search-wrap"><div className="gis-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nombre, dirección, sección o cooperativa" />{query && <button onClick={() => setQuery("")} aria-label="Limpiar búsqueda"><X size={15} /></button>}</div>{query.trim() && <div className="gis-search-results">{searchResults.map((space) => <button key={space.id} onClick={() => selectSearchResult(space)}><span>{space.name}</span><small>{space.address || space.neighborhood || space.source_type || "Sin referencia"}{space.latitude == null || space.longitude == null ? " - pendiente" : ""}</small></button>)}{!searchResults.length && <p>No hay resultados para la búsqueda.</p>}</div>}</div>
      <button className={`gis-tool-button ${layersOpen ? "active" : ""}`} onClick={() => setLayersOpen((value) => !value)}><Layers3 size={17} />Capas <span>{activeLayers.size}</span></button>
      <button className={`gis-tool-button ${filtersOpen ? "active" : ""}`} onClick={() => setFiltersOpen((value) => !value)}><SlidersHorizontal size={17} />Filtros {activeFilterCount > 0 && <span>{activeFilterCount}</span>}<ChevronDown size={14} /></button>
      <div className="gis-toolbar-summary"><strong>{mappedSpaces.length}</strong><span>visibles en mapa</span></div>
      {canEditLocations && <button className={`gis-location-button ${locationMode || relocatingSpace ? "active" : ""}`} onClick={() => { const closing = locationMode || Boolean(relocatingSpace); setLocationMode(!closing); setRelocatingId(undefined); setSelectedId(undefined); setDraftLocation(undefined); }}><Crosshair size={17} />{locationMode || relocatingSpace ? "Cerrar editor" : `Ubicar (${pendingSpaces.length})`}</button>}
    </header>

    <div className={`gis-filter-drawer ${filtersOpen ? "open" : ""}`}>
      <label>Ubicación<select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}><option value="all">Todos ({spaces.length})</option><option value="mapped">Con ubicación ({mappedTotal})</option><option value="pending">Pendientes ({pendingSpaces.length})</option></select></label>
      <label>Proveedor<select value={providerId} onChange={(event) => setProviderId(event.target.value)}><option value="all">Todos</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
      <label>Estado<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Todos</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Tipo<select value={type} onChange={(event) => setType(event.target.value)}><option value="all">Todos</option><option value="plaza">Plazas / Parques</option><option value="espacio_verde">Espacios verdes</option><option value="platabanda">Platabandas</option></select></label>
      <label>Barrio o zona<select value={neighborhood} onChange={(event) => setNeighborhood(event.target.value)}><option value="all">Todos</option>{neighborhoods.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Desde<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
      <label>Hasta<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
      <button onClick={clearFilters} disabled={!activeFilterCount}><RotateCcw size={14} />Restablecer</button>
    </div>

    <div className={`gis-map-stage ${locationMode || relocatingSpace ? "picking-location" : ""}`}>
      <SpaceMap spaces={filteredSpaces} selected={selected} onSelect={(space) => !locationMode && !relocatingSpace && setSelectedId(space.id)} locationMode={locationMode || Boolean(relocatingSpace)} draftLocation={draftLocation} onLocationPick={(latitude, longitude) => setDraftLocation({ latitude, longitude })} markerColors={markerColors} />

      {layersOpen && <aside className="gis-layers-panel"><div className="gis-panel-title"><div><span>CONTROL TERRITORIAL</span><strong>Capas operativas</strong></div><button onClick={() => setLayersOpen(false)}><X size={16} /></button></div>{["Espacios", "Operación"].map((group) => <section key={group}><h3>{group}</h3>{layerDefinitions.filter((layer) => layer.group === group).map((layer) => { const active = activeLayers.has(layer.id); return <button key={layer.id} className={active ? "active" : ""} onClick={() => toggleLayer(layer.id)}><i style={{ background: layer.color }} /> <span>{layer.label}<small>{layerCount(layer.id)} elementos</small></span><b>{active && <Check size={12} />}</b></button>; })}</section>)}<p className="gis-layer-note">Los puntos del mapa usan el color de su capa.</p><div className="gis-data-quality"><MapPin size={16} /><div><strong>{spaces.filter((space) => space.latitude != null).length} georreferenciados</strong><span>{pendingSpaces.length} pendientes de ubicación</span></div></div></aside>}

      <div className="gis-legend"><strong>Estado</strong>{(Object.keys(statusLabels) as MaintenanceStatus[]).map((value) => <span key={value}><i style={{ background: statusColors[value] }} />{statusLabels[value]}</span>)}</div>
      <div className="gis-map-counter">Mostrando <strong>{mappedSpaces.length}</strong> de {filteredSpaces.length} resultados</div>

      {dataError ? <div className="gis-state gis-error"><TriangleIcon /><strong>No pudimos cargar el mapa operativo</strong><span>{dataError}</span></div> : spaces.length === 0 ? <div className="gis-state"><Trees /><strong>Todavía no hay espacios verdes cargados</strong><span>Los registros aparecerán aquí cuando estén disponibles en Supabase.</span></div> : filteredSpaces.length === 0 ? <div className="gis-state"><Filter /><strong>No hay resultados para los filtros seleccionados</strong><button onClick={clearFilters}>Restablecer filtros</button></div> : mappedSpaces.length === 0 ? <div className="gis-state"><MapPin /><strong>Los resultados no tienen ubicación</strong><span>Podés asignarla desde el editor manual.</span></div> : null}

      {relocatingSpace ? <RelocationEditor space={relocatingSpace} draft={draftLocation} busy={locationBusy} error={locationError} onSave={saveRelocation} onClose={() => { setRelocatingId(undefined); setDraftLocation(undefined); setLocationError(""); }} /> : locationMode && pendingSpace ? <LocationEditor space={pendingSpace} index={pendingIndex} total={pendingSpaces.length} draft={draftLocation} busy={locationBusy} error={locationError} onPrevious={() => movePending(-1)} onNext={() => movePending(1)} onSave={saveLocation} onClose={() => setLocationMode(false)} /> : selected && <SpaceDetail space={selected} providers={providers} currentUser={currentUser} onClose={() => setSelectedId(undefined)} onPhoto={addPhoto} onUpdate={(updated) => setSpaces((current) => current.map((space) => space.id === updated.id ? updated : space))} onRelocate={beginRelocation} />}
    </div>
  </section>;
}

function TriangleIcon() { return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4m0 4h.01M10.3 3.8 2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z" /></svg>; }

function spaceLayerId(space: SpaceRecord) {
  const sourceType = space.source_type?.toLocaleLowerCase("es") ?? "";
  if (space.type === "platabanda" || sourceType.includes("platabanda")) return "platabanda";
  if (space.type === "plaza" || sourceType.includes("plaza") || sourceType.includes("plazoleta") || sourceType.includes("parque")) return "plaza";
  return "espacio_verde";
}

function layerColor(id: string) {
  return layerDefinitions.find((layer) => layer.id === id)?.color ?? "#64748b";
}

function normalizeSearch(value: string) {
  return value.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}
