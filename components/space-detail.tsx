"use client";
import { CalendarDays, MapPin, UserRound, X } from "lucide-react";
import Image from "next/image";
import type { MaintenancePhoto, SpaceRecord } from "@/types/domain";
import { StatusBadge } from "./status-badge";
import { PhotoUpload } from "./photo-upload";

const typeLabel = { plaza: "Plaza", espacio_verde: "Espacio verde", platabanda: "Platabanda" };
const fulfilledLabel = { si: "Sí", no: "No", pendiente: "Pendiente" };
const date = (value?: string | null) => value ? new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value)) : "—";
export function SpaceDetail({ space, onClose, onPhoto }: { space: SpaceRecord; onClose: () => void; onPhoto: (photo: MaintenancePhoto) => void }) {
  return <aside className="detail-panel">
    <div className="detail-cover"><button className="icon-button close" onClick={onClose} aria-label="Cerrar"><X size={20} /></button><div className="cover-label">{space.source_type || typeLabel[space.type]}</div><h2>{space.name}</h2><StatusBadge status={space.status} /></div>
    <div className="detail-scroll">
      <div className="info-line"><MapPin size={18} /><div><small>Ubicación</small><strong>{space.address}</strong><span>{space.neighborhood}</span></div></div>
      {(space.section_code || space.surface_m2) && <div className="date-grid"><div><small>Sección</small><strong>{space.section_code || "—"}</strong></div><div><small>Superficie</small><strong>{space.surface_m2 ? `${space.surface_m2.toLocaleString("es-AR")} m²` : "—"}</strong></div></div>}
      <div className="info-line"><UserRound size={18} /><div><small>Proveedor asignado</small><strong>{space.provider?.name ?? "Sin asignar"}</strong><span>{space.provider?.contact_name}</span></div></div>
      <div className="date-grid"><div><CalendarDays size={16} /><small>Inicio</small><strong>{date(space.task?.start_date)}</strong></div><div><CalendarDays size={16} /><small>Fin previsto</small><strong>{date(space.task?.end_date)}</strong></div></div>
      <div className="compliance"><span>Cumplimiento</span><strong className={`fulfilled-${space.task?.fulfilled}`}>{fulfilledLabel[space.task?.fulfilled ?? "pendiente"]}</strong></div>
      <section><h3>Observaciones</h3><p className="observations">{space.task?.observations || "Sin observaciones registradas."}</p></section>
      <section><div className="section-title"><h3>Evidencias fotográficas</h3><span>{space.photos.length}</span></div>{space.photos.length ? <div className="photo-grid">{space.photos.map((photo) => <figure key={photo.id}><Image src={photo.image_url} alt={`Evidencia ${photo.photo_type}`} width={180} height={120} unoptimized={photo.image_url.startsWith("blob:")} /><figcaption>{photo.photo_type}</figcaption></figure>)}</div> : <p className="empty">Todavía no hay fotos asociadas.</p>}</section>
      {space.task && <PhotoUpload taskId={space.task.id} onUploaded={onPhoto} />}
    </div>
  </aside>;
}
