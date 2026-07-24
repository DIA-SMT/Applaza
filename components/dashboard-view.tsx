"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { Building2, Camera, Check, ChevronRight, ClipboardCheck, Eye, LayoutDashboard, LoaderCircle, LogOut, Map, MapPin, Menu, MessageSquarePlus, Save, Search, Trees, TriangleAlert, UsersRound, X } from "lucide-react";
import type { MaintenancePhoto, MaintenanceTask, Provider, SpaceRecord, UserProfile } from "@/types/domain";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { photoTypeLabel } from "@/lib/photo-label";
import { AuditDashboard } from "./audit-dashboard";
import { AssistantChat } from "./assistant-chat";
import { ControlRegister } from "./control-register";
import { OperationalMap } from "./operational-map";
import { PhotoUpload } from "./photo-upload";
import { ProviderRating } from "./provider-rating";
import { SpaceDetail } from "./space-detail";

type View = "dashboard" | "map" | "control" | "audit";
type MetricKey = "all" | "mapped" | "pending" | "evidence" | "providers";
const DOCUMENT_SPACE_TOTAL = 218;
type SupervisorObservation = {
  id: string;
  green_space_id: string;
  provider_id: string | null;
  period_month: string;
  observation: string;
  created_by: string | null;
  created_at: string;
};

export function DashboardView({ initialSpaces, providers, currentUser, dataError }: { initialSpaces: SpaceRecord[]; providers: Provider[]; currentUser: UserProfile; dataError: string | null }) {
  const isAuditorOnly = currentUser.role === "auditor";
  const canSeeAudit = currentUser.role === "admin" || currentUser.role === "auditor";
  const [view, setView] = useState<View>(isAuditorOnly ? "audit" : "dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [spaces, setSpaces] = useState(initialSpaces);
  const [locateSpaceId, setLocateSpaceId] = useState<string>();
  const stats = [
    { key: "all" as const, label: "Espacios del documento", value: DOCUMENT_SPACE_TOTAL, icon: Trees, tone: "blue" },
    { key: "mapped" as const, label: "Con ubicacion", value: spaces.filter((space) => space.latitude != null && space.longitude != null).length, icon: Map, tone: "cyan" },
    { key: "pending" as const, label: "Pendientes de ubicar", value: spaces.filter((space) => space.latitude == null || space.longitude == null).length, icon: TriangleAlert, tone: "red" },
    { key: "evidence" as const, label: "Evidencias cargadas", value: spaces.reduce((total, space) => total + space.photos.length, 0), icon: ClipboardCheck, tone: "green" },
    { key: "providers" as const, label: "Cooperativas activas", value: providers.filter((provider) => provider.active).length, icon: UsersRound, tone: "purple" },
  ];
  const latestPhotos = spaces.flatMap((space) => space.photos.map((photo) => ({ ...photo, spaceName: space.name }))).sort((left, right) => right.created_at.localeCompare(left.created_at));

  async function signOut() {
    await getSupabaseBrowserClient()?.auth.signOut();
    window.location.href = "/login";
  }

  function changeView(nextView: View) {
    if (nextView === "audit" && !canSeeAudit) return;
    if (isAuditorOnly && nextView !== "audit") return;
    if (nextView !== "map") setLocateSpaceId(undefined);
    setView(nextView);
    setMobileNavOpen(false);
  }

  function locateFromDashboard(space: SpaceRecord) {
    setLocateSpaceId(space.id);
    setView("map");
    setMobileNavOpen(false);
  }

  function addPhoto(photo: MaintenancePhoto, spaceId?: string, task?: MaintenanceTask) {
    setSpaces((current) => current.map((space) => {
      const belongsToSpace = space.id === spaceId || space.task?.id === photo.maintenance_task_id;
      return belongsToSpace ? { ...space, task: task ?? space.task, photos: [photo, ...space.photos] } : space;
    }));
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <AppBrand />
      <AppNav view={view} onChange={changeView} role={currentUser.role} />
      <div className="sidebar-foot"><Building2 /><div><strong>Municipalidad de SMT</strong><span>Gestion Ambiental</span></div></div>
    </aside>

    {mobileNavOpen && <button className="mobile-nav-backdrop" aria-label="Cerrar menu" onClick={() => setMobileNavOpen(false)} />}
    <aside className={`mobile-nav ${mobileNavOpen ? "open" : ""}`} aria-hidden={!mobileNavOpen}>
      <AppBrand />
      <AppNav view={view} onChange={changeView} role={currentUser.role} />
      <button className="mobile-nav-signout" onClick={signOut}><LogOut size={16} />Cerrar sesion</button>
    </aside>

    <main className="main">
      <header className="topbar">
        <button className="mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Abrir menu"><Menu /></button>
        <div><span>San Miguel de Tucuman</span><strong>{viewTitle(view)}</strong></div>
        <div className="user"><span>{currentUser.full_name.slice(0, 2).toUpperCase()}</span><div><strong>{currentUser.full_name}</strong><small>{roleLabel(currentUser.role)}</small></div><button className="logout-button" onClick={signOut} title="Cerrar sesion"><LogOut size={17} /></button></div>
      </header>
      {view === "audit" && canSeeAudit
        ? <AuditDashboard spaces={spaces} providers={providers} currentUser={currentUser} onPhotoDeleted={(photoId) => setSpaces((current) => current.map((space) => space.photos.some((photo) => photo.id === photoId) ? { ...space, photos: space.photos.filter((photo) => photo.id !== photoId) } : space))} />
        : view === "map"
        ? <OperationalMap spaces={spaces} providers={providers} currentUser={currentUser} dataError={dataError} setSpaces={setSpaces} locateSpaceId={locateSpaceId} />
        : view === "control"
          ? <ControlRegister providers={providers} spaces={spaces} />
          : <Dashboard spaces={spaces} providers={providers} currentUser={currentUser} stats={stats} latestPhotos={latestPhotos} dataError={dataError} onPhoto={addPhoto} onOpenMap={() => changeView("map")} onUpdateSpace={(updated) => setSpaces((current) => current.map((space) => space.id === updated.id ? updated : space))} onLocateSpace={locateFromDashboard} />}
      <AssistantChat />
    </main>
  </div>;
}

function AppBrand() {
  return <div className="brand"><div className="brand-mark"><Image src="/logo-municipal.png" alt="Municipalidad de San Miguel de Tucuman" width={42} height={42} priority /></div><div><strong>Applaza</strong><span>Gestion de espacios verdes</span></div></div>;
}

function AppNav({ view, onChange, role }: { view: View; onChange: (view: View) => void; role: UserProfile["role"] }) {
  const auditorOnly = role === "auditor";
  const canAudit = role === "admin" || role === "auditor";

  return <nav>
    {!auditorOnly && <button className={view === "dashboard" ? "active" : ""} onClick={() => onChange("dashboard")}><LayoutDashboard />Resumen</button>}
    {!auditorOnly && <button className={view === "map" ? "active" : ""} onClick={() => onChange("map")}><Map />Mapa operativo</button>}
    {!auditorOnly && <button className={view === "control" ? "active" : ""} onClick={() => onChange("control")}><ClipboardCheck />Registro de control</button>}
    {canAudit && <button className={view === "audit" ? "active" : ""} onClick={() => onChange("audit")}><Eye />Auditoria</button>}
  </nav>;
}

function roleLabel(role: UserProfile["role"]) {
  if (role === "admin") return "Administracion";
  if (role === "supervisor") return "Supervision";
  if (role === "inspector") return "Inspeccion";
  if (role === "auditor") return "Auditoria";
  return "Proveedor";
}

function viewTitle(view: View) {
  if (view === "dashboard") return "Panel de control";
  if (view === "map") return "Mapa operativo";
  if (view === "control") return "Registro de control";
  return "Auditoria";
}

function Dashboard({
  spaces,
  providers,
  currentUser,
  stats,
  latestPhotos,
  dataError,
  onPhoto,
  onOpenMap,
  onUpdateSpace,
  onLocateSpace,
}: {
  spaces: SpaceRecord[];
  providers: Provider[];
  currentUser: UserProfile;
  stats: Array<{ key: MetricKey; label: string; value: number; icon: typeof Trees; tone: string }>;
  latestPhotos: Array<{ id: string; image_url: string; photo_type: string; spaceName: string }>;
  dataError: string | null;
  onPhoto: (photo: MaintenancePhoto, spaceId?: string, task?: MaintenanceTask) => void;
  onOpenMap: () => void;
  onUpdateSpace: (space: SpaceRecord) => void;
  onLocateSpace: (space: SpaceRecord) => void;
}) {
  const [activeMetric, setActiveMetric] = useState<MetricKey>("all");
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>();
  const selectedSpace = spaces.find((space) => space.id === selectedSpaceId);
  const listedSpaces = [...spaces].sort((left, right) => left.name.localeCompare(right.name, "es")).slice(0, 6);

  return <div className="content dashboard">
    <div className="page-heading"><div><p>PADRON MUNICIPAL</p><h1>Estado general</h1><span>Seguimiento de espacios verdes cargados desde el documento.</span></div><button className="primary" onClick={onOpenMap}><Map size={17} />Abrir mapa</button></div>
    {dataError && <div className="dashboard-error"><TriangleAlert size={18} /><div><strong>No se pudieron actualizar los datos</strong><span>{dataError}</span></div></div>}
    <div className="stats-grid">{stats.map(({ key, label, value, icon: Icon, tone }) => <button className={`stat-card ${activeMetric === key ? "active" : ""}`} key={label} onClick={() => setActiveMetric(key)}><div className={`stat-icon ${tone}`}><Icon /></div><div><span>{label}</span><strong>{value}</strong></div><ChevronRight size={16} /></button>)}</div>
    <MetricDetailPanel metric={activeMetric} spaces={spaces} providers={providers} onOpenMap={onOpenMap} onSelectSpace={(space) => setSelectedSpaceId(space.id)} onLocateSpace={onLocateSpace} />
    <div className="dashboard-grid">
      <section className="card"><div className="card-title"><div><h2>Espacios cargados</h2><p>Primeros registros disponibles del documento</p></div><button onClick={onOpenMap}>Ver mapa <ChevronRight size={16} /></button></div>{listedSpaces.length ? <div className="task-list">{listedSpaces.map((space) => <button key={space.id} onClick={onOpenMap}><span className="space-dot" /><div><strong>{space.name}</strong><small>{space.provider?.name || "Sin cooperativa asignada"}</small></div><span className="space-section-label">{space.section_code ? `Seccion ${space.section_code}` : space.source_type || "Espacio"}</span><ChevronRight size={17} /></button>)}</div> : <p className="dashboard-empty">No hay espacios cargados.</p>}</section>
      <section className="card evidence-card"><div className="card-title"><div><h2>Cargar evidencia</h2><p>Foto tomada en campo y asociada al espacio verde</p></div><Camera size={20} /></div><PhotoUpload spaces={spaces} onUploaded={onPhoto} /></section>
      <SupervisorObservations spaces={spaces} currentUser={currentUser} />
      <section className="card"><div className="card-title"><div><h2>Ultimas evidencias</h2><p>Fotos cargadas recientemente</p></div><Camera size={20} /></div>{latestPhotos.length ? <div className="recent-photos">{latestPhotos.slice(0, 4).map((photo) => <figure key={photo.id}><Image src={photo.image_url} alt={photo.spaceName} width={320} height={180} unoptimized={photo.image_url.startsWith("blob:")} /><figcaption><strong>{photo.spaceName}</strong><span>{photoTypeLabel(photo.photo_type)}</span></figcaption></figure>)}</div> : <p className="dashboard-empty">No hay fotos cargadas.</p>}</section>
    </div>
    {selectedSpace && <SpaceDetail space={selectedSpace} providers={providers} currentUser={currentUser} onClose={() => setSelectedSpaceId(undefined)} onPhoto={(photo) => onPhoto(photo)} onUpdate={onUpdateSpace} onRelocate={onLocateSpace} />}
  </div>;
}

function MetricDetailPanel({
  metric,
  spaces,
  providers,
  onOpenMap,
  onSelectSpace,
  onLocateSpace,
}: {
  metric: MetricKey;
  spaces: SpaceRecord[];
  providers: Provider[];
  onOpenMap: () => void;
  onSelectSpace: (space: SpaceRecord) => void;
  onLocateSpace: (space: SpaceRecord) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState<string>();
  const [evidenceFilter, setEvidenceFilter] = useState<"con" | "sin" | "todos">("con");
  const activeProviders = providers.filter((provider) => provider.active);
  const metricCopy = metricContent(metric);
  const withEvidence = spaces.filter((space) => space.photos.length > 0).length;
  const metricSpaces = useMemo(() => {
    if (metric === "mapped") return spaces.filter((space) => space.latitude != null && space.longitude != null);
    if (metric === "pending") return spaces.filter((space) => space.latitude == null || space.longitude == null);
    if (metric === "evidence") return evidenceFilter === "todos" ? spaces : spaces.filter((space) => evidenceFilter === "con" ? space.photos.length > 0 : space.photos.length === 0);
    if (metric === "providers" && selectedProviderId) return spaces.filter((space) => space.provider?.id === selectedProviderId);
    return spaces;
  }, [metric, selectedProviderId, spaces, evidenceFilter]);
  const filteredSpaces = metricSpaces.filter((space) => {
    const term = normalizeQuery(query);
    const text = normalizeQuery([space.name, space.address, space.neighborhood, space.section_code, space.source_type, space.provider?.name].filter(Boolean).join(" "));
    return !term || text.includes(term);
  }).sort((left, right) => left.name.localeCompare(right.name, "es"));
  const providerRows = activeProviders.map((provider) => {
    const assigned = spaces.filter((space) => space.provider?.id === provider.id);
    const pending = assigned.filter((space) => space.latitude == null || space.longitude == null).length;
    return {
      provider,
      assigned,
      pending,
      mapped: assigned.length - pending,
      photos: assigned.reduce((total, space) => total + space.photos.length, 0),
      surface: assigned.reduce((total, space) => total + (space.surface_m2 ?? 0), 0),
    };
  }).sort((left, right) => right.pending - left.pending || left.provider.name.localeCompare(right.provider.name, "es"));
  const selectedProvider = providerRows.find((row) => row.provider.id === selectedProviderId);

  useEffect(() => {
    setQuery("");
    setEvidenceFilter("con");
    if (metric !== "providers") setSelectedProviderId(undefined);
  }, [metric]);

  return <section className="dashboard-metric-panel">
    <div className="metric-panel-head">
      <div>
        <p>{metricCopy.eyebrow}</p>
        <h2>{metric === "evidence" && evidenceFilter === "sin" ? "Espacios sin evidencia cargada" : metric === "evidence" && evidenceFilter === "todos" ? "Evidencias por espacio" : metricCopy.title}</h2>
        <span>{metricCopy.description}</span>
      </div>
      <button onClick={onOpenMap}><Map size={16} />Abrir mapa operativo</button>
    </div>

    {metric === "evidence" && <div className="evidence-filter" role="group" aria-label="Filtrar espacios por evidencia">
      <button className={evidenceFilter === "con" ? "active" : ""} aria-pressed={evidenceFilter === "con"} onClick={() => setEvidenceFilter("con")}>Con evidencia <b>{withEvidence}</b></button>
      <button className={evidenceFilter === "sin" ? "active" : ""} aria-pressed={evidenceFilter === "sin"} onClick={() => setEvidenceFilter("sin")}>Sin evidencia <b>{spaces.length - withEvidence}</b></button>
      <button className={evidenceFilter === "todos" ? "active" : ""} aria-pressed={evidenceFilter === "todos"} onClick={() => setEvidenceFilter("todos")}>Todos <b>{spaces.length}</b></button>
    </div>}

    {metric === "providers" ? <div className="provider-summary-grid">
      {providerRows.map((row) => <button key={row.provider.id} className={selectedProviderId === row.provider.id ? "active" : ""} onClick={() => setSelectedProviderId(row.provider.id)}>
        <strong>{row.provider.name}</strong>
        <span>{row.assigned.length} espacios · {row.mapped} ubicados · {row.pending} pendientes</span>
        <small>{Math.round(row.surface).toLocaleString("es-AR")} m² · {row.photos} evidencias</small>
      </button>)}
    </div> : null}

    {metric === "providers" && selectedProvider ? <ProviderRating provider={selectedProvider.provider} /> : null}

    <div className="metric-panel-tools">
      <div className="metric-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={metric === "providers" && !selectedProvider ? "Seleccioná una cooperativa para ver sus espacios" : "Buscar por nombre, barrio, sección o cooperativa"} />{query && <button onClick={() => setQuery("")} aria-label="Limpiar búsqueda"><X size={14} /></button>}</div>
      <span>{metric === "providers" && !selectedProvider ? `${providerRows.length} cooperativas` : `${filteredSpaces.length} resultados`}</span>
    </div>

    {metric === "providers" && !selectedProvider ? <p className="dashboard-empty compact">Seleccioná una cooperativa para ver sus espacios relacionados y modificar cada ficha.</p> : filteredSpaces.length ? <div className="metric-space-list">
      {filteredSpaces.slice(0, 80).map((space) => <article key={space.id}>
        <div className="metric-space-main">
          <strong>{space.name}</strong>
          <span>{space.address || space.neighborhood || space.source_type || "Sin referencia"}</span>
          <small>{space.provider?.name ?? "Sin cooperativa"} · {space.section_code ? `Sección ${space.section_code}` : "Sin sección"} · {space.surface_m2 ? `${Math.round(space.surface_m2).toLocaleString("es-AR")} m²` : "Sin superficie"}</small>
        </div>
        <div className="metric-space-meta">
          <span className={space.latitude != null && space.longitude != null ? "mapped" : "pending"}>{space.latitude != null && space.longitude != null ? "Ubicado" : "Pendiente"}</span>
          <span>{space.photos.length} fotos</span>
        </div>
        <div className="metric-space-actions">
          {space.latitude == null || space.longitude == null ? <button onClick={() => onLocateSpace(space)}><MapPin size={14} />Ubicar</button> : <button onClick={() => onOpenMap()}><Map size={14} />Ver mapa</button>}
          <button onClick={() => onSelectSpace(space)}>Ver / editar</button>
        </div>
      </article>)}
    </div> : <p className="dashboard-empty compact">{metric === "evidence" && evidenceFilter === "sin" && !query.trim() ? "Todos los espacios tienen al menos una evidencia cargada." : "No hay registros para este filtro."}</p>}
  </section>;
}

function metricContent(metric: MetricKey) {
  if (metric === "mapped") return { eyebrow: "GEORREFERENCIADOS", title: "Espacios con ubicación", description: "Listado completo de registros que ya tienen coordenadas cargadas." };
  if (metric === "pending") return { eyebrow: "ACCIÓN REQUERIDA", title: "Pendientes de ubicar", description: "Seleccioná un espacio para abrir el mapa y guardar su ubicación manual." };
  if (metric === "evidence") return { eyebrow: "EVIDENCIAS", title: "Espacios con fotos cargadas", description: "Control de registros con evidencia fotográfica asociada." };
  if (metric === "providers") return { eyebrow: "COOPERATIVAS", title: "Cooperativas activas", description: "Resumen por cooperativa y acceso a sus espacios asignados." };
  return { eyebrow: "PADRÓN", title: "Espacios del documento", description: "Todos los espacios cargados desde el documento municipal." };
}

function normalizeQuery(value: string) {
  return value.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

function SupervisorObservations({ spaces, currentUser }: { spaces: SpaceRecord[]; currentUser: UserProfile }) {
  const month = currentMonth();
  const periodLabel = formatMonth(month);
  const spaceOptions = useMemo(() => [...spaces].sort((left, right) => left.name.localeCompare(right.name, "es")), [spaces]);
  const [items, setItems] = useState<SupervisorObservation[]>([]);
  const [spaceId, setSpaceId] = useState("");
  const [spaceQuery, setSpaceQuery] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedSpace = spaceOptions.find((space) => space.id === spaceId);
  const canCreate = currentUser.role === "admin" || currentUser.role === "supervisor" || currentUser.role === "inspector";

  useEffect(() => {
    let active = true;

    async function loadObservations() {
      setError(null);
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;

      const { data, error: queryError } = await supabase
        .from("audit_observations")
        .select("*")
        .eq("period_month", `${month}-01`)
        .order("created_at", { ascending: false });

      if (!active) return;
      if (queryError) {
        setItems([]);
        setError("Para guardar observaciones ejecuta el SQL de audit_observations.");
      } else {
        setItems((data ?? []) as SupervisorObservation[]);
      }
    }

    loadObservations();
    return () => {
      active = false;
    };
  }, [month]);

  async function saveObservation() {
    setMessage(null);
    if (!spaceId || !text.trim()) {
      setMessage("Selecciona un espacio y escribe una observacion.");
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setMessage("Supabase no esta configurado.");
      return;
    }

    setSaving(true);
    const payload = {
      green_space_id: spaceId,
      provider_id: selectedSpace?.provider?.id ?? null,
      period_month: `${month}-01`,
      observation: text.trim(),
      created_by: currentUser.id,
    };
    const { data, error: insertError } = await supabase.from("audit_observations").insert(payload).select("*").single();
    setSaving(false);

    if (insertError) {
      setMessage("No se pudo guardar la observacion. Revisa si ejecutaste el SQL.");
      return;
    }

    setItems((current) => [data as SupervisorObservation, ...current]);
    setText("");
    setMessage("Observacion guardada.");
  }

  function onSpaceQueryChange(value: string) {
    setSpaceQuery(value);
    const match = spaceOptions.find((space) => observationOptionLabel(space) === value || space.name.toLocaleLowerCase("es") === value.toLocaleLowerCase("es"));
    setSpaceId(match?.id ?? "");
  }

  const visibleItems = items
    .map((observation) => ({ ...observation, space: spaces.find((space) => space.id === observation.green_space_id) }))
    .slice(0, 6);

  return <section className="card summary-observations-card">
    <div className="card-title">
      <div>
        <h2>Observaciones operativas</h2>
        <p>Carga del supervisor sobre espacios del periodo</p>
      </div>
      <MessageSquarePlus size={20} />
    </div>
    <div className="audit-observations-grid">
      {canCreate && <div className="audit-observation-form">
        <label>
          Espacio verde
          <input list="summary-observation-spaces" value={spaceQuery} onChange={(event) => onSpaceQueryChange(event.target.value)} placeholder="Buscar por nombre, barrio o seccion" />
          <datalist id="summary-observation-spaces">{spaceOptions.map((space) => <option key={space.id} value={observationOptionLabel(space)} />)}</datalist>
        </label>
        <label>
          Observacion
          <textarea value={text} onChange={(event) => setText(event.target.value)} rows={4} placeholder="Escribir observacion del supervisor..." />
        </label>
        {error && <p className="audit-observation-note error">{error}</p>}
        {message && <p className="audit-observation-note">{message}</p>}
        <button onClick={saveObservation} disabled={saving}>
          {saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}Guardar observacion
        </button>
      </div>}
      <div className="audit-observation-list">
        <div className="summary-observations-period"><Check size={14} /><span>{periodLabel}</span></div>
        {visibleItems.map((observation) => <article key={observation.id}>
          <MessageSquarePlus size={16} />
          <div>
            <strong>{observation.space?.name ?? "Espacio sin identificar"}</strong>
            <p>{observation.observation}</p>
            <span>{formatDate(observation.created_at)}</span>
          </div>
        </article>)}
        {!visibleItems.length && <p className="dashboard-empty">Todavia no hay observaciones cargadas.</p>}
      </div>
    </div>
  </section>;
}

function observationOptionLabel(space: SpaceRecord) {
  return [space.name, space.neighborhood, space.section_code ? `Seccion ${space.section_code}` : null].filter(Boolean).join(" - ");
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonth(value: string) {
  return new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" }).format(new Date(`${value}-01T12:00:00`));
}

function formatDate(value: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}
