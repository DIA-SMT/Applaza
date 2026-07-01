"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Download, FileSearch, ListFilter, ShieldCheck, TriangleAlert } from "lucide-react";
import type { Provider, SpaceRecord, UserProfile } from "@/types/domain";
import { getSupabaseBrowserClient } from "@/lib/supabase";

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
type MetricKey = "assigned" | "reviewed" | "observed" | "evidence";
type ProviderRow = ReturnType<typeof buildAudit>["providerRows"][number];

const controlKeys = ["control_1", "control_2", "control_3"] as const;

export function AuditDashboard({ spaces, providers, currentUser }: { spaces: SpaceRecord[]; providers: Provider[]; currentUser: UserProfile }) {
  const [month, setMonth] = useState(currentMonth());
  const [records, setRecords] = useState<ControlRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string>("all");
  const [activeMetric, setActiveMetric] = useState<MetricKey>("assigned");

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

  const audit = useMemo(() => buildAudit(spaces, providers, records), [spaces, providers, records]);
  const selectedRow = audit.providerRows.find((row) => row.provider.id === selectedProviderId);
  const report = selectedRow ?? audit.totalRow;
  const reportView = useMemo(() => buildReportView(report, activeMetric), [report, activeMetric]);
  const periodLabel = formatMonth(month);

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
      const firstObserved = audit.providerRows.find((row) => row.negative > 0);
      if (firstObserved) setSelectedProviderId(firstObserved.provider.id);
    }
    if (metric === "reviewed") {
      const firstReviewed = audit.providerRows.find((row) => row.reviewed > 0);
      if (firstReviewed) setSelectedProviderId(firstReviewed.provider.id);
    }
    if (metric === "evidence") {
      const firstWithEvidence = audit.providerRows.find((row) => row.photos > 0);
      if (firstWithEvidence) setSelectedProviderId(firstWithEvidence.provider.id);
    }
  }

  function exportReport() {
    downloadAuditPdf({ filterTitle: reportView.title, month, period: periodLabel, report: { ...report, spacesDetail: reportView.spacesDetail }, currentUser });
  }

  return <div className="content audit-page">
    <section className="audit-hero">
      <div>
        <p>AUDITORIA MUNICIPAL</p>
        <h1>Seguimiento de controles</h1>
        <span>Elegis una cooperativa, revisas el informe y exportas el PDF cuando lo necesites.</span>
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
      <AuditStat active={activeMetric === "observed"} onClick={() => selectMetric("observed")} icon={AlertCircle} label="Observaciones" value={audit.totalRow.negative} note="Controles marcados como NO" tone="warning" />
      <AuditStat active={activeMetric === "evidence"} onClick={() => selectMetric("evidence")} icon={FileSearch} label="Evidencias cargadas" value={audit.totalRow.photos} note={audit.latestPhoto ? `Ultima: ${formatDate(audit.latestPhoto)}` : "Sin fotos recientes"} />
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
        <span>{periodLabel} - {loading ? "actualizando" : reportView.summary}</span>
      </div>
      <button className="audit-export" onClick={exportReport} disabled={!report.spaces}>
        <Download size={17} />Exportar PDF
      </button>
    </section>

    <div className="audit-layout focused">
      <section className="audit-panel audit-main-panel">
        <div className="audit-panel-title">
          <div>
            <h2>Informe</h2>
            <p>{reportView.title} - {selectedProviderId === "all" ? "Resumen general del periodo" : "Detalle de la cooperativa seleccionada"}</p>
          </div>
          <span className="audit-readonly"><ShieldCheck size={15} />Solo lectura</span>
        </div>

        <div className="audit-report">
          <div className="audit-report-kpis">
            <span><b>{report.spaces}</b> espacios</span>
            <span><b>{formatNumber(report.surface)}</b> m2</span>
            <span><b>{report.reviewed}</b> controlados</span>
            <span><b>{report.pending}</b> pendientes</span>
            <span><b>{report.negative}</b> observados</span>
            <span><b>{report.photos}</b> evidencias</span>
          </div>

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

    <section className="audit-panel">
      <div className="audit-panel-title">
        <div>
          <h2>Ultima actividad</h2>
          <p>Movimientos recientes del registro de control</p>
        </div>
        <span>{currentUser.role === "auditor" ? "Perfil auditor" : "Perfil administrador"}</span>
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
  </div>;
}

function AuditStat({ icon: Icon, label, value, note, tone = "default", active, onClick }: { icon: typeof ClipboardList; label: string; value: number; note: string; tone?: "default" | "warning"; active: boolean; onClick: () => void }) {
  return <button className={`audit-stat ${tone} ${active ? "active" : ""}`} onClick={onClick}>
    <div><Icon size={20} /></div>
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{note}</small>
  </button>;
}

function buildAudit(spaces: SpaceRecord[], providers: Provider[], records: ControlRecord[]) {
  const spacesById = new Map(spaces.map((space) => [space.id, space]));
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const reviewedRecords = records.filter(hasAnyControl);
  const reviewedSpaceIds = new Set(reviewedRecords.map((record) => record.green_space_id));
  const photoDates = spaces.flatMap((space) => space.photos.map((photo) => photo.created_at)).sort((left, right) => right.localeCompare(left));
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

  const providerRows = providersWithAssignedSpaces.map(({ provider, assignedSpaces }) => buildProviderRow(provider, assignedSpaces, recordsByProvider.get(provider.id) ?? [], recordsBySpace))
    .sort((left, right) => right.negative - left.negative || right.pending - left.pending || left.provider.name.localeCompare(right.provider.name));

  const totalProvider: Provider = { id: "all", name: "Todas las cooperativas", contact_name: "", phone: "", email: "", active: true, created_at: "", updated_at: "" };
  const totalRow = buildProviderRow(totalProvider, spaces, records, recordsBySpace);
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

function buildProviderRow(provider: Provider, assignedSpaces: SpaceRecord[], providerRecords: ControlRecord[], recordsBySpace: Map<string, ControlRecord>) {
  const reviewed = new Set(providerRecords.filter(hasAnyControl).map((record) => record.green_space_id)).size;
  const pending = Math.max(assignedSpaces.length - reviewed, 0);
  const negative = countControls(providerRecords, "no");
  const photos = assignedSpaces.reduce((total, space) => total + space.photos.length, 0);
  const surface = assignedSpaces.reduce((total, space) => total + (space.surface_m2 ?? 0), 0);
  const status = negative > 0 ? "Observado" : pending > 0 ? "Pendiente" : "Al dia";
  const statusTone = negative > 0 ? "danger" : pending > 0 ? "pending" : "ok";
  const spacesDetail = assignedSpaces.map((space) => {
    const record = recordsBySpace.get(space.id);
    const controls = record ? controlKeys.map((key) => record[key]) : [null, null, null];
    const controlDates = record ? [record.control_1_date, record.control_2_date, record.control_3_date] : [null, null, null];
    const dates = controlDates.filter(Boolean) as string[];
    return {
      id: space.id,
      name: space.name,
      neighborhood: space.neighborhood,
      surface: space.surface_m2 ?? 0,
      controls,
      isReviewed: controls.some(Boolean),
      hasObservation: controls.some((control) => control === "no"),
      photos: space.photos.length,
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

function downloadAuditPdf({ filterTitle, month, period, report, currentUser }: { filterTitle: string; month: string; period: string; report: ProviderRow; currentUser: UserProfile }) {
  const width = 842;
  const height = 595;
  const margin = 36;
  const { from, to } = periodRange(month);
  const issuedAt = formatDate(new Date().toISOString());
  const groups = groupSpacesByProvider(report.spacesDetail);
  const pages: string[] = [];
  const pageContents: string[][] = [];
  let pageIndex = -1;
  let content: string[] = [];
  let y = 0;

  function startPage() {
    pageIndex += 1;
    content = [];
    pageContents.push(content);
    y = height - margin;
    addPdfRect(content, 0, height - 78, width, 78, "0.02 0.25 0.55");
    addPdfText(content, "MUNICIPALIDAD DE SAN MIGUEL DE TUCUMAN", margin, height - 32, 9, true, "1 1 1");
    addPdfText(content, "Informe de auditoria de espacios verdes", margin, height - 52, 17, true, "1 1 1");
    addPdfText(content, `${period} | ${filterTitle}`, margin, height - 68, 9, false, "0.86 0.93 1");
    addPdfText(content, `Pagina ${pageIndex + 1}`, width - margin - 48, height - 32, 8, false, "0.86 0.93 1");
    y = height - 102;
  }

  function ensureSpace(required: number) {
    if (y - required < margin) startPage();
  }

  startPage();
  addPdfText(content, "Resumen del informe", margin, y, 12, true, "0.06 0.15 0.28");
  y -= 20;
  addInfoBox(content, margin, y - 36, 150, "Fecha de exportacion", issuedAt);
  addInfoBox(content, margin + 158, y - 36, 130, "Desde", from);
  addInfoBox(content, margin + 296, y - 36, 130, "Hasta", to);
  addInfoBox(content, margin + 434, y - 36, 170, "Emitido por", currentUser.full_name);
  addInfoBox(content, margin + 612, y - 36, 158, "Cooperativa", report.title);
  y -= 56;

  addInfoBox(content, margin, y - 36, 112, "Espacios", report.spaces);
  addInfoBox(content, margin + 120, y - 36, 112, "Controlados", report.reviewed);
  addInfoBox(content, margin + 240, y - 36, 112, "Exportados", report.spacesDetail.length);
  addInfoBox(content, margin + 360, y - 36, 112, "Pendientes", report.pending);
  addInfoBox(content, margin + 480, y - 36, 112, "Observaciones", report.negative);
  addInfoBox(content, margin + 600, y - 36, 170, "Superficie", `${formatNumber(report.surface)} m2`);
  y -= 58;

  addPdfText(content, "Detalle por cooperativa", margin, y, 12, true, "0.06 0.15 0.28");
  y -= 20;

  if (!groups.length) {
    addPdfRect(content, margin, y - 40, width - margin * 2, 46, "0.96 0.98 1");
    addPdfText(content, "No hay registros para el filtro seleccionado.", margin + 12, y - 18, 10, false, "0.37 0.45 0.55");
  }

  for (const group of groups) {
    ensureSpace(76);
    addPdfRect(content, margin, y - 22, width - margin * 2, 24, "0.91 0.96 1");
    addPdfText(content, group.providerName, margin + 10, y - 14, 10, true, "0.02 0.25 0.55");
    addPdfText(content, `${group.spaces.length} espacios`, width - margin - 78, y - 14, 8, false, "0.25 0.34 0.45");
    y -= 34;
    drawAuditTableHeader(content, y);
    y -= 18;

    for (const space of group.spaces) {
      ensureSpace(34);
      const rowHeight = 24;
      addPdfRect(content, margin, y - rowHeight + 4, width - margin * 2, rowHeight, space.hasObservation ? "1 0.96 0.96" : space.isReviewed ? "0.96 1 0.97" : "1 0.98 0.94");
      addPdfText(content, truncate(space.name, 39), margin + 8, y - 10, 8, true, "0.06 0.15 0.28");
      addPdfText(content, truncate(space.neighborhood || "Sin barrio", 22), margin + 8, y - 20, 7, false, "0.37 0.45 0.55");
      addPdfText(content, formatNumber(space.surface), margin + 226, y - 13, 8, false, "0.06 0.15 0.28");
      addPdfText(content, controlText(space.controls[0]), margin + 282, y - 13, 8, true, controlColor(space.controls[0]));
      addPdfText(content, formatOptionalDate(space.controlDates[0]), margin + 314, y - 13, 8, false, "0.06 0.15 0.28");
      addPdfText(content, controlText(space.controls[1]), margin + 392, y - 13, 8, true, controlColor(space.controls[1]));
      addPdfText(content, formatOptionalDate(space.controlDates[1]), margin + 424, y - 13, 8, false, "0.06 0.15 0.28");
      addPdfText(content, controlText(space.controls[2]), margin + 502, y - 13, 8, true, controlColor(space.controls[2]));
      addPdfText(content, formatOptionalDate(space.controlDates[2]), margin + 534, y - 13, 8, false, "0.06 0.15 0.28");
      addPdfText(content, String(space.photos), margin + 742, y - 13, 8, false, "0.06 0.15 0.28");
      y -= rowHeight + 4;
    }
    y -= 8;
  }

  const objects: string[] = [];
  for (let index = 0; index < pageContents.length; index += 1) {
    const stream = pageContents[index].join("\n");
    const pageObject = 5 + index * 2;
    const contentObject = pageObject + 1;
    pages.push(`${pageObject} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObject} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }

  const allObjects = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [${pages.join(" ")}] /Count ${pages.length} >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`,
    ...objects,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  allObjects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${allObjects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${allObjects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `informe-auditoria-${slug(report.title)}-${month}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}

function addInfoBox(content: string[], x: number, y: number, width: number, label: string, value: string | number) {
  addPdfRect(content, x, y, width, 38, "0.96 0.98 1");
  addPdfText(content, label, x + 8, y + 23, 7, false, "0.37 0.45 0.55");
  addPdfText(content, truncate(String(value), Math.max(10, Math.floor(width / 7))), x + 8, y + 10, 9, true, "0.06 0.15 0.28");
}

function drawAuditTableHeader(content: string[], y: number) {
  addPdfRect(content, 36, y - 16, 770, 18, "0.08 0.18 0.32");
  addPdfText(content, "Espacio verde", 44, y - 10, 7, true, "1 1 1");
  addPdfText(content, "m2", 262, y - 10, 7, true, "1 1 1");
  addPdfText(content, "C1", 318, y - 10, 7, true, "1 1 1");
  addPdfText(content, "Fecha 1", 350, y - 10, 7, true, "1 1 1");
  addPdfText(content, "C2", 428, y - 10, 7, true, "1 1 1");
  addPdfText(content, "Fecha 2", 460, y - 10, 7, true, "1 1 1");
  addPdfText(content, "C3", 538, y - 10, 7, true, "1 1 1");
  addPdfText(content, "Fecha 3", 570, y - 10, 7, true, "1 1 1");
  addPdfText(content, "Fotos", 778, y - 10, 7, true, "1 1 1");
}

function addPdfText(content: string[], text: string, x: number, y: number, size: number, bold = false, color = "0 0 0") {
  content.push(`${color} rg BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfText(text)}) Tj ET`);
}

function addPdfRect(content: string[], x: number, y: number, width: number, height: number, color: string) {
  content.push(`${color} rg ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`);
}

function pdfText(value: string | number | null | undefined) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[()\\]/g, "\\$&");
}

function controlText(value: ControlValue) {
  if (value === "si") return "SI";
  if (value === "no") return "NO";
  return "-";
}

function controlColor(value: ControlValue) {
  if (value === "si") return "0.09 0.50 0.24";
  if (value === "no") return "0.72 0.11 0.11";
  return "0.45 0.52 0.60";
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

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}.` : value;
}

function slug(value: string) {
  return pdfText(value).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "auditoria";
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

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-AR").format(Math.round(value));
}
