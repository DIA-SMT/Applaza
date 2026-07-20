"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Check, ChevronDown, CloudOff, Crosshair, Filter, Layers3, LoaderCircle, LocateFixed, MapPin, RefreshCw, RotateCcw, Search, SlidersHorizontal, Trees, X } from "lucide-react";
import type { MaintenancePhoto, MaintenanceStatus, Provider, SpaceRecord, SpaceType, UserProfile } from "@/types/domain";
import { statusColors, statusLabels } from "./status-badge";
import { SpaceDetail } from "./space-detail";
import { LocationEditor } from "./location-editor";
import { RelocationEditor } from "./relocation-editor";
import { QuickAddEditor } from "./quick-add-editor";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { isNetworkError, loadQueue, persistQueue, runPendingOp, type PendingOp } from "@/lib/offline-queue";

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
  const [activeLayers, setActiveLayers] = useState(() => new Set<string>(layerDefinitions.map((layer) => layer.id)));
  const [layersOpen, setLayersOpen] = useState(true); const [filtersOpen, setFiltersOpen] = useState(false);
  const [locationMode, setLocationMode] = useState(false); const [pendingIndex, setPendingIndex] = useState(0); const [draftLocation, setDraftLocation] = useState<{ latitude: number; longitude: number }>(); const [locationBusy, setLocationBusy] = useState(false); const [locationError, setLocationError] = useState("");
  const [relocatingId, setRelocatingId] = useState<string>();
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number; accuracy: number }>(); const [geoBusy, setGeoBusy] = useState(false); const [geoError, setGeoError] = useState(""); const [draftFromGps, setDraftFromGps] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false); const [quickAddBusy, setQuickAddBusy] = useState(false); const [quickAddError, setQuickAddError] = useState("");
  const [syncQueue, setSyncQueue] = useState<PendingOp[]>([]); const [syncBusy, setSyncBusy] = useState(false); const [syncNotice, setSyncNotice] = useState("");
  const syncQueueRef = useRef<PendingOp[]>([]); const syncBusyRef = useRef(false);
  const lastAutoSelectedQuery = useRef("");

  useEffect(() => {
    const stored = loadQueue();
    syncQueueRef.current = stored;
    setSyncQueue(stored);
    const onOnline = () => { void syncNow(); };
    window.addEventListener("online", onOnline);
    if (stored.length && navigator.onLine) void syncNow();
    return () => window.removeEventListener("online", onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const neighborhoods = useMemo(() => Array.from(new Set(spaces.map((space) => space.neighborhood).filter(Boolean))).sort((a, b) => a.localeCompare(b, "es")), [spaces]);
  const markerColors = useMemo(() => Object.fromEntries(spaces.map((space) => [space.id, layerColor(spaceLayerId(space))])), [spaces]);
  const filteredSpaces = useMemo(() => spaces.filter((space) => {
    const term = normalizeSearch(query);
    const task = space.task;
    const searchable = normalizeSearch([space.name, space.address, space.neighborhood, space.source_type, space.section_code, space.provider?.name, space.provider?.contact_name, space.source_key].filter(Boolean).join(" "));
    const matchesText = !term || searchable.includes(term);
    const typeLayerVisible = activeLayers.has(spaceLayerId(space));
    const statusLayerVisible = !layerDefinitions.some((layer) => layer.id === space.status) || activeLayers.has(space.status);
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
  const gpsWarning = draftFromGps && userLocation && userLocation.accuracy > 50 ? `La precisión del GPS es de ±${Math.round(userLocation.accuracy)} m. Ajustá el punto arrastrándolo en el mapa si no coincide con el lugar real.` : "";
  const nearbySuggestions = useMemo(() => {
    if (!userLocation) return [] as SpaceRecord[];
    const nearNeighborhoods = new Set(spaces.filter((space) => space.latitude != null && space.longitude != null && space.neighborhood && distanceMeters(userLocation.latitude, userLocation.longitude, space.latitude, space.longitude) < 1200).map((space) => space.neighborhood));
    if (!nearNeighborhoods.size) return [] as SpaceRecord[];
    return spaces.filter((space) => (space.latitude == null || space.longitude == null) && space.neighborhood && nearNeighborhoods.has(space.neighborhood)).slice(0, 4);
  }, [spaces, userLocation]);
  const activeFilterCount = [providerId, status, type, neighborhood, locationFilter].filter((value) => value !== "all").length + Number(Boolean(query)) + Number(Boolean(startDate)) + Number(Boolean(endDate));

  useEffect(() => {
    const term = query.trim();
    if (!term) { lastAutoSelectedQuery.current = ""; return; }
    if (lastAutoSelectedQuery.current === term) return;
    const firstMapped = filteredSpaces.find((space) => space.latitude != null && space.longitude != null);
    if (firstMapped) setSelectedId(firstMapped.id);
    lastAutoSelectedQuery.current = term;
  }, [filteredSpaces, query]);

  function setQueue(next: PendingOp[]) { syncQueueRef.current = next; setSyncQueue(next); persistQueue(next); }
  function enqueueOp(op: Omit<PendingOp, "id" | "queuedAt">) { setQueue([...syncQueueRef.current, { ...op, id: crypto.randomUUID(), queuedAt: new Date().toISOString() }]); }
  async function syncNow() {
    if (syncBusyRef.current || !syncQueueRef.current.length) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    syncBusyRef.current = true; setSyncBusy(true); setSyncNotice("");
    const rejected: string[] = [];
    while (syncQueueRef.current.length) {
      const op = syncQueueRef.current[0];
      const result = await runPendingOp(supabase, op);
      if (result.retry) break;
      if (!result.ok && result.message) rejected.push(`${op.label}: ${result.message}`);
      setQueue(syncQueueRef.current.slice(1));
    }
    syncBusyRef.current = false; setSyncBusy(false);
    if (rejected.length) setSyncNotice(`No se pudieron aplicar estos cambios: ${rejected.join(" · ")}`);
  }
  function layerCount(id: string) { return spaces.filter((space) => spaceLayerId(space) === id).length; }
  function toggleLayer(id: string) { setActiveLayers((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function clearFilters() { setQuery(""); setProviderId("all"); setStatus("all"); setType("all"); setNeighborhood("all"); setLocationFilter("all"); setStartDate(""); setEndDate(""); }
  function selectSearchResult(space: SpaceRecord) { setSelectedId(space.id); lastAutoSelectedQuery.current = query.trim(); }
  function movePending(direction: number) { if (!pendingSpaces.length) return; setPendingIndex((current) => (current + direction + pendingSpaces.length) % pendingSpaces.length); setDraftLocation(undefined); setLocationError(""); }
  async function saveLocation() {
    if (!pendingSpace || !draftLocation) return;
    setLocationBusy(true); setLocationError("");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setLocationError("Supabase no está configurado."); setLocationBusy(false); return; }
    const values = { latitude: draftLocation.latitude, longitude: draftLocation.longitude, geocoding_source: "Manual Applaza", geocoded_at: new Date().toISOString() };
    const applyLocal = () => { setSpaces((current) => current.map((space) => space.id === pendingSpace.id ? { ...space, ...draftLocation } : space)); setDraftLocation(undefined); setLocationBusy(false); };
    const queueIt = () => { enqueueOp({ kind: "update", match: pendingSpace.id, values, label: `Ubicación de ${pendingSpace.name}` }); applyLocal(); };
    if (!navigator.onLine) { queueIt(); return; }
    const { error } = await supabase.from("green_spaces").update(values).eq("id", pendingSpace.id);
    if (error) { if (isNetworkError(error.message)) { queueIt(); return; } setLocationError(error.message); setLocationBusy(false); return; }
    applyLocal();
  }
  async function saveRelocation() {
    if (!relocatingSpace || !draftLocation) return;
    setLocationBusy(true); setLocationError("");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setLocationError("Supabase no está configurado."); setLocationBusy(false); return; }
    const values = { latitude: draftLocation.latitude, longitude: draftLocation.longitude, geocoding_source: "Corrección manual Applaza", geocoded_at: new Date().toISOString() };
    const applyLocal = () => { setSpaces((current) => current.map((space) => space.id === relocatingSpace.id ? { ...space, ...draftLocation } : space)); setDraftLocation(undefined); setRelocatingId(undefined); setLocationBusy(false); };
    const queueIt = () => { enqueueOp({ kind: "update", match: relocatingSpace.id, values, label: `Reubicación de ${relocatingSpace.name}` }); applyLocal(); };
    if (!navigator.onLine) { queueIt(); return; }
    const { error } = await supabase.from("green_spaces").update(values).eq("id", relocatingSpace.id);
    if (error) { if (isNetworkError(error.message)) { queueIt(); return; } setLocationError(error.message); setLocationBusy(false); return; }
    applyLocal();
  }
  function beginRelocation(space: SpaceRecord) { setLocationMode(false); setRelocatingId(space.id); setSelectedId(undefined); setDraftLocation(undefined); setLocationError(""); }
  function selectPendingSpace(space: SpaceRecord) { const nextIndex = pendingSpaces.findIndex((item) => item.id === space.id); if (nextIndex < 0) return; setPendingIndex(nextIndex); setDraftLocation(undefined); setLocationError(""); }
  function openQuickAdd() { if (!canEditLocations || !userLocation) return; setQuickAddOpen(true); setQuickAddError(""); setLocationMode(false); setRelocatingId(undefined); setSelectedId(undefined); setDraftLocation(undefined); }
  async function saveQuickAdd(input: { name: string; type: SpaceType; address: string; neighborhood: string }) {
    if (!userLocation) return;
    setQuickAddBusy(true); setQuickAddError("");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setQuickAddError("Supabase no está configurado."); setQuickAddBusy(false); return; }
    const sourceTypeLabels: Record<SpaceType, string> = { plaza: "Plaza", espacio_verde: "Espacio verde", platabanda: "Platabanda" };
    const nowIso = new Date().toISOString();
    const record = { id: crypto.randomUUID(), name: input.name, type: input.type, address: input.address || null, neighborhood: input.neighborhood || null, latitude: userLocation.latitude, longitude: userLocation.longitude, source_type: sourceTypeLabels[input.type], source_document: "Alta manual Applaza", source_key: `applaza-${crypto.randomUUID()}`, geocoding_source: "GPS Applaza", geocoded_at: nowIso };
    const localSpace: SpaceRecord = { id: record.id, name: record.name, type: input.type, address: input.address, neighborhood: input.neighborhood, latitude: record.latitude, longitude: record.longitude, status: "programado", created_at: nowIso, updated_at: nowIso, source_type: record.source_type, surface_m2: null, section_code: null, source_document: record.source_document, source_key: record.source_key, photos: [] };
    const applyLocal = () => { setSpaces((current) => [localSpace, ...current]); setQuickAddBusy(false); setQuickAddOpen(false); setSelectedId(record.id); };
    const queueIt = () => { enqueueOp({ kind: "insert", values: record, label: `Alta de ${record.name}` }); applyLocal(); };
    if (!navigator.onLine) { queueIt(); return; }
    const { error } = await supabase.from("green_spaces").insert(record);
    if (error) { if (isNetworkError(error.message)) { queueIt(); return; } setQuickAddError(/policy|permission|denied/i.test(error.message) ? "La base todavía no permite altas desde la app: hay que ejecutar supabase/staff_insert_spaces.sql en Supabase." : error.message); setQuickAddBusy(false); return; }
    applyLocal();
  }
  async function linkQuickAdd(space: SpaceRecord) {
    if (!userLocation) return;
    setQuickAddBusy(true); setQuickAddError("");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setQuickAddError("Supabase no está configurado."); setQuickAddBusy(false); return; }
    const { latitude, longitude } = userLocation;
    const values = { latitude, longitude, geocoding_source: "GPS Applaza", geocoded_at: new Date().toISOString() };
    const applyLocal = () => { setSpaces((current) => current.map((item) => item.id === space.id ? { ...item, latitude, longitude } : item)); setQuickAddBusy(false); setQuickAddOpen(false); setSelectedId(space.id); };
    const queueIt = () => { enqueueOp({ kind: "update", match: space.id, values, label: `Ubicación de ${space.name}` }); applyLocal(); };
    if (!navigator.onLine) { queueIt(); return; }
    const { error } = await supabase.from("green_spaces").update(values).eq("id", space.id);
    if (error) { if (isNetworkError(error.message)) { queueIt(); return; } setQuickAddError(error.message); setQuickAddBusy(false); return; }
    applyLocal();
  }
  async function locateUser(assignDraft: boolean, onLocated?: () => void) {
    if (typeof window !== "undefined" && !window.isSecureContext) { setGeoError("El navegador bloquea la ubicación porque la conexión no es segura. Entrá a la aplicación por https://."); return; }
    if (typeof navigator === "undefined" || !navigator.geolocation) { setGeoError("Este navegador no permite obtener la ubicación."); return; }
    let permission: PermissionStatus | undefined;
    try { permission = await navigator.permissions?.query({ name: "geolocation" }); } catch { permission = undefined; }
    if (permission?.state === "denied") {
      setGeoError("La ubicación quedó bloqueada para este sitio y el navegador ya no pregunta. Tocá el candado junto a la dirección, elegí Ubicación → Permitir y reintentá.");
      permission.onchange = () => { if (permission && permission.state !== "denied") { setGeoError(""); locateUser(assignDraft); } };
      return;
    }
    setGeoBusy(true); setGeoError("");
    navigator.geolocation.getCurrentPosition((position) => { const { latitude, longitude, accuracy } = position.coords; setUserLocation({ latitude, longitude, accuracy }); if (assignDraft) { setDraftLocation({ latitude, longitude }); setDraftFromGps(true); } setGeoBusy(false); onLocated?.(); }, (failure) => { setGeoBusy(false); setGeoError(failure.code === failure.PERMISSION_DENIED ? "No se aceptó el permiso. Tocá de nuevo el botón y elegí Permitir cuando el navegador pregunte." : "No pudimos obtener tu ubicación. Verificá que el GPS del dispositivo esté encendido y reintentá."); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 });
  }
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
      <SpaceMap spaces={filteredSpaces} selected={selected} onSelect={(space) => !locationMode && !relocatingSpace && setSelectedId(space.id)} locationMode={locationMode || Boolean(relocatingSpace)} draftLocation={draftLocation} onLocationPick={(latitude, longitude) => { setDraftLocation({ latitude, longitude }); setDraftFromGps(false); }} markerColors={markerColors} userLocation={userLocation} onUserClick={canEditLocations ? openQuickAdd : undefined} />

      {!locationMode && !relocatingSpace && <button className="gis-locate-fab" title="Centrar el mapa en mi ubicación" aria-label="Centrar el mapa en mi ubicación" disabled={geoBusy} onClick={() => locateUser(false)}>{geoBusy ? <LoaderCircle size={17} className="spin" /> : <LocateFixed size={17} />}</button>}
      {geoError && !locationMode && !relocatingSpace && <div className="gis-geo-toast" onClick={() => setGeoError("")}>{geoError}</div>}

      {layersOpen && <aside className="gis-layers-panel"><div className="gis-panel-title"><div><span>CONTROL TERRITORIAL</span><strong>Capas operativas</strong></div><button onClick={() => setLayersOpen(false)}><X size={16} /></button></div>{["Espacios", "Operación"].map((group) => <section key={group}><h3>{group}</h3>{layerDefinitions.filter((layer) => layer.group === group).map((layer) => { const active = activeLayers.has(layer.id); return <button key={layer.id} className={active ? "active" : ""} onClick={() => toggleLayer(layer.id)}><i style={{ background: layer.color }} /> <span>{layer.label}<small>{layerCount(layer.id)} elementos</small></span><b>{active && <Check size={12} />}</b></button>; })}</section>)}<p className="gis-layer-note">Los puntos del mapa usan el color de su capa.</p><div className="gis-data-quality"><MapPin size={16} /><div><strong>{spaces.filter((space) => space.latitude != null).length} georreferenciados</strong><span>{pendingSpaces.length} pendientes de ubicación</span></div></div></aside>}

      <div className="gis-legend"><strong>Estado</strong>{(Object.keys(statusLabels) as MaintenanceStatus[]).map((value) => <span key={value}><i style={{ background: statusColors[value] }} />{statusLabels[value]}</span>)}</div>
      <div className="gis-map-counter">Mostrando <strong>{mappedSpaces.length}</strong> de {filteredSpaces.length} resultados</div>
      {syncQueue.length > 0 && <div className="gis-sync-banner"><CloudOff size={14} /><span>{syncQueue.length === 1 ? "1 cambio sin sincronizar" : `${syncQueue.length} cambios sin sincronizar`}</span><button onClick={() => void syncNow()} disabled={syncBusy}>{syncBusy ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}Sincronizar ahora</button></div>}
      {syncNotice && <div className="gis-geo-toast" onClick={() => setSyncNotice("")}>{syncNotice}</div>}

      {dataError ? <div className="gis-state gis-error"><TriangleIcon /><strong>No pudimos cargar el mapa operativo</strong><span>{dataError}</span></div> : spaces.length === 0 ? <div className="gis-state"><Trees /><strong>Todavía no hay espacios verdes cargados</strong><span>Los registros aparecerán aquí cuando estén disponibles en Supabase.</span></div> : filteredSpaces.length === 0 ? <div className="gis-state"><Filter /><strong>No hay resultados para los filtros seleccionados</strong><button onClick={clearFilters}>Restablecer filtros</button></div> : mappedSpaces.length === 0 ? <div className="gis-state"><MapPin /><strong>Los resultados no tienen ubicación</strong><span>Podés asignarla desde el editor manual.</span></div> : null}

      {quickAddOpen && userLocation ? <QuickAddEditor location={userLocation} pendingSpaces={pendingSpaces} busy={quickAddBusy} error={quickAddError} onSave={saveQuickAdd} onLink={linkQuickAdd} onClose={() => setQuickAddOpen(false)} /> : relocatingSpace ? <RelocationEditor space={relocatingSpace} draft={draftLocation} busy={locationBusy} error={locationError} geoBusy={geoBusy} geoError={geoError} warning={gpsWarning} onUseMyLocation={() => locateUser(true)} onSave={saveRelocation} onClose={() => { setRelocatingId(undefined); setDraftLocation(undefined); setLocationError(""); }} /> : locationMode && pendingSpace ? <LocationEditor space={pendingSpace} index={pendingIndex} total={pendingSpaces.length} pendingSpaces={pendingSpaces} suggestions={nearbySuggestions} draft={draftLocation} busy={locationBusy} error={locationError} geoBusy={geoBusy} geoError={geoError} warning={gpsWarning} onPrevious={() => movePending(-1)} onNext={() => movePending(1)} onSelectSpace={selectPendingSpace} onUseMyLocation={() => locateUser(false, () => { setLocationMode(false); setDraftLocation(undefined); setQuickAddError(""); setQuickAddOpen(true); })} onSave={saveLocation} onClose={() => setLocationMode(false)} /> : selected && <SpaceDetail space={selected} providers={providers} currentUser={currentUser} onClose={() => setSelectedId(undefined)} onPhoto={addPhoto} onUpdate={(updated) => setSpaces((current) => current.map((space) => space.id === updated.id ? updated : space))} onRelocate={beginRelocation} />}
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

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const rad = Math.PI / 180;
  const x = (lon2 - lon1) * rad * Math.cos(((lat1 + lat2) / 2) * rad);
  const y = (lat2 - lat1) * rad;
  return Math.sqrt(x * x + y * y) * 6371000;
}

function normalizeSearch(value: string) {
  return value.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}
