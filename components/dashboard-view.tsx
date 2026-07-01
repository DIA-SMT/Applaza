"use client";

import Image from "next/image";
import { useState } from "react";
import { Building2, Camera, ChevronRight, ClipboardCheck, Clock3, LayoutDashboard, LogOut, Map, Menu, Trees, TriangleAlert, UsersRound } from "lucide-react";
import type { Provider, SpaceRecord, UserProfile } from "@/types/domain";
import { statusColors } from "./status-badge";
import { OperationalMap } from "./operational-map";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type View = "dashboard" | "map";

export function DashboardView({ initialSpaces, providers, currentUser, dataError }: { initialSpaces: SpaceRecord[]; providers: Provider[]; currentUser: UserProfile; dataError: string | null }) {
  const [view, setView] = useState<View>("dashboard");
  const [spaces, setSpaces] = useState(initialSpaces);
  const stats = [
    { label: "Espacios relevados", value: spaces.length, icon: Trees, tone: "blue" },
    { label: "En curso", value: spaces.filter((space) => space.status === "en_curso").length, icon: Clock3, tone: "cyan" },
    { label: "Finalizados", value: spaces.filter((space) => space.status === "finalizado").length, icon: ClipboardCheck, tone: "green" },
    { label: "Vencidos", value: spaces.filter((space) => space.status === "vencido").length, icon: TriangleAlert, tone: "red" },
    { label: "Proveedores activos", value: providers.filter((provider) => provider.active).length, icon: UsersRound, tone: "purple" },
  ];
  const latestPhotos = spaces.flatMap((space) => space.photos.map((photo) => ({ ...photo, spaceName: space.name }))).sort((left, right) => right.created_at.localeCompare(left.created_at));

  async function signOut() { await getSupabaseBrowserClient()?.auth.signOut(); window.location.href = "/login"; }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Image src="/logo-municipal.png" alt="Municipalidad de San Miguel de Tucumán" width={42} height={42} priority /></div><div><strong>Applaza</strong><span>Gestión de espacios verdes</span></div></div>
      <nav><button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}><LayoutDashboard />Resumen</button><button className={view === "map" ? "active" : ""} onClick={() => setView("map")}><Map />Mapa operativo</button></nav>
      <div className="sidebar-foot"><Building2 /><div><strong>Municipalidad de SMT</strong><span>Gestión Ambiental</span></div></div>
    </aside>
    <main className="main">
      <header className="topbar"><button className="mobile-menu"><Menu /></button><div><span>San Miguel de Tucumán</span><strong>{view === "dashboard" ? "Panel de control" : "Mapa operativo"}</strong></div><div className="user"><span>{currentUser.full_name.slice(0, 2).toUpperCase()}</span><div><strong>{currentUser.full_name}</strong><small>{currentUser.role === "admin" ? "Administración" : currentUser.role === "supervisor" ? "Supervisión" : currentUser.role === "inspector" ? "Inspección" : "Proveedor"}</small></div><button className="logout-button" onClick={signOut} title="Cerrar sesión"><LogOut size={17} /></button></div></header>
      {view === "map" ? <OperationalMap spaces={spaces} providers={providers} currentUser={currentUser} dataError={dataError} setSpaces={setSpaces} /> : <Dashboard spaces={spaces} providers={providers} stats={stats} latestPhotos={latestPhotos} dataError={dataError} onOpenMap={() => setView("map")} />}
    </main>
  </div>;
}

function Dashboard({ spaces, stats, latestPhotos, dataError, onOpenMap }: { spaces: SpaceRecord[]; providers: Provider[]; stats: Array<{ label: string; value: number; icon: typeof Trees; tone: string }>; latestPhotos: Array<{ id: string; image_url: string; photo_type: string; spaceName: string }>; dataError: string | null; onOpenMap: () => void }) {
  const recentTasks = spaces.filter((space) => space.task).slice(0, 6);
  return <div className="content dashboard">
    <div className="page-heading"><div><p>OPERACIÓN MUNICIPAL</p><h1>Estado general</h1><span>Seguimiento actualizado de espacios verdes y mantenimientos.</span></div><button className="primary" onClick={onOpenMap}><Map size={17} />Abrir mapa</button></div>
    {dataError && <div className="dashboard-error"><TriangleAlert size={18} /><div><strong>No se pudieron actualizar los datos</strong><span>{dataError}</span></div></div>}
    <div className="stats-grid">{stats.map(({ label, value, icon: Icon, tone }) => <article className="stat-card" key={label}><div className={`stat-icon ${tone}`}><Icon /></div><div><span>{label}</span><strong>{value}</strong></div></article>)}</div>
    <div className="dashboard-grid">
      <section className="card"><div className="card-title"><div><h2>Mantenimientos recientes</h2><p>Situación de las tareas activas</p></div><button onClick={onOpenMap}>Ver mapa <ChevronRight size={16} /></button></div>{recentTasks.length ? <div className="task-list">{recentTasks.map((space) => <button key={space.id} onClick={onOpenMap}><span className="space-dot" style={{ background: statusColors[space.status] }} /><div><strong>{space.name}</strong><small>{space.provider?.name || "Sin proveedor asignado"}</small></div><span className={`status status-${space.status}`}>{space.status.replace("_", " ")}</span><ChevronRight size={17} /></button>)}</div> : <p className="dashboard-empty">No hay mantenimientos activos.</p>}</section>
      <section className="card"><div className="card-title"><div><h2>Últimas evidencias</h2><p>Fotos cargadas recientemente</p></div><Camera size={20} /></div>{latestPhotos.length ? <div className="recent-photos">{latestPhotos.slice(0, 4).map((photo) => <figure key={photo.id}><Image src={photo.image_url} alt={photo.spaceName} width={320} height={180} unoptimized={photo.image_url.startsWith("blob:")} /><figcaption><strong>{photo.spaceName}</strong><span>{photo.photo_type}</span></figcaption></figure>)}</div> : <p className="dashboard-empty">No hay fotos cargadas.</p>}</section>
    </div>
  </div>;
}
