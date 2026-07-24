"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { CalendarDays, Crosshair, LoaderCircle, MapPin, Pencil, Save, Trash2, UserRound, X } from "lucide-react";
import type { Fulfilled, MaintenancePhoto, MaintenanceStatus, Provider, SpaceRecord, SpaceType, UserProfile } from "@/types/domain";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { photoTypeLabel } from "@/lib/photo-label";
import { StatusBadge } from "./status-badge";
import { PhotoUpload } from "./photo-upload";

const typeLabel = { plaza: "Plaza", espacio_verde: "Espacio verde", platabanda: "Platabanda" };
const fulfilledLabel = { si: "Sí", no: "No", pendiente: "Pendiente" };
const date = (value?: string | null) => value ? new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value)) : "—";

export function SpaceDetail({ space, providers, currentUser, onClose, onPhoto, onUpdate, onRelocate }: { space: SpaceRecord; providers: Provider[]; currentUser: UserProfile; onClose: () => void; onPhoto: (photo: MaintenancePhoto) => void; onUpdate: (space: SpaceRecord) => void; onRelocate: (space: SpaceRecord) => void }) {
  const canEdit = currentUser.role === "admin" || currentUser.role === "supervisor" || currentUser.role === "inspector";
  const [expanded, setExpanded] = useState(false); const [editing, setEditing] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const [name, setName] = useState(space.name); const [spaceType, setSpaceType] = useState<SpaceType>(space.type); const [address, setAddress] = useState(space.address || ""); const [neighborhood, setNeighborhood] = useState(space.neighborhood || "");
  const [providerId, setProviderId] = useState(space.provider?.id || ""); const [status, setStatus] = useState<MaintenanceStatus>(space.status); const [startDate, setStartDate] = useState(space.task?.start_date || ""); const [endDate, setEndDate] = useState(space.task?.end_date || ""); const [fulfilled, setFulfilled] = useState<Fulfilled>(space.task?.fulfilled || "pendiente"); const [observations, setObservations] = useState(space.task?.observations || "");
  const [viewerPhoto, setViewerPhoto] = useState<MaintenancePhoto>(); const [deleteConfirm, setDeleteConfirm] = useState(false); const [deleteBusy, setDeleteBusy] = useState(false); const [deleteError, setDeleteError] = useState("");
  const canDeleteViewerPhoto = Boolean(viewerPhoto && !viewerPhoto.image_url.startsWith("blob:") && (currentUser.role === "admin" || currentUser.role === "supervisor" || currentUser.role === "auditor" || viewerPhoto.uploaded_by === currentUser.id));

  useEffect(() => {
    if (!viewerPhoto) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closeViewer(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerPhoto]);

  function openViewer(photo: MaintenancePhoto) { setViewerPhoto(photo); setDeleteConfirm(false); setDeleteError(""); }
  function closeViewer() { if (deleteBusy) return; setViewerPhoto(undefined); setDeleteConfirm(false); setDeleteError(""); }
  async function deleteViewerPhoto() {
    if (!viewerPhoto) return;
    setDeleteBusy(true); setDeleteError("");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setDeleteError("Supabase no está configurado."); setDeleteBusy(false); return; }
    const { error: deleteRowError } = await supabase.from("maintenance_photos").delete().eq("id", viewerPhoto.id);
    if (deleteRowError) { setDeleteError(/policy|permission|denied|row-level/i.test(deleteRowError.message) ? "La base todavía no permite borrar evidencias: hay que ejecutar supabase/staff_delete_photos.sql en Supabase." : deleteRowError.message); setDeleteBusy(false); return; }
    const marker = "/maintenance-photos/";
    const markerIndex = viewerPhoto.image_url.indexOf(marker);
    if (markerIndex >= 0) { const storagePath = decodeURIComponent(viewerPhoto.image_url.slice(markerIndex + marker.length).split("?")[0]); await supabase.storage.from("maintenance-photos").remove([storagePath]); }
    onUpdate({ ...space, photos: space.photos.filter((photo) => photo.id !== viewerPhoto.id) });
    setDeleteBusy(false); setDeleteConfirm(false); setViewerPhoto(undefined);
  }

  function beginEdit() { setName(space.name); setSpaceType(space.type); setAddress(space.address || ""); setNeighborhood(space.neighborhood || ""); setProviderId(space.provider?.id || ""); setStatus(space.status); setStartDate(space.task?.start_date || ""); setEndDate(space.task?.end_date || ""); setFulfilled(space.task?.fulfilled || "pendiente"); setObservations(space.task?.observations || ""); setError(""); setEditing(true); }
  async function save() {
    if (!name.trim()) { setError("El nombre es obligatorio."); return; }
    if (startDate && endDate && endDate < startDate) { setError("La fecha final no puede ser anterior al inicio."); return; }
    const supabase = getSupabaseBrowserClient(); if (!supabase) { setError("Supabase no está configurado."); return; }
    setSaving(true); setError("");
    const { error: spaceError } = await supabase.from("green_spaces").update({ name: name.trim(), type: spaceType, address: address.trim(), neighborhood: neighborhood.trim(), status }).eq("id", space.id);
    if (spaceError) { setError(spaceError.message); setSaving(false); return; }
    if (space.task) {
      const { error: taskError } = await supabase.from("maintenance_tasks").update({ provider_id: providerId || null, start_date: startDate, end_date: endDate, status, fulfilled, observations: observations.trim() }).eq("id", space.task.id);
      if (taskError) { setError(taskError.message); setSaving(false); return; }
    }
    const provider = providers.find((item) => item.id === providerId);
    onUpdate({ ...space, name: name.trim(), type: spaceType, address: address.trim(), neighborhood: neighborhood.trim(), status, provider, task: space.task ? { ...space.task, provider_id: providerId, start_date: startDate, end_date: endDate, status, fulfilled, observations: observations.trim() } : undefined });
    setSaving(false); setEditing(false);
  }

  return <aside className="detail-panel">
    <div className="detail-cover"><button className="icon-button close" onClick={onClose} aria-label="Cerrar"><X size={20} /></button><div className="cover-label">{space.source_type || typeLabel[space.type]}</div><h2>{space.name}</h2><StatusBadge status={space.status} />{canEdit && !editing && <button className="detail-edit-trigger" onClick={beginEdit}><Pencil size={14} />Editar información</button>}</div>
    <div className="detail-scroll">
      {editing ? <div className="detail-edit-form">
        <div className="detail-form-heading"><div><strong>Editar ficha operativa</strong><span>Los cambios se guardan en Supabase.</span></div><button onClick={() => setEditing(false)}><X size={16} /></button></div>
        <label>Nombre<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <div className="detail-form-grid"><label>Tipo<select value={spaceType} onChange={(event) => setSpaceType(event.target.value as SpaceType)}><option value="plaza">Plaza</option><option value="espacio_verde">Espacio verde</option><option value="platabanda">Platabanda</option></select></label><label>Estado<select value={status} onChange={(event) => setStatus(event.target.value as MaintenanceStatus)}><option value="programado">Programado</option><option value="en_curso">En curso</option><option value="finalizado">Finalizado</option><option value="vencido">Vencido</option><option value="observado">Observado</option><option value="incumplido">Incumplido</option></select></label></div>
        <label>Dirección o referencia<input value={address} onChange={(event) => setAddress(event.target.value)} /><small>Cambiar este texto no mueve el punto del mapa.</small></label>
        <label>Barrio o zona<input value={neighborhood} onChange={(event) => setNeighborhood(event.target.value)} /></label>
        <label>Proveedor<select value={providerId} disabled={!space.task} onChange={(event) => setProviderId(event.target.value)}><option value="">Sin asignar</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select>{!space.task && <small>Creá un mantenimiento para asignar proveedor.</small>}</label>
        <div className="detail-form-grid"><label>Fecha de inicio<input type="date" value={startDate} disabled={!space.task} onChange={(event) => setStartDate(event.target.value)} /></label><label>Fin previsto<input type="date" value={endDate} disabled={!space.task} onChange={(event) => setEndDate(event.target.value)} /></label></div>
        <label>Cumplimiento<select value={fulfilled} disabled={!space.task} onChange={(event) => setFulfilled(event.target.value as Fulfilled)}><option value="pendiente">Pendiente</option><option value="si">Sí</option><option value="no">No</option></select></label>
        <label>Observaciones<textarea rows={4} value={observations} disabled={!space.task} onChange={(event) => setObservations(event.target.value)} /></label>
        {error && <p className="detail-form-error">{error}</p>}
        <div className="detail-form-actions"><button onClick={() => setEditing(false)}>Cancelar</button><button className="primary-save" disabled={saving} onClick={save}>{saving ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}Guardar cambios</button></div>
      </div> : <>
        <div className="info-line"><MapPin size={18} /><div><small>Ubicación</small><strong>{space.address}</strong><span>{space.neighborhood}</span></div></div>
        {canEdit && <button className="relocate-button" onClick={() => onRelocate(space)}><Crosshair size={16} /><div><strong>Corregir ubicación en el mapa</strong><span>{space.latitude != null && space.longitude != null ? `${space.latitude.toFixed(5)}, ${space.longitude.toFixed(5)}` : "Este espacio todavía no tiene coordenadas"}</span></div></button>}
        {(space.section_code || space.surface_m2) && <div className="detail-info-grid"><div className="detail-info-card"><small>Sección</small><strong>{space.section_code || "—"}</strong></div><div className="detail-info-card"><small>Superficie</small><strong>{space.surface_m2 ? `${space.surface_m2.toLocaleString("es-AR")} m²` : "—"}</strong></div></div>}
        <div className="info-line"><UserRound size={18} /><div><small>Cooperativa asignada</small><strong>{space.provider?.name ?? "Sin asignar"}</strong><span>{space.provider?.contact_name}</span></div></div>
        <div className="date-grid"><div><CalendarDays size={16} /><small>Inicio</small><strong>{date(space.task?.start_date)}</strong></div><div><CalendarDays size={16} /><small>Fin previsto</small><strong>{date(space.task?.end_date)}</strong></div></div>
        <div className="compliance"><span>Cumplimiento</span><strong className={`fulfilled-${space.task?.fulfilled}`}>{fulfilledLabel[space.task?.fulfilled ?? "pendiente"]}</strong></div>
        <button className="detail-expand" onClick={() => setExpanded((value) => !value)}>{expanded ? "Ocultar detalle" : "Ver detalle"}</button>
        {expanded && <div className="detail-metadata"><div><small>Identificador</small><strong>{space.id.slice(0, 8)}</strong></div><div><small>Coordenadas</small><strong>{space.latitude != null && space.longitude != null ? `${space.latitude.toFixed(5)}, ${space.longitude.toFixed(5)}` : "Sin ubicación"}</strong></div><div><small>Fuente</small><strong>{space.section_code ? `Padrón · Sección ${space.section_code}` : "Registro operativo"}</strong></div></div>}
        <section><h3>Observaciones</h3><p className="observations">{space.task?.observations || "Sin observaciones registradas."}</p></section>
        <section><div className="section-title"><h3>Evidencias fotográficas</h3><span>{space.photos.length}</span></div>{space.photos.length ? <div className="photo-grid">{space.photos.map((photo) => <figure key={photo.id}><button className="photo-thumb" onClick={() => openViewer(photo)} aria-label={`Ver evidencia ${photoTypeLabel(photo.photo_type)} en grande`}><Image src={photo.image_url} alt={`Evidencia ${photoTypeLabel(photo.photo_type)}`} width={180} height={120} unoptimized={photo.image_url.startsWith("blob:")} /></button><figcaption>{photoTypeLabel(photo.photo_type)}</figcaption></figure>)}</div> : <p className="empty">Todavía no hay fotos asociadas.</p>}</section>
        {space.task && <PhotoUpload taskId={space.task.id} spaceName={space.name} onUploaded={onPhoto} />}
      </>}
    </div>

    {viewerPhoto && <div className="photo-lightbox" role="dialog" aria-modal="true" aria-label={`Evidencia de ${space.name}`} onClick={closeViewer}>
      <div className="photo-lightbox-panel" onClick={(event) => event.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={viewerPhoto.image_url} alt={`${space.name} - ${photoTypeLabel(viewerPhoto.photo_type)}`} />
        <div className="photo-lightbox-bar">
          <div><strong>{space.name}</strong><span>{photoTypeLabel(viewerPhoto.photo_type)} · {date(viewerPhoto.created_at)}{viewerPhoto.image_url.startsWith("blob:") ? " · pendiente de sincronizar" : ""}</span></div>
          <div className="photo-lightbox-actions">
            {canDeleteViewerPhoto && !deleteConfirm && <button className="photo-delete" onClick={() => setDeleteConfirm(true)}><Trash2 size={15} />Eliminar</button>}
            {canDeleteViewerPhoto && deleteConfirm && <>
              <span className="photo-delete-confirm-label">¿Borrar esta foto? No se puede deshacer.</span>
              <button className="photo-delete confirm" disabled={deleteBusy} onClick={() => void deleteViewerPhoto()}>{deleteBusy ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />}Borrar definitivamente</button>
              <button className="photo-delete-cancel" disabled={deleteBusy} onClick={() => setDeleteConfirm(false)}>Cancelar</button>
            </>}
            <button className="photo-lightbox-close" onClick={closeViewer} aria-label="Cerrar visor"><X size={17} /></button>
          </div>
        </div>
        {deleteError && <p className="photo-lightbox-error">{deleteError}</p>}
      </div>
    </div>}
  </aside>;
}
