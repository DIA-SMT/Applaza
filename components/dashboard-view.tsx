"use client";

import Image from "next/image";
import { useState } from "react";
import { Building2, Camera, ChevronRight, ClipboardCheck, Clock3, Eye, LayoutDashboard, LogOut, Map, Menu, Trees, TriangleAlert, UsersRound } from "lucide-react";
import type { MaintenancePhoto, Provider, SpaceRecord, UserProfile } from "@/types/domain";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { AuditDashboard } from "./audit-dashboard";
import { ControlRegister } from "./control-register";
import { OperationalMap } from "./operational-map";
import { PhotoUpload } from "./photo-upload";
import { statusColors } from "./status-badge";

type View = "dashboard" | "map" | "control" | "audit";

export function DashboardView({ initialSpaces, providers, currentUser, dataError }: { initialSpaces: SpaceRecord[]; providers: Provider[]; currentUser: UserProfile; dataError: string | null }) {
  const isAuditorOnly = currentUser.role === "auditor";
  const canSeeAudit = currentUser.role === "admin" || currentUser.role === "auditor";
  const [view, setView] = useState<View>(isAuditorOnly ? "audit" : "dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [spaces, setSpaces] = useState(initialSpaces);
  const stats = [
    { label: "Espacios relevados", value: spaces.length, icon: Trees, tone: "blue" },
    { label: "En curso", value: spaces.filter((space) => space.status === "en_curso").length, icon: Clock3, tone: "cyan" },
    { label: "Finalizados", value: spaces.filter((space) => space.status === "finalizado").length, icon: ClipboardCheck, tone: "green" },
    { label: "Vencidos", value: spaces.filter((space) => space.status === "vencido").length, icon: TriangleAlert, tone: "red" },
    { label: "Proveedores activos", value: providers.filter((provider) => provider.active).length, icon: UsersRound, tone: "purple" },
  ];
  const latestPhotos = spaces.flatMap((space) => space.photos.map((photo) => ({ ...photo, spaceName: space.name }))).sort((left, right) => right.created_at.localeCompare(left.created_at));

  async function signOut() {
    await getSupabaseBrowserClient()?.auth.signOut();
    window.location.href = "/login";
  }

  function changeView(nextView: View) {
    if (nextView === "audit" && !canSeeAudit) return;
    if (isAuditorOnly && nextView !== "audit") return;
    setView(nextView);
    setMobileNavOpen(false);
  }

  function addPhoto(photo: MaintenancePhoto, spaceId?: string) {
    setSpaces((current) => current.map((space) => {
      const belongsToSpace = space.id === spaceId || space.task?.id === photo.maintenance_task_id;
      return belongsToSpace ? { ...space, photos: [photo, ...space.photos] } : space;
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
        ? <AuditDashboard spaces={spaces} providers={providers} currentUser={currentUser} />
        : view === "map"
        ? <OperationalMap spaces={spaces} providers={providers} currentUser={currentUser} dataError={dataError} setSpaces={setSpaces} />
        : view === "control"
          ? <ControlRegister providers={providers} spaces={spaces} />
          : <Dashboard spaces={spaces} providers={providers} stats={stats} latestPhotos={latestPhotos} dataError={dataError} onPhoto={addPhoto} onOpenMap={() => changeView("map")} />}
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
  stats,
  latestPhotos,
  dataError,
  onPhoto,
  onOpenMap,
}: {
  spaces: SpaceRecord[];
  providers: Provider[];
  stats: Array<{ label: string; value: number; icon: typeof Trees; tone: string }>;
  latestPhotos: Array<{ id: string; image_url: string; photo_type: string; spaceName: string }>;
  dataError: string | null;
  onPhoto: (photo: MaintenancePhoto, spaceId?: string) => void;
  onOpenMap: () => void;
}) {
  const recentTasks = spaces.filter((space) => space.task).slice(0, 6);

  return <div className="content dashboard">
    <div className="page-heading"><div><p>OPERACION MUNICIPAL</p><h1>Estado general</h1><span>Seguimiento actualizado de espacios verdes y mantenimientos.</span></div><button className="primary" onClick={onOpenMap}><Map size={17} />Abrir mapa</button></div>
    {dataError && <div className="dashboard-error"><TriangleAlert size={18} /><div><strong>No se pudieron actualizar los datos</strong><span>{dataError}</span></div></div>}
    <div className="stats-grid">{stats.map(({ label, value, icon: Icon, tone }) => <article className="stat-card" key={label}><div className={`stat-icon ${tone}`}><Icon /></div><div><span>{label}</span><strong>{value}</strong></div></article>)}</div>
    <div className="dashboard-grid">
      <section className="card"><div className="card-title"><div><h2>Mantenimientos recientes</h2><p>Situacion de las tareas activas</p></div><button onClick={onOpenMap}>Ver mapa <ChevronRight size={16} /></button></div>{recentTasks.length ? <div className="task-list">{recentTasks.map((space) => <button key={space.id} onClick={onOpenMap}><span className="space-dot" style={{ background: statusColors[space.status] }} /><div><strong>{space.name}</strong><small>{space.provider?.name || "Sin proveedor asignado"}</small></div><span className={`status status-${space.status}`}>{space.status.replace("_", " ")}</span><ChevronRight size={17} /></button>)}</div> : <p className="dashboard-empty">No hay mantenimientos activos.</p>}</section>
      <section className="card evidence-card"><div className="card-title"><div><h2>Cargar evidencia</h2><p>Foto tomada en campo y asociada al espacio verde</p></div><Camera size={20} /></div><PhotoUpload spaces={spaces} onUploaded={onPhoto} /></section>
      <section className="card"><div className="card-title"><div><h2>Ultimas evidencias</h2><p>Fotos cargadas recientemente</p></div><Camera size={20} /></div>{latestPhotos.length ? <div className="recent-photos">{latestPhotos.slice(0, 4).map((photo) => <figure key={photo.id}><Image src={photo.image_url} alt={photo.spaceName} width={320} height={180} unoptimized={photo.image_url.startsWith("blob:")} /><figcaption><strong>{photo.spaceName}</strong><span>{photo.photo_type}</span></figcaption></figure>)}</div> : <p className="dashboard-empty">No hay fotos cargadas.</p>}</section>
    </div>
  </div>;
}
