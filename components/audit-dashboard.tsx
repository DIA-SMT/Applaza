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
    downloadAuditPdf({ period: periodLabel, report: { ...report, title: `${report.title} - ${reportView.title}`, spacesDetail: reportView.spacesDetail }, currentUser });
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
    const dates = record ? [record.control_1_date, record.control_2_date, record.control_3_date].filter(Boolean) as string[] : [];
    return {
      id: space.id,
      name: space.name,
      neighborhood: space.neighborhood,
      surface: space.surface_m2 ?? 0,
      controls,
      isReviewed: controls.some(Boolean),
      hasObservation: controls.some((control) => control === "no"),
      photos: space.photos.length,
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

function downloadAuditPdf({ period, report, currentUser }: { period: string; report: ProviderRow; currentUser: UserProfile }) {
  const width = 595;
  const height = 842;
  const margin = 42;
  const lines = [
    "MUNICIPALIDAD DE SAN MIGUEL DE TUCUMAN",
    "Informe de auditoria de espacios verdes",
    `Periodo: ${period}`,
    `Emitido por: ${currentUser.full_name}`,
    "",
    `Cooperativa: ${report.title}`,
    `Espacios: ${report.spaces}`,
    `Superficie: ${formatNumber(report.surface)} m2`,
    `Controlados: ${report.reviewed}`,
    `Pendientes: ${report.pending}`,
    `Observaciones: ${report.negative}`,
    `Evidencias: ${report.photos}`,
    "",
    "Detalle",
    ...report.spacesDetail.map((space) => {
      const controls = space.controls.map((control) => control ? control.toUpperCase() : "-").join(" / ");
      return `${space.name} - ${formatNumber(space.surface)} m2 - ${controls} - ${space.date ? formatDate(space.date) : "sin registro"}`;
    }),
  ];

  const objects: string[] = [];
  const pages: string[] = [];
  const pageCount = Math.max(1, Math.ceil(lines.length / 42));
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageLines = lines.slice(pageIndex * 42, pageIndex * 42 + 42);
    const content: string[] = ["0.96 0.98 1 rg 0 0 595 842 re f", "0 0 0 rg"];
    pageLines.forEach((line, index) => addPdfText(content, line, margin, height - margin - index * 17, index < 2 ? 12 : 9, index < 2));
    const stream = content.join("\n");
    const pageObject = 5 + pageIndex * 2;
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
  link.download = `informe-auditoria-${pdfText(report.title).replace(/\s+/g, "-").toLowerCase()}-${period.replace(/\s+/g, "-")}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}

function addPdfText(content: string[], text: string, x: number, y: number, size: number, bold = false) {
  content.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfText(text)}) Tj ET`);
}

function pdfText(value: string | number | null | undefined) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[()\\]/g, "\\$&");
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonth(value: string) {
  return new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" }).format(new Date(`${value}-01T12:00:00`));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-AR").format(Math.round(value));
}
