"use client";

import { useEffect, useMemo, useState } from "react";
import type { jsPDF } from "jspdf";
import { AlertCircle, CalendarDays, Camera, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Download, FileSearch, ListFilter, LoaderCircle, MessageSquarePlus, Route, ShieldCheck, Trash2, TriangleAlert, X } from "lucide-react";
import type { Provider, SpaceRecord, UserProfile } from "@/types/domain";
import { buildEstimatedDistanceReport, filterEstimatedDistanceReport, findMostProductiveDistanceDay, formatEstimatedKm, type EstimatedDistanceReport } from "@/lib/estimated-distance";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { photoTypeLabel } from "@/lib/photo-label";
import { createBrandedPdf, downloadPdfFile, drawPdfHeader, drawPdfInfoBox, fitPdfText, setPdfFont } from "@/lib/branded-pdf";
import { DistanceReportContent, formatDistanceDay } from "./distance-report-content";

type ControlValue = "si" | "no" | null;
type ControlRecord = {
  id: string;
  provider_id: string;
  green_space_id: string;
  period_month: string;
  control_1: ControlValue;
  control_1_date: string | null;
  control_2: ControlValue;
  control_2_date: string | null;
  control_3: ControlValue;
  control_3_date: string | null;
  created_at?: string;
  updated_at?: string;
};
type MetricKey = "assigned" | "reviewed" | "observed" | "evidence" | "distance";
type ProviderRow = ReturnType<typeof buildAudit>["providerRows"][number];
type AuditObservation = {
  id: string;
  green_space_id: string;
  provider_id: string | null;
  period_month: string;
  observation: string;
  created_by: string | null;
  created_at: string;
};
type AuditObservationItem = AuditObservation & { space?: SpaceRecord };
type PhotoViewerItem = { id: string; url: string; type: string; createdAt: string; title: string; subtitle: string };
type PhotoViewerState = { items: PhotoViewerItem[]; index: number };
const controlKeys = ["control_1", "control_2", "control_3"] as const;

export function AuditDashboard({ spaces, providers, currentUser, userProfiles, onPhotoDeleted, mode = "audit" }: { spaces: SpaceRecord[]; providers: Provider[]; currentUser: UserProfile; userProfiles: UserProfile[]; onPhotoDeleted?: (photoId: string) => void; mode?: "audit" | "reports" }) {
  const [month, setMonth] = useState(currentMonth());
  const [records, setRecords] = useState<ControlRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string>("all");
  const [activeMetric, setActiveMetric] = useState<MetricKey>("assigned");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [observations, setObservations] = useState<AuditObservation[]>([]);
  const [observationsError, setObservationsError] = useState<string | null>(null);
  const [selectedEvidenceSpaceId, setSelectedEvidenceSpaceId] = useState("");
  const [selectedDistanceDay, setSelectedDistanceDay] = useState("all");
  const [photoViewer, setPhotoViewer] = useState<PhotoViewerState>();
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const canDeletePhotos = mode === "audit" && (currentUser.role === "admin" || currentUser.role === "supervisor" || currentUser.role === "auditor");

  useEffect(() => {
    let active = true;

    async function loadRecords() {
      setLoading(true);
      setError(null);
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setRecords([]);
        setError("Supabase no esta configurado.");
        setLoading(false);
        return;
      }

      const { data, error: queryError } = await supabase
        .from("control_records")
        .select("*")
        .eq("period_month", `${month}-01`)
        .order("updated_at", { ascending: false });

      if (!active) return;
      if (queryError) {
        setRecords([]);
        setError("No se pudieron cargar los registros de control.");
      } else {
        setRecords((data ?? []) as ControlRecord[]);
      }
      setLoading(false);
    }

    loadRecords();
    return () => {
      active = false;
    };
  }, [month]);

  useEffect(() => {
    let active = true;

    async function loadObservations() {
      setObservationsError(null);
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;

      const { data, error: queryError } = await supabase
        .from("audit_observations")
        .select("*")
        .eq("period_month", `${month}-01`)
        .order("created_at", { ascending: false });

      if (!active) return;
      if (queryError) {
        setObservations([]);
        setObservationsError("Para ver observaciones ejecuta el SQL de audit_observations.");
      } else {
        setObservations((data ?? []) as AuditObservation[]);
      }
    }

    loadObservations();
    return () => {
      active = false;
    };
  }, [month]);

  const audit = useMemo(() => buildAudit(spaces, providers, records, month), [spaces, providers, records, month]);
  const selectedRow = audit.providerRows.find((row) => row.provider.id === selectedProviderId);
  const report = selectedRow ?? audit.totalRow;
  const reportView = useMemo(() => buildReportView(report, activeMetric), [report, activeMetric]);
  const observationItems = useMemo(() => observations
    .map((observation) => ({ ...observation, space: spaces.find((space) => space.id === observation.green_space_id) }))
    .filter((observation) => selectedProviderId === "all" || observation.space?.provider?.id === selectedProviderId), [observations, selectedProviderId, spaces]);
  const recentEvidence = useMemo(() => spaces
    .filter((space) => selectedProviderId === "all" || space.provider?.id === selectedProviderId)
    .flatMap((space) => space.photos.filter((photo) => isInMonth(photo.created_at, month)).map((photo) => ({
      ...photo,
      spaceName: space.name,
      providerName: space.provider?.name ?? "Sin cooperativa",
      neighborhood: space.neighborhood || "Sin barrio",
    })))
    .sort((left, right) => right.created_at.localeCompare(left.created_at)), [spaces, selectedProviderId, month]);
  const distanceSpaces = useMemo(() => spaces.filter((space) => selectedProviderId === "all" || space.provider?.id === selectedProviderId), [spaces, selectedProviderId]);
  const distanceReport = useMemo(() => buildEstimatedDistanceReport(distanceSpaces, userProfiles, currentUser, month), [distanceSpaces, userProfiles, currentUser, month]);
  const visibleDistanceReport = useMemo(() => filterEstimatedDistanceReport(distanceReport, selectedDistanceDay), [distanceReport, selectedDistanceDay]);
  const productiveDistanceDay = useMemo(() => findMostProductiveDistanceDay(distanceReport), [distanceReport]);
  const commandSummary = activeMetric === "observed"
    ? `${observationItems.length} observaciones cargadas por supervision`
    : activeMetric === "distance"
      ? `${formatEstimatedKm(visibleDistanceReport.totalKm)} km estimados - ${visibleDistanceReport.routeCount} jornadas`
      : reportView.summary;
  const periodLabel = formatMonth(month);
  const canExport = activeMetric === "observed" ? observationItems.length > 0 : activeMetric === "distance" ? visibleDistanceReport.routes.length > 0 : reportView.spacesDetail.length > 0;
  const exportLabel = activeMetric === "evidence" ? "Descargar book" : activeMetric === "observed" ? "Descargar observaciones" : activeMetric === "distance" ? "Descargar recorrido" : "Descargar PDF";
  const viewerPhoto = photoViewer?.items[photoViewer.index];

  useEffect(() => {
    setSelectedEvidenceSpaceId("");
    setSelectedDistanceDay("all");
  }, [month, selectedProviderId, activeMetric]);

  useEffect(() => {
    if (!photoViewer) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeViewer();
      if (event.key === "ArrowLeft") movePhoto(-1);
      if (event.key === "ArrowRight") movePhoto(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoViewer]);

  function openPhoto(item: PhotoViewerItem, gallery: PhotoViewerItem[] = [item]) {
    const index = Math.max(0, gallery.findIndex((galleryItem) => galleryItem.id === item.id));
    setPhotoViewer({ items: gallery, index });
    setDeleteConfirm(false);
    setDeleteError("");
  }

  function movePhoto(direction: -1 | 1) {
    setPhotoViewer((current) => {
      if (!current || current.items.length < 2) return current;
      return { ...current, index: (current.index + direction + current.items.length) % current.items.length };
    });
    setDeleteConfirm(false);
    setDeleteError("");
  }

  function closeViewer() {
    if (deleteBusy) return;
    setPhotoViewer(undefined);
    setDeleteConfirm(false);
    setDeleteError("");
  }

  async function deleteViewerPhoto() {
    if (!photoViewer) return;
    const viewerPhoto = photoViewer.items[photoViewer.index];
    setDeleteBusy(true);
    setDeleteError("");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setDeleteError("Supabase no esta configurado."); setDeleteBusy(false); return; }
    const { error: deleteRowError } = await supabase.from("maintenance_photos").delete().eq("id", viewerPhoto.id);
    if (deleteRowError) {
      setDeleteError(/policy|permission|denied|row-level/i.test(deleteRowError.message) ? "La base todavia no permite borrar evidencias: hay que ejecutar supabase/staff_delete_photos.sql en Supabase." : deleteRowError.message);
      setDeleteBusy(false);
      return;
    }
    const marker = "/maintenance-photos/";
    const markerIndex = viewerPhoto.url.indexOf(marker);
    if (markerIndex >= 0) {
      const storagePath = decodeURIComponent(viewerPhoto.url.slice(markerIndex + marker.length).split("?")[0]);
      await supabase.storage.from("maintenance-photos").remove([storagePath]);
    }
    onPhotoDeleted?.(viewerPhoto.id);
    setDeleteBusy(false);
    setDeleteConfirm(false);
    setPhotoViewer(undefined);
  }

  function changeMonth(direction: -1 | 1) {
    const date = new Date(`${month}-01T12:00:00`);
    date.setMonth(date.getMonth() + direction);
    setMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
  }

  function selectMetric(metric: MetricKey) {
    setActiveMetric(metric);
    if (metric === "assigned") {
      setSelectedProviderId("all");
    }
    if (metric === "observed") {
      setSelectedProviderId("all");
    }
    if (metric === "reviewed") {
      const firstReviewed = audit.providerRows.find((row) => row.reviewed > 0);
      if (firstReviewed) setSelectedProviderId(firstReviewed.provider.id);
    }
  }

  async function exportReport() {
    setExporting(true);
    setExportError("");
    try {
      if (activeMetric === "observed") {
        await downloadObservationsPdf({ month, period: periodLabel, title: report.title, observations: observationItems, currentUser });
      } else if (activeMetric === "evidence") {
        await downloadEvidenceBookPdf({ month, period: periodLabel, report: { ...report, spacesDetail: reportView.spacesDetail }, currentUser });
      } else if (activeMetric === "distance") {
        await downloadDistancePdf({ month, period: periodLabel, title: report.title, report: distanceReport, selectedDay: selectedDistanceDay, currentUser });
      } else {
        await downloadAuditPdf({ filterTitle: reportView.title, month, period: periodLabel, report: { ...report, spacesDetail: reportView.spacesDetail }, currentUser });
      }
    } catch {
      setExportError("No se pudo preparar el PDF. Intenta nuevamente.");
    } finally {
      setExporting(false);
    }
  }

  return <div className={`content audit-page ${mode === "reports" ? "reports-page" : ""}`}>
    <section className="audit-hero">
      <div>
        <p>{mode === "reports" ? "INFORMES MUNICIPALES" : "AUDITORIA MUNICIPAL"}</p>
        <h1>{mode === "reports" ? "Informes de gestion" : "Seguimiento de controles"}</h1>
        <span>{mode === "reports" ? "Selecciona el periodo y la cooperativa para revisar o descargar el informe." : "Elegis una cooperativa, revisas el informe y exportas el PDF cuando lo necesites."}</span>
      </div>
      <div className="audit-month-control">
        <button onClick={() => changeMonth(-1)} aria-label="Mes anterior"><ChevronLeft size={16} /></button>
        <label className="audit-month">
          <CalendarDays size={17} />
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} aria-label="Mes auditado" />
        </label>
        <button onClick={() => changeMonth(1)} aria-label="Mes siguiente"><ChevronRight size={16} /></button>
      </div>
    </section>

    {error && <div className="dashboard-error"><TriangleAlert size={18} /><div><strong>Revision limitada</strong><span>{error}</span></div></div>}

    <div className="audit-stat-grid">
      <AuditStat active={activeMetric === "assigned"} onClick={() => selectMetric("assigned")} icon={ClipboardList} label="Espacios asignados" value={audit.totalRow.spaces} note={`${audit.providersWithSpaces} cooperativas`} />
      <AuditStat active={activeMetric === "reviewed"} onClick={() => selectMetric("reviewed")} icon={CheckCircle2} label="Espacios controlados" value={audit.totalRow.reviewed} note={`${audit.coverage}% de cobertura`} />
      <AuditStat active={activeMetric === "observed"} onClick={() => selectMetric("observed")} icon={AlertCircle} label="Observaciones" value={observations.length} note="Notas de supervision" tone="warning" />
      <AuditStat active={activeMetric === "evidence"} onClick={() => selectMetric("evidence")} icon={FileSearch} label="Evidencias cargadas" value={audit.totalRow.photos} note={audit.latestPhoto ? `Ultima: ${formatDate(audit.latestPhoto)}` : "Sin fotos recientes"} />
      <AuditStat active={activeMetric === "distance"} onClick={() => selectMetric("distance")} icon={Route} label="Distancia estimada" value={`${formatEstimatedKm(distanceReport.totalKm)} km`} note={productiveDistanceDay ? `Mas activo: ${formatDistanceDay(productiveDistanceDay.day)}` : "Sin recorridos"} />
    </div>

    <section className="audit-command-panel">
      <div className="audit-selector">
        <span><ListFilter size={15} />Cooperativa</span>
        <select value={selectedProviderId} onChange={(event) => setSelectedProviderId(event.target.value)}>
          <option value="all">Todas las cooperativas</option>
          {audit.providerRows.map((row) => <option key={row.provider.id} value={row.provider.id}>{row.provider.name}</option>)}
        </select>
      </div>
      <div className="audit-command-summary">
        <strong>{report.title}</strong>
        <span>{periodLabel} - {loading ? "actualizando" : commandSummary}</span>
      </div>
      <button className="audit-export" onClick={exportReport} disabled={!canExport || exporting}>
        {exporting ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}{exportLabel}
      </button>
    </section>
    {exportError && <p className="audit-export-error" role="alert">{exportError}</p>}

    <div className="audit-layout focused">
      <section className="audit-panel audit-main-panel">
        <div className="audit-panel-title">
          <div>
            <h2>Informe</h2>
            <p>{activeMetric === "observed" ? "Observaciones operativas" : activeMetric === "distance" ? "Recorridos estimados" : reportView.title} - {selectedProviderId === "all" ? "Resumen general del periodo" : "Detalle de la cooperativa seleccionada"}</p>
          </div>
          <span className="audit-readonly"><ShieldCheck size={15} />Solo lectura</span>
        </div>

        <div className="audit-report">
          {activeMetric === "distance" ? <DistanceReportContent report={distanceReport} selectedDay={selectedDistanceDay} onDayChange={setSelectedDistanceDay} /> : <>
          <div className="audit-report-kpis">
            <span><b>{report.spaces}</b> espacios</span>
            <span><b>{formatNumber(report.surface)}</b> m2</span>
            <span><b>{report.reviewed}</b> controlados</span>
            <span><b>{report.pending}</b> pendientes</span>
            <span><b>{report.negative}</b> observados</span>
            <span><b>{report.photos}</b> evidencias</span>
          </div>

          {activeMetric === "observed" ? (
            <AuditObservationReview items={observationItems} error={observationsError} />
          ) : activeMetric === "evidence" ? (
            <EvidenceGallery spaces={reportView.spacesDetail} selectedId={selectedEvidenceSpaceId} onSelect={setSelectedEvidenceSpaceId} empty={reportView.empty} onOpenPhoto={openPhoto} />
          ) : (
            <div className="audit-space-list">
              {reportView.spacesDetail.map((space) => <article key={space.id} className={space.hasObservation ? "observed" : space.isReviewed ? "ready" : "pending"}>
                <div>
                  <strong>{space.name}</strong>
                  <span>{space.neighborhood || "Sin barrio"} - {formatNumber(space.surface)} m2{space.photos ? ` - ${space.photos} fotos` : ""}</span>
                </div>
                <div className="audit-control-dots">
                  {space.controls.map((control, index) => <span key={`${space.id}-${index}`} className={control ?? "empty"}>{control ? control.toUpperCase() : "-"}</span>)}
                </div>
                <small>{space.date ? formatDate(space.date) : "Sin registro"}</small>
              </article>)}
              {!reportView.spacesDetail.length && <p className="dashboard-empty">{reportView.empty}</p>}
            </div>
          )}</>}
        </div>
      </section>

      <aside className="audit-panel audit-side-panel">
        <div className="audit-panel-title compact">
          <div>
            <h2>Cooperativas</h2>
            <p>Botones rapidos</p>
          </div>
        </div>
        <div className="audit-provider-buttons">
          <button className={selectedProviderId === "all" ? "active" : ""} onClick={() => setSelectedProviderId("all")}>
            <span>Todas las cooperativas</span>
            <b className={audit.totalRow.statusTone}>{audit.totalRow.status}</b>
          </button>
          {audit.providerRows.map((row) => <button key={row.provider.id} className={selectedProviderId === row.provider.id ? "active" : ""} onClick={() => setSelectedProviderId(row.provider.id)}>
            <span>{row.provider.name}</span>
            <b className={row.statusTone}>{row.status}</b>
          </button>)}
        </div>
      </aside>
    </div>

    <section className="audit-panel audit-recent-evidence-panel">
      <div className="audit-panel-title">
        <div>
          <h2>Evidencias recientes</h2>
          <p>Ultimas fotos cargadas por supervisores o equipos de campo</p>
        </div>
        <span>{selectedProviderId === "all" ? "Todas" : report.title}</span>
      </div>
      <RecentEvidenceList items={recentEvidence} onOpenPhoto={openPhoto} />
    </section>

    <section className="audit-panel">
      <div className="audit-panel-title">
        <div>
          <h2>Ultima actividad</h2>
          <p>Movimientos recientes del registro de control</p>
        </div>
        <span>{mode === "reports" ? "Consulta general" : currentUser.role === "auditor" ? "Perfil auditor" : "Perfil administrador"}</span>
      </div>
      <div className="audit-activity">
        {audit.activity.map((item) => <div key={item.id}>
          <span>{item.spaceName}</span>
          <strong>{item.providerName}</strong>
          <small>{item.summary}</small>
          <time>{formatDate(item.date)}</time>
        </div>)}
        {!audit.activity.length && <p className="dashboard-empty">Todavia no hay registros guardados para este mes.</p>}
      </div>
    </section>

    {photoViewer && viewerPhoto && <div className="photo-lightbox" role="dialog" aria-modal="true" aria-label={`Evidencia de ${viewerPhoto.title}`} onClick={closeViewer}>
      <div className="photo-lightbox-panel" onClick={(event) => event.stopPropagation()}>
        <div className="photo-lightbox-stage">
          <img src={viewerPhoto.url} alt={`${viewerPhoto.title} - ${photoTypeLabel(viewerPhoto.type)}`} />
          {photoViewer.items.length > 1 && <>
            <button className="photo-lightbox-nav previous" onClick={() => movePhoto(-1)} aria-label="Foto anterior"><ChevronLeft size={22} /></button>
            <button className="photo-lightbox-nav next" onClick={() => movePhoto(1)} aria-label="Foto siguiente"><ChevronRight size={22} /></button>
            <span className="photo-lightbox-count">{photoViewer.index + 1} / {photoViewer.items.length}</span>
          </>}
        </div>
        <div className="photo-lightbox-bar">
          <div><strong>{viewerPhoto.title}</strong><span>{photoTypeLabel(viewerPhoto.type)} · {formatDate(viewerPhoto.createdAt)} {formatTime(viewerPhoto.createdAt)}{viewerPhoto.subtitle ? ` · ${viewerPhoto.subtitle}` : ""}</span></div>
          <div className="photo-lightbox-actions">
            {canDeletePhotos && !deleteConfirm && <button className="photo-delete" onClick={() => setDeleteConfirm(true)}><Trash2 size={15} />Eliminar</button>}
            {canDeletePhotos && deleteConfirm && <>
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
  </div>;
}

function AuditStat({ icon: Icon, label, value, note, tone = "default", active, onClick }: { icon: typeof ClipboardList; label: string; value: number | string; note: string; tone?: "default" | "warning"; active: boolean; onClick: () => void }) {
  return <button className={`audit-stat ${tone} ${active ? "active" : ""}`} onClick={onClick}>
    <div><Icon size={20} /></div>
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{note}</small>
  </button>;
}

function EvidenceGallery({ spaces, selectedId, onSelect, empty, onOpenPhoto }: { spaces: ProviderRow["spacesDetail"]; selectedId: string; onSelect: (id: string) => void; empty: string; onOpenPhoto: (photo: PhotoViewerItem, gallery?: PhotoViewerItem[]) => void }) {
  const selectedSpace = spaces.find((space) => space.id === selectedId) ?? spaces[0];
  const photoGroups = selectedSpace ? groupPhotosByDate(selectedSpace.photoItems) : [];
  const controlGroups = selectedSpace ? groupPhotosByControl(selectedSpace.photoItems) : [];
  const selectedGallery = selectedSpace?.photoItems.map((photo) => toViewerItem(photo, selectedSpace.name, selectedSpace.providerName || "")) ?? [];

  if (!spaces.length) return <p className="dashboard-empty">{empty}</p>;

  return <div className="audit-evidence-view">
    <div className="audit-gallery-grid">
      {spaces.map((space) => {
        const cover = space.photoItems[0];
        const gallery = space.photoItems.map((photo) => toViewerItem(photo, space.name, space.providerName || ""));
        const latestDate = cover?.createdAt ?? space.date;
        const isActive = selectedSpace?.id === space.id;
        return <article key={space.id} className={`audit-gallery-card ${isActive ? "active" : ""}`}>
          <button onClick={() => { onSelect(space.id); if (gallery[0]) onOpenPhoto(gallery[0], gallery); }} aria-pressed={isActive}>
            <div className="audit-gallery-cover">
              {cover ? <img src={cover.url} alt={space.name} /> : <span>Sin foto</span>}
              <div><Camera size={24} /><b>{space.photos} {space.photos === 1 ? "foto" : "fotos"}</b></div>
            </div>
            <div className="audit-gallery-body">
              <span>{latestDate ? formatDate(latestDate) : "Sin fecha"}</span>
              <strong>{space.name}</strong>
              <small>{space.providerName || "Sin cooperativa"}</small>
              <em>Ver fotos</em>
            </div>
          </button>
        </article>;
      })}
    </div>

    {selectedSpace && <section className="audit-photo-book">
      <div className="audit-photo-book-head">
        <div>
          <strong>{selectedSpace.name}</strong>
          <span>{selectedSpace.neighborhood || "Sin barrio"} - {selectedSpace.providerName || "Sin cooperativa"}</span>
        </div>
        <b>{selectedSpace.photos} {selectedSpace.photos === 1 ? "foto" : "fotos"}</b>
      </div>
      <div className="audit-photo-day-list">
        <div className="audit-control-photo-summary">
          {controlGroups.map((group) => <span key={group.type}><b>{group.photos.length}</b>{photoTypeLabel(group.type)}</span>)}
        </div>
        {photoGroups.map((group) => <div key={group.date} className="audit-photo-day">
          <div className="audit-photo-day-title">
            <CalendarDays size={15} />
            <strong>{formatDate(group.date)}</strong>
            <span>{group.photos.length} {group.photos.length === 1 ? "foto" : "fotos"}</span>
          </div>
          <div className="audit-photo-book-grid">
            {group.photos.map((photo) => <figure key={photo.id}>
              <button className="photo-thumb" onClick={() => onOpenPhoto(toViewerItem(photo, selectedSpace.name, selectedSpace.providerName || ""), selectedGallery)} aria-label={`Ver foto de ${selectedSpace.name} en grande`}>
                <img src={photo.url} alt={`${selectedSpace.name} - ${photo.type}`} />
              </button>
              <figcaption>
                <span>{photoTypeLabel(photo.type)}</span>
                <time>{formatTime(photo.createdAt)}</time>
              </figcaption>
            </figure>)}
          </div>
        </div>)}
      </div>
    </section>}
  </div>;
}

function toViewerItem(photo: { id: string; url: string; type: string; createdAt: string }, title: string, subtitle: string): PhotoViewerItem {
  return { id: photo.id, url: photo.url, type: photo.type, createdAt: photo.createdAt, title, subtitle };
}

function AuditObservationReview({ items, error }: { items: Array<AuditObservation & { space?: SpaceRecord }>; error: string | null }) {
  if (error) return <p className="audit-observation-note error">{error}</p>;

  return <div className="audit-observation-list audit-observation-review">
    {items.map((observation) => <article key={observation.id}>
      <MessageSquarePlus size={16} />
      <div>
        <strong>{observation.space?.name ?? "Espacio sin identificar"}</strong>
        <p>{observation.observation}</p>
        <span>{observation.space?.provider?.name ?? "Sin cooperativa"} - {formatDate(observation.created_at)}</span>
      </div>
    </article>)}
    {!items.length && <p className="dashboard-empty">Todavia no hay observaciones cargadas para esta seleccion.</p>}
  </div>;
}

function RecentEvidenceList({ items, onOpenPhoto }: { items: Array<{ id: string; image_url: string; photo_type: string; created_at: string; spaceName: string; providerName: string; neighborhood: string }>; onOpenPhoto: (photo: PhotoViewerItem) => void }) {
  if (!items.length) return <p className="dashboard-empty audit-evidence-empty">Todavia no hay evidencias cargadas para esta seleccion.</p>;
  const groups = groupPhotosByDate(items.map((photo) => ({
    id: photo.id,
    url: photo.image_url,
    type: photo.photo_type,
    createdAt: photo.created_at,
    spaceName: photo.spaceName,
    providerName: photo.providerName,
    neighborhood: photo.neighborhood,
  })));

  return <div className="audit-recent-evidence-days">
    {groups.map((group) => <div key={group.date} className="audit-recent-evidence-day">
      <div className="audit-photo-day-title">
        <CalendarDays size={15} />
        <strong>{formatDate(group.date)}</strong>
        <span>{group.photos.length} {group.photos.length === 1 ? "foto" : "fotos"}</span>
      </div>
      <div className="audit-recent-evidence-grid">
        {group.photos.map((photo) => <figure key={photo.id}>
          <button className="photo-thumb" onClick={() => onOpenPhoto({ id: photo.id, url: photo.url, type: photo.type, createdAt: photo.createdAt, title: photo.spaceName, subtitle: photo.providerName })} aria-label={`Ver foto de ${photo.spaceName} en grande`}>
            <img src={photo.url} alt={photo.spaceName} />
          </button>
          <figcaption>
            <span>{photoTypeLabel(photo.type)}</span>
            <strong>{photo.spaceName}</strong>
            <small>{photo.providerName} - {photo.neighborhood} - {formatTime(photo.createdAt)}</small>
          </figcaption>
        </figure>)}
      </div>
    </div>)}
  </div>;
}

function buildAudit(spaces: SpaceRecord[], providers: Provider[], records: ControlRecord[], month: string) {
  const spacesById = new Map(spaces.map((space) => [space.id, space]));
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const reviewedRecords = records.filter(hasAnyControl);
  const reviewedSpaceIds = new Set(reviewedRecords.map((record) => record.green_space_id));
  const photoDates = spaces.flatMap((space) => space.photos.filter((photo) => isInMonth(photo.created_at, month)).map((photo) => photo.created_at)).sort((left, right) => right.localeCompare(left));
  const recordsByProvider = new Map<string, ControlRecord[]>();
  const recordsBySpace = new Map<string, ControlRecord>();

  for (const record of records) {
    const current = recordsByProvider.get(record.provider_id) ?? [];
    current.push(record);
    recordsByProvider.set(record.provider_id, current);
    recordsBySpace.set(record.green_space_id, record);
  }

  const providersWithAssignedSpaces = providers
    .map((provider) => ({ provider, assignedSpaces: spaces.filter((space) => space.provider?.id === provider.id) }))
    .filter((row) => row.assignedSpaces.length > 0);

  const providerRows = providersWithAssignedSpaces.map(({ provider, assignedSpaces }) => buildProviderRow(provider, assignedSpaces, recordsByProvider.get(provider.id) ?? [], recordsBySpace, month))
    .sort((left, right) => right.negative - left.negative || right.pending - left.pending || left.provider.name.localeCompare(right.provider.name));

  const totalProvider: Provider = { id: "all", name: "Todas las cooperativas", contact_name: "", phone: "", email: "", active: true, created_at: "", updated_at: "" };
  const totalRow = buildProviderRow(totalProvider, spaces, records, recordsBySpace, month);
  const negativeControls = countControls(records, "no");
  const coverage = spaces.length ? Math.round((reviewedSpaceIds.size / spaces.length) * 100) : 0;

  const activity = reviewedRecords.slice(0, 8).map((record) => {
    const space = spacesById.get(record.green_space_id);
    const provider = providerById.get(record.provider_id);
    const positive = controlKeys.filter((key) => record[key] === "si").length;
    const negative = controlKeys.filter((key) => record[key] === "no").length;
    return {
      id: record.id,
      spaceName: space?.name ?? "Espacio sin identificar",
      providerName: provider?.name ?? "Cooperativa sin identificar",
      summary: `${positive} si - ${negative} no`,
      date: record.updated_at ?? record.created_at ?? record.period_month,
    };
  });

  return {
    totalRow,
    reviewedSpaces: reviewedSpaceIds.size,
    coverage,
    negativeControls,
    latestPhoto: photoDates[0],
    providersWithSpaces: providersWithAssignedSpaces.length,
    providerRows,
    activity,
  };
}

function buildProviderRow(provider: Provider, assignedSpaces: SpaceRecord[], providerRecords: ControlRecord[], recordsBySpace: Map<string, ControlRecord>, month: string) {
  const reviewed = new Set(providerRecords.filter(hasAnyControl).map((record) => record.green_space_id)).size;
  const pending = Math.max(assignedSpaces.length - reviewed, 0);
  const negative = countControls(providerRecords, "no");
  const photos = assignedSpaces.reduce((total, space) => total + space.photos.filter((photo) => isInMonth(photo.created_at, month)).length, 0);
  const surface = assignedSpaces.reduce((total, space) => total + (space.surface_m2 ?? 0), 0);
  const status = negative > 0 ? "Observado" : pending > 0 ? "Pendiente" : "Al dia";
  const statusTone = negative > 0 ? "danger" : pending > 0 ? "pending" : "ok";
  const spacesDetail = assignedSpaces.map((space) => {
    const record = recordsBySpace.get(space.id);
    const controls = record ? controlKeys.map((key) => record[key]) : [null, null, null];
    const controlDates = record ? [record.control_1_date, record.control_2_date, record.control_3_date] : [null, null, null];
    const dates = controlDates.filter(Boolean) as string[];
    const monthlyPhotos = space.photos
      .filter((photo) => isInMonth(photo.created_at, month))
      .sort((left, right) => right.created_at.localeCompare(left.created_at));

    return {
      id: space.id,
      name: space.name,
      neighborhood: space.neighborhood,
      surface: space.surface_m2 ?? 0,
      controls,
      isReviewed: controls.some(Boolean),
      hasObservation: controls.some((control) => control === "no"),
      photos: monthlyPhotos.length,
      photoItems: monthlyPhotos.map((photo) => ({
        id: photo.id,
        url: photo.image_url,
        type: photo.photo_type,
        createdAt: photo.created_at,
      })),
      providerName: space.provider?.name ?? (provider.id === "all" ? "Sin cooperativa" : provider.name),
      controlDates,
      date: dates.at(-1) ?? record?.updated_at ?? null,
    };
  }).sort((left, right) => Number(right.hasObservation) - Number(left.hasObservation) || Number(!left.isReviewed) - Number(!right.isReviewed) || left.name.localeCompare(right.name));

  return { provider, title: provider.name, spaces: assignedSpaces.length, surface, reviewed, pending, negative, photos, status, statusTone, spacesDetail };
}

function buildReportView(report: ProviderRow, metric: MetricKey) {
  if (metric === "reviewed") {
    const spacesDetail = report.spacesDetail.filter((space) => space.isReviewed);
    return {
      title: "Espacios controlados",
      summary: `${spacesDetail.length} de ${report.spaces} espacios con controles cargados`,
      empty: "No hay espacios controlados para esta seleccion.",
      spacesDetail,
    };
  }

  if (metric === "observed") {
    const spacesDetail = report.spacesDetail.filter((space) => space.hasObservation);
    return {
      title: "Observaciones",
      summary: `${spacesDetail.length} espacios con al menos una observacion`,
      empty: "No hay espacios observados para esta seleccion.",
      spacesDetail,
    };
  }

  if (metric === "evidence") {
    const spacesDetail = report.spacesDetail.filter((space) => space.photos > 0);
    return {
      title: "Evidencias cargadas",
      summary: `${spacesDetail.length} espacios con evidencia fotografica`,
      empty: "No hay evidencias cargadas para esta seleccion.",
      spacesDetail,
    };
  }

  return {
    title: "Espacios asignados",
    summary: `${report.spaces} espacios asignados - ${report.reviewed} controlados`,
    empty: "No hay espacios asignados para esta seleccion.",
    spacesDetail: report.spacesDetail,
  };
}

function countControls(records: ControlRecord[], value: "si" | "no") {
  return records.reduce((total, record) => total + controlKeys.filter((key) => record[key] === value).length, 0);
}

function hasAnyControl(record: ControlRecord) {
  return controlKeys.some((key) => record[key] === "si" || record[key] === "no");
}

async function downloadAuditPdf({ filterTitle, month, period, report, currentUser }: { filterTitle: string; month: string; period: string; report: ProviderRow; currentUser: UserProfile }) {
  const { doc, logo } = await createBrandedPdf();
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 36;
  const { from, to } = periodRange(month);
  const issuedAt = formatDate(new Date().toISOString());
  const groups = groupSpacesByProvider(report.spacesDetail);
  let page = 0;
  let y = 0;

  function startPage() {
    if (page > 0) doc.addPage();
    page += 1;
    drawPdfHeader(doc, logo, {
      title: "Informe de auditoria de espacios verdes",
      subtitle: `${period} | ${filterTitle}`,
      page,
      rightLabel: `Emitido ${issuedAt}`,
    });
    y = 108;
  }

  function drawGroupHeader(providerName: string, count: number, continued = false) {
    doc.setFillColor(232, 243, 255);
    doc.roundedRect(margin, y, width - margin * 2, 23, 4, 4, "F");
    setPdfFont(doc, 9, true, "#063f8c");
    doc.text(`${providerName}${continued ? " (continuacion)" : ""}`, margin + 10, y + 15);
    setPdfFont(doc, 7, false, "#52677e");
    doc.text(`${count} espacios`, width - margin - 10, y + 15, { align: "right" });
    y += 29;
    drawAuditTableHeader(doc, y);
    y += 20;
  }

  startPage();
  setPdfFont(doc, 11, true);
  doc.text("Resumen del informe", margin, y);
  y += 12;
  drawPdfInfoBox(doc, margin, y, 150, "Fecha de exportacion", issuedAt);
  drawPdfInfoBox(doc, margin + 158, y, 130, "Desde", from);
  drawPdfInfoBox(doc, margin + 296, y, 130, "Hasta", to);
  drawPdfInfoBox(doc, margin + 434, y, 170, "Emitido por", currentUser.full_name);
  drawPdfInfoBox(doc, margin + 612, y, 158, "Cooperativa", report.title);
  y += 48;
  drawPdfInfoBox(doc, margin, y, 112, "Espacios", report.spaces);
  drawPdfInfoBox(doc, margin + 120, y, 112, "Controlados", report.reviewed);
  drawPdfInfoBox(doc, margin + 240, y, 112, "Exportados", report.spacesDetail.length);
  drawPdfInfoBox(doc, margin + 360, y, 112, "Pendientes", report.pending);
  drawPdfInfoBox(doc, margin + 480, y, 112, "Observaciones", report.negative);
  drawPdfInfoBox(doc, margin + 600, y, 170, "Superficie", `${formatNumber(report.surface)} m2`);
  y += 58;
  setPdfFont(doc, 11, true);
  doc.text("Detalle por cooperativa", margin, y);
  y += 15;

  if (!groups.length) {
    doc.setFillColor(245, 249, 255);
    doc.roundedRect(margin, y, width - margin * 2, 46, 4, 4, "F");
    setPdfFont(doc, 9, false, "#65758b");
    doc.text("No hay registros para el filtro seleccionado.", margin + 12, y + 27);
  }

  for (const group of groups) {
    if (y + 72 > height - margin) startPage();
    drawGroupHeader(group.providerName, group.spaces.length);

    for (const space of group.spaces) {
      const rowHeight = 28;
      if (y + rowHeight > height - margin) {
        startPage();
        drawGroupHeader(group.providerName, group.spaces.length, true);
      }
      doc.setFillColor(space.hasObservation ? "#fff3f3" : space.isReviewed ? "#f2fff6" : "#fff9ed");
      doc.rect(margin, y, width - margin * 2, rowHeight, "F");
      setPdfFont(doc, 7.5, true);
      doc.text(fitPdfText(doc, space.name, 204), margin + 8, y + 11);
      setPdfFont(doc, 6.2, false, "#65758b");
      doc.text(fitPdfText(doc, space.neighborhood || "Sin barrio", 204), margin + 8, y + 22);
      setPdfFont(doc, 7, false);
      doc.text(formatNumber(space.surface), margin + 226, y + 17);
      setPdfFont(doc, 7, true, controlColor(space.controls[0]));
      doc.text(controlText(space.controls[0]), margin + 282, y + 17);
      setPdfFont(doc, 6.5);
      doc.text(formatOptionalDate(space.controlDates[0]), margin + 314, y + 17);
      setPdfFont(doc, 7, true, controlColor(space.controls[1]));
      doc.text(controlText(space.controls[1]), margin + 392, y + 17);
      setPdfFont(doc, 6.5);
      doc.text(formatOptionalDate(space.controlDates[1]), margin + 424, y + 17);
      setPdfFont(doc, 7, true, controlColor(space.controls[2]));
      doc.text(controlText(space.controls[2]), margin + 502, y + 17);
      setPdfFont(doc, 6.5);
      doc.text(formatOptionalDate(space.controlDates[2]), margin + 534, y + 17);
      doc.text(String(space.photos), margin + 742, y + 17);
      y += rowHeight + 3;
    }
    y += 7;
  }

  downloadPdfFile(doc, `informe-auditoria-${slug(report.title)}-${month}.pdf`);
}

async function downloadObservationsPdf({ month, period, title, observations, currentUser }: { month: string; period: string; title: string; observations: AuditObservationItem[]; currentUser: UserProfile }) {
  const { doc, logo } = await createBrandedPdf();
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 36;
  const { from, to } = periodRange(month);
  const issuedAt = formatDate(new Date().toISOString());
  let page = 0;
  let y = 0;

  function startPage() {
    if (page > 0) doc.addPage();
    page += 1;
    drawPdfHeader(doc, logo, {
      title: "Informe de observaciones de supervision",
      subtitle: `${period} | ${title}`,
      page,
      rightLabel: `Emitido ${issuedAt}`,
    });
    y = 108;
  }

  startPage();
  setPdfFont(doc, 11, true);
  doc.text("Resumen de observaciones", margin, y);
  y += 12;
  drawPdfInfoBox(doc, margin, y, 150, "Fecha de exportacion", issuedAt);
  drawPdfInfoBox(doc, margin + 158, y, 130, "Desde", from);
  drawPdfInfoBox(doc, margin + 296, y, 130, "Hasta", to);
  drawPdfInfoBox(doc, margin + 434, y, 170, "Emitido por", currentUser.full_name);
  drawPdfInfoBox(doc, margin + 612, y, 158, "Seleccion", title);
  y += 48;
  drawPdfInfoBox(doc, margin, y, 150, "Observaciones", observations.length);
  drawPdfInfoBox(doc, margin + 158, y, 240, "Origen", "Notas cargadas por supervision");
  y += 58;

  if (!observations.length) {
    doc.setFillColor(245, 249, 255);
    doc.roundedRect(margin, y, width - margin * 2, 46, 4, 4, "F");
    setPdfFont(doc, 9, false, "#65758b");
    doc.text("No hay observaciones para la seleccion actual.", margin + 12, y + 27);
  }

  for (const observation of observations) {
    const lines = doc.splitTextToSize(observation.observation, width - margin * 2 - 20).slice(0, 4) as string[];
    const rowHeight = 48 + lines.length * 10;
    if (y + rowHeight > height - margin) startPage();
    const spaceName = observation.space?.name ?? "Espacio sin identificar";
    const providerName = observation.space?.provider?.name ?? "Sin cooperativa";
    const reference = observation.space?.neighborhood || observation.space?.address || "Sin referencia";
    doc.setFillColor(245, 249, 255);
    doc.roundedRect(margin, y, width - margin * 2, rowHeight, 5, 5, "F");
    setPdfFont(doc, 9, true);
    doc.text(fitPdfText(doc, spaceName, width - margin * 2 - 150), margin + 10, y + 16);
    setPdfFont(doc, 7, false, "#65758b");
    doc.text(fitPdfText(doc, `${providerName} | ${reference}`, width - margin * 2 - 150), margin + 10, y + 30);
    doc.text(formatDate(observation.created_at), width - margin - 10, y + 16, { align: "right" });
    setPdfFont(doc, 7.5, false, "#26384f");
    lines.forEach((line, index) => doc.text(line, margin + 10, y + 47 + index * 10));
    y += rowHeight + 8;
  }

  downloadPdfFile(doc, `observaciones-${slug(title)}-${month}.pdf`);
}

async function downloadDistancePdf({
  month,
  period,
  title,
  report,
  selectedDay,
  currentUser,
}: {
  month: string;
  period: string;
  title: string;
  report: EstimatedDistanceReport;
  selectedDay: string;
  currentUser: UserProfile;
}) {
  const { doc, logo } = await createBrandedPdf();
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 36;
  const issuedAt = formatDate(new Date().toISOString());
  const visibleReport = filterEstimatedDistanceReport(report, selectedDay);
  const productiveDay = findMostProductiveDistanceDay(report);
  const periodTitle = selectedDay === "all" ? period : formatDistanceDay(selectedDay);
  let page = 0;
  let y = 0;

  function startPage() {
    if (page > 0) doc.addPage();
    page += 1;
    drawPdfHeader(doc, logo, {
      title: "Informe de recorridos estimados",
      subtitle: `${periodTitle} | ${title}`,
      page,
      rightLabel: `Emitido ${issuedAt}`,
    });
    y = 108;
  }

  function drawRouteHeader(userName: string, day: string, stops: number, distanceKm: number, continued = false) {
    doc.setFillColor(232, 243, 255);
    doc.roundedRect(margin, y, width - margin * 2, 24, 4, 4, "F");
    setPdfFont(doc, 8.5, true, "#063f8c");
    doc.text(fitPdfText(doc, `${userName}${continued ? " (continuacion)" : ""}`, 300), margin + 10, y + 15);
    setPdfFont(doc, 7, false, "#52677e");
    doc.text(`${formatDistanceDay(day)} | ${stops} espacios | ${formatEstimatedKm(distanceKm)} km`, width - margin - 10, y + 15, { align: "right" });
    y += 29;
    drawDistanceTableHeader(doc, y);
    y += 19;
  }

  startPage();
  setPdfFont(doc, 11, true);
  doc.text("Resumen del recorrido", margin, y);
  y += 12;
  drawPdfInfoBox(doc, margin, y, 150, "Fecha de exportacion", issuedAt);
  drawPdfInfoBox(doc, margin + 158, y, 170, "Periodo", periodTitle);
  drawPdfInfoBox(doc, margin + 336, y, 230, "Seleccion", title);
  drawPdfInfoBox(doc, margin + 574, y, 196, "Emitido por", currentUser.full_name);
  y += 48;
  drawPdfInfoBox(doc, margin, y, 170, "Distancia estimada", `${formatEstimatedKm(visibleReport.totalKm)} km`);
  drawPdfInfoBox(doc, margin + 178, y, 150, "Jornadas", visibleReport.routeCount);
  drawPdfInfoBox(doc, margin + 336, y, 150, "Personas", visibleReport.peopleCount);
  drawPdfInfoBox(doc, margin + 494, y, 276, "Dia mas productivo", productiveDay ? `${formatDistanceDay(productiveDay.day)} | ${productiveDay.stops} visitas` : "Sin datos");
  y += 58;
  setPdfFont(doc, 11, true);
  doc.text("Detalle de tramos", margin, y);
  y += 15;

  if (!visibleReport.routes.length) {
    doc.setFillColor(245, 249, 255);
    doc.roundedRect(margin, y, width - margin * 2, 46, 4, 4, "F");
    setPdfFont(doc, 9, false, "#65758b");
    doc.text("No hay recorridos para el filtro seleccionado.", margin + 12, y + 27);
  }

  for (const route of visibleReport.routes) {
    if (y + 68 > height - margin) startPage();
    drawRouteHeader(route.userName, route.day, route.stops, route.distanceKm);

    if (!route.legs.length) {
      doc.setFillColor(249, 251, 253);
      doc.rect(margin, y, width - margin * 2, 24, "F");
      setPdfFont(doc, 7, false, "#65758b");
      doc.text("Una visita registrada, sin un segundo espacio para calcular distancia.", margin + 10, y + 15);
      y += 30;
      continue;
    }

    for (const leg of route.legs) {
      if (y + 26 > height - margin) {
        startPage();
        drawRouteHeader(route.userName, route.day, route.stops, route.distanceKm, true);
      }
      doc.setFillColor(249, 251, 253);
      doc.rect(margin, y, width - margin * 2, 24, "F");
      setPdfFont(doc, 7.2, false, "#26384f");
      doc.text(fitPdfText(doc, leg.fromSpaceName, 310), margin + 10, y + 15);
      doc.text(fitPdfText(doc, leg.toSpaceName, 310), margin + 350, y + 15);
      setPdfFont(doc, 7.2, true, "#0759b8");
      doc.text(`${formatEstimatedKm(leg.distanceKm)} km`, width - margin - 10, y + 15, { align: "right" });
      y += 27;
    }
    y += 8;
  }

  if (y + 34 > height - margin) startPage();
  doc.setFillColor(255, 249, 232);
  doc.roundedRect(margin, y, width - margin * 2, 30, 4, 4, "F");
  setPdfFont(doc, 6.8, false, "#7c5a18");
  doc.text("Las distancias son lineales y estimadas entre las ubicaciones registradas en el padron. No representan el trayecto exacto por calles.", margin + 10, y + 18);

  const daySuffix = selectedDay === "all" ? month : selectedDay;
  downloadPdfFile(doc, `recorridos-${slug(title)}-${daySuffix}.pdf`);
}

async function downloadEvidenceBookPdf({ month, period, report, currentUser }: { month: string; period: string; report: ProviderRow; currentUser: UserProfile }) {
  const { doc, logo } = await createBrandedPdf();
  const width = doc.internal.pageSize.getWidth();
  const margin = 36;
  const issuedAt = formatDate(new Date().toISOString());
  const photos = report.spacesDetail.flatMap((space) => space.photoItems.map((photo) => ({
    ...photo,
    spaceName: space.name,
    providerName: space.providerName || "Sin cooperativa",
    neighborhood: space.neighborhood || "Sin barrio",
  })));
  const loadedPhotos = (await Promise.all(photos.map(loadPhotoForPdf))).filter((photo): photo is PdfPhoto => Boolean(photo));
  const pageGroups = chunk(loadedPhotos, 4);
  if (!pageGroups.length) pageGroups.push([]);

  pageGroups.forEach((group, pageIndex) => {
    if (pageIndex > 0) doc.addPage();
    drawPdfHeader(doc, logo, {
      title: "Book fotografico de evidencias",
      subtitle: `${period} | ${report.title}`,
      page: pageIndex + 1,
      rightLabel: `${issuedAt} | ${currentUser.full_name}`,
    });

    if (!group.length) {
      doc.setFillColor(245, 249, 255);
      doc.roundedRect(margin, 112, width - margin * 2, 62, 5, 5, "F");
      setPdfFont(doc, 11, true);
      doc.text("No hay fotos cargadas para esta seleccion.", margin + 16, 147);
      return;
    }

    group.forEach((photo, index) => {
      const height = doc.internal.pageSize.getHeight();
      const columnGap = 14;
      const rowGap = 14;
      const contentTop = 100;
      const contentBottom = 32;
      const cardWidth = (width - margin * 2 - columnGap) / 2;
      const cardHeight = (height - contentTop - contentBottom - rowGap) / 2;
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = margin + column * (cardWidth + columnGap);
      const y = contentTop + row * (cardHeight + rowGap);
      const metadataHeight = 54;
      const imagePadding = 6;
      const imageBoxWidth = cardWidth - imagePadding * 2;
      const imageBoxHeight = cardHeight - metadataHeight - imagePadding * 2;
      const fit = fitImage(photo.width, photo.height, imageBoxWidth, imageBoxHeight);

      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(215, 229, 244);
      doc.roundedRect(x, y, cardWidth, cardHeight, 7, 7, "FD");
      doc.setFillColor(241, 246, 252);
      doc.roundedRect(x + imagePadding, y + imagePadding, imageBoxWidth, imageBoxHeight, 4, 4, "F");
      doc.addImage(photo.dataUrl, "JPEG", x + imagePadding + fit.x, y + imagePadding + fit.y, fit.width, fit.height, undefined, "FAST");

      const metadataY = y + cardHeight - metadataHeight;
      doc.setDrawColor(231, 239, 248);
      doc.line(x, metadataY, x + cardWidth, metadataY);
      setPdfFont(doc, 8.5, true);
      doc.text(fitPdfText(doc, photo.spaceName, cardWidth - 16), x + 8, metadataY + 16);
      setPdfFont(doc, 6.7, false, "#65758b");
      doc.text(fitPdfText(doc, photo.providerName, cardWidth - 16), x + 8, metadataY + 30);
      setPdfFont(doc, 6.7, true, "#0166ff");
      doc.text(fitPdfText(doc, `${photoTypeLabel(photo.type).toUpperCase()} | ${formatDate(photo.createdAt)} | ${photo.neighborhood}`, cardWidth - 16), x + 8, metadataY + 44);
    });
  });

  downloadPdfFile(doc, `book-evidencias-${slug(report.title)}-${month}.pdf`);
}

function drawAuditTableHeader(doc: jsPDF, y: number) {
  doc.setFillColor(18, 46, 82);
  doc.rect(36, y, 770, 18, "F");
  setPdfFont(doc, 6.5, true, "#ffffff");
  doc.text("Espacio verde", 44, y + 12);
  doc.text("m2", 262, y + 12);
  doc.text("C1", 318, y + 12);
  doc.text("Fecha 1", 350, y + 12);
  doc.text("C2", 428, y + 12);
  doc.text("Fecha 2", 460, y + 12);
  doc.text("C3", 538, y + 12);
  doc.text("Fecha 3", 570, y + 12);
  doc.text("Fotos", 778, y + 12);
}

function drawDistanceTableHeader(doc: jsPDF, y: number) {
  doc.setFillColor(18, 46, 82);
  doc.rect(36, y, 770, 17, "F");
  setPdfFont(doc, 6.5, true, "#ffffff");
  doc.text("Desde", 46, y + 11);
  doc.text("Hasta", 386, y + 11);
  doc.text("Distancia", 792, y + 11, { align: "right" });
}

type PdfPhoto = {
  dataUrl: string;
  width: number;
  height: number;
  url: string;
  type: string;
  createdAt: string;
  spaceName: string;
  providerName: string;
  neighborhood: string;
};

async function loadPhotoForPdf(photo: Omit<PdfPhoto, "dataUrl" | "width" | "height">): Promise<PdfPhoto | null> {
  try {
    const response = await fetch(photo.url);
    const blob = await response.blob();
    const imageUrl = URL.createObjectURL(blob);
    const image = await loadImage(imageUrl);
    const maxSide = 1100;
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(imageUrl);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    return { ...photo, width: canvas.width, height: canvas.height, dataUrl };
  } catch {
    return null;
  }
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function fitImage(imageWidth: number, imageHeight: number, boxWidth: number, boxHeight: number) {
  const scale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return { width, height, x: (boxWidth - width) / 2, y: (boxHeight - height) / 2 };
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function pdfText(value: string | number | null | undefined) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function controlText(value: ControlValue) {
  if (value === "si") return "SI";
  if (value === "no") return "NO";
  return "-";
}

function controlColor(value: ControlValue) {
  if (value === "si") return "#17803d";
  if (value === "no") return "#b91c1c";
  return "#73849a";
}

function formatOptionalDate(value: string | null) {
  return value ? formatDate(value) : "-";
}

function groupSpacesByProvider(spaces: ProviderRow["spacesDetail"]) {
  const groups = new Map<string, ProviderRow["spacesDetail"]>();
  for (const space of spaces) {
    const providerName = space.providerName || "Sin cooperativa";
    groups.set(providerName, [...(groups.get(providerName) ?? []), space]);
  }
  return Array.from(groups.entries()).map(([providerName, groupedSpaces]) => ({ providerName, spaces: groupedSpaces }));
}

function periodRange(month: string) {
  const start = new Date(`${month}-01T12:00:00`);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  end.setDate(0);
  return { from: formatDate(start.toISOString()), to: formatDate(end.toISOString()) };
}

function slug(value: string) {
  return pdfText(value).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "auditoria";
}

function isInMonth(value: string, month: string) {
  return value.slice(0, 7) === month;
}

function groupPhotosByDate<T extends { createdAt: string }>(photos: T[]) {
  const groups = new Map<string, T[]>();
  for (const photo of photos) {
    const day = photo.createdAt.slice(0, 10);
    groups.set(day, [...(groups.get(day) ?? []), photo]);
  }
  return Array.from(groups.entries())
    .map(([date, groupedPhotos]) => ({ date, photos: groupedPhotos.sort((left, right) => right.createdAt.localeCompare(left.createdAt)) }))
    .sort((left, right) => right.date.localeCompare(left.date));
}

function groupPhotosByControl<T extends { type: string }>(photos: T[]) {
  return ["antes", "durante", "despues"].map((type) => ({
    type,
    photos: photos.filter((photo) => photo.type === type),
  }));
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

function formatTime(value: string) {
  return new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-AR").format(Math.round(value));
}
