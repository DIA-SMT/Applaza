"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, ClipboardCheck, FileDown, LoaderCircle, Save, Search, X } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import type { Provider, SpaceRecord } from "@/types/domain";

type ControlKey = "control_1" | "control_2" | "control_3";
type ControlValue = "si" | "no" | "";
type RowState = Record<ControlKey, ControlValue> & Record<`${ControlKey}_date`, string>;
type ControlRecordRow = RowState & { green_space_id: string };
type SaveState = "idle" | "success" | "error";

const controlKeys: ControlKey[] = ["control_1", "control_2", "control_3"];
const monthFormatter = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" });

function currentMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function emptyRow(): RowState {
  return { control_1: "", control_2: "", control_3: "", control_1_date: "", control_2_date: "", control_3_date: "" };
}

function periodLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  return monthFormatter.format(new Date(year, month - 1, 1)).toLocaleUpperCase("es-AR");
}

function pdfText(value: string | number | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function addText(content: string[], text: string | number | null | undefined, x: number, y: number, size = 8, bold = false) {
  content.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfText(text)}) Tj ET`);
}

function addLine(content: string[], x1: number, y1: number, x2: number, y2: number) {
  content.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
}

function addRect(content: string[], x: number, y: number, width: number, height: number) {
  content.push(`${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S`);
}

function downloadPdf({ provider, period, spaces, rows, totalSurface }: { provider?: Provider; period: string; spaces: SpaceRecord[]; rows: Record<string, RowState>; totalSurface: number }) {
  const pageWidth = 842;
  const pageHeight = 595;
  const margin = 22;
  const rowHeight = 13;
  const tableTop = 480;
  const rowsPerPage = 29;
  const col = { location: 300, surface: 55, mark: 20, date: 68 };
  const tableWidth = col.location + col.surface + (col.mark + col.mark + col.date) * 3;
  const pages = Math.max(1, Math.ceil(spaces.length / rowsPerPage));
  const streams: string[] = [];

  for (let page = 0; page < pages; page += 1) {
    const content: string[] = ["0.7 w"];
    const pageSpaces = spaces.slice(page * rowsPerPage, (page + 1) * rowsPerPage);
    const yHeader = pageHeight - 26;

    addText(content, "MUNICIPALIDAD DE SAN MIGUEL DE TUCUMAN \"CIUDAD HISTORICA\"", 280, yHeader, 8, true);
    addText(content, "SECRETARIA DE SERVICIOS PUBLICOS", 342, yHeader - 11, 7, true);
    addText(content, "Certificado de Servicios", pageWidth - 138, yHeader - 11, 7, true);
    addLine(content, margin, yHeader - 23, pageWidth - margin, yHeader - 23);

    addText(content, "MES", margin, yHeader - 39, 6, true);
    addText(content, periodLabel(period), margin, yHeader - 49, 7);
    addText(content, "COOPERATIVA", 140, yHeader - 39, 6, true);
    addText(content, provider?.name ?? "Sin seleccionar", 140, yHeader - 49, 7);
    addText(content, "SERVICIO", 350, yHeader - 39, 6, true);
    addText(content, "Limpieza, desmalezamiento y mantenimiento integral", 350, yHeader - 49, 7);
    addText(content, "RESUMEN", 630, yHeader - 39, 6, true);
    addText(content, `${spaces.length} espacios - ${Math.round(totalSurface).toLocaleString("es-AR")} mts2`, 630, yHeader - 49, 7);

    let y = tableTop;
    addRect(content, margin, y - 26, tableWidth, 26);
    let x = margin;
    addLine(content, x + col.location, y, x + col.location, y - 26);
    addLine(content, x + col.location + col.surface, y, x + col.location + col.surface, y - 26);
    addText(content, "Ubicacion", x + 120, y - 17, 6, true);
    addText(content, "Superficie mts2", x + col.location + 7, y - 17, 6, true);
    x += col.location + col.surface;
    controlKeys.forEach((_, index) => {
      const groupWidth = col.mark + col.mark + col.date;
      addLine(content, x, y, x, y - 26);
      addLine(content, x + groupWidth, y, x + groupWidth, y - 26);
      addLine(content, x, y - 13, x + groupWidth, y - 13);
      addLine(content, x + col.mark, y - 13, x + col.mark, y - 26);
      addLine(content, x + col.mark * 2, y - 13, x + col.mark * 2, y - 26);
      addText(content, `Control ${index + 1}`, x + 38, y - 9, 6, true);
      addText(content, "SI", x + 6, y - 22, 5, true);
      addText(content, "NO", x + col.mark + 5, y - 22, 5, true);
      addText(content, "Fecha Control", x + col.mark * 2 + 9, y - 22, 5, true);
      x += groupWidth;
    });
    y -= 26;

    pageSpaces.forEach((space) => {
      const row = rows[space.id] ?? emptyRow();
      addRect(content, margin, y - rowHeight, tableWidth, rowHeight);
      x = margin;
      addLine(content, x + col.location, y, x + col.location, y - rowHeight);
      addLine(content, x + col.location + col.surface, y, x + col.location + col.surface, y - rowHeight);
      addText(content, `${space.name} - ${space.address || `Seccion ${space.section_code || "-"}`}`.slice(0, 86), x + 4, y - 9, 5.5);
      addText(content, space.surface_m2 ? Math.round(space.surface_m2).toLocaleString("es-AR") : "-", x + col.location + 18, y - 9, 5.5);
      x += col.location + col.surface;
      controlKeys.forEach((key) => {
        addLine(content, x, y, x, y - rowHeight);
        addLine(content, x + col.mark, y, x + col.mark, y - rowHeight);
        addLine(content, x + col.mark * 2, y, x + col.mark * 2, y - rowHeight);
        addLine(content, x + col.mark * 2 + col.date, y, x + col.mark * 2 + col.date, y - rowHeight);
        addText(content, row[key] === "si" ? "X" : "", x + 7, y - 9, 6, true);
        addText(content, row[key] === "no" ? "X" : "", x + col.mark + 7, y - 9, 6, true);
        addText(content, row[`${key}_date`] || "-", x + col.mark * 2 + 8, y - 9, 5.5);
        x += col.mark + col.mark + col.date;
      });
      y -= rowHeight;
    });

    if (page === pages - 1) {
      addRect(content, margin, y - rowHeight, tableWidth, rowHeight);
      addText(content, "TOTAL", margin + 4, y - 9, 6, true);
      addText(content, Math.round(totalSurface).toLocaleString("es-AR"), margin + col.location + 18, y - 9, 6, true);
    }

    addText(content, `Pagina ${page + 1} de ${pages}`, pageWidth - 80, 18, 6);
    streams.push(content.join("\n"));
  }

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${streams.map((_, index) => `${5 + index * 2} 0 R`).join(" ")}] /Count ${streams.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
  streams.forEach((stream, index) => {
    const pageObject = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + index * 2} 0 R >>`;
    const contentObject = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    objects.push(pageObject, contentObject);
  });

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `registro-control-${pdfText(provider?.name || "cooperativa").replace(/\s+/g, "-").toLowerCase()}-${period}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ControlRegister({ providers, spaces }: { providers: Provider[]; spaces: SpaceRecord[] }) {
  const providersWithSpaces = useMemo(() => providers.filter((provider) => spaces.some((space) => space.provider?.id === provider.id)), [providers, spaces]);
  const [providerId, setProviderId] = useState(providersWithSpaces[0]?.id ?? providers[0]?.id ?? "");
  const [period, setPeriod] = useState(currentMonth());
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const selectedProvider = providers.find((provider) => provider.id === providerId);
  const assignedSpaces = spaces.filter((space) => space.provider?.id === providerId);
  const filteredSpaces = assignedSpaces.filter((space) => {
    const term = query.trim().toLocaleLowerCase("es");
    return !term || space.name.toLocaleLowerCase("es").includes(term) || space.address?.toLocaleLowerCase("es").includes(term) || space.section_code?.toLocaleLowerCase("es").includes(term);
  });
  const totalSurface = assignedSpaces.reduce((sum, space) => sum + (space.surface_m2 ?? 0), 0);
  const completedCells = assignedSpaces.reduce((sum, space) => sum + controlKeys.filter((key) => rows[space.id]?.[key]).length, 0);

  useEffect(() => {
    let cancelled = false;

    async function loadRecords() {
      setRows({});
      if (!providerId || !period) return;
      const client = getSupabaseBrowserClient();
      if (!client) {
        setMessage("Supabase no esta configurado. No se pueden recuperar registros.");
        return;
      }

      setLoadingRecords(true);
      try {
        const { data, error } = await client
          .from("control_records")
          .select("green_space_id,control_1,control_1_date,control_2,control_2_date,control_3,control_3_date")
          .eq("provider_id", providerId)
          .eq("period_month", `${period}-01`);

        if (error) throw error;
        if (cancelled) return;

        setRows(Object.fromEntries(((data ?? []) as ControlRecordRow[]).map((record) => [record.green_space_id, {
          control_1: record.control_1 ?? "",
          control_1_date: record.control_1_date ?? "",
          control_2: record.control_2 ?? "",
          control_2_date: record.control_2_date ?? "",
          control_3: record.control_3 ?? "",
          control_3_date: record.control_3_date ?? "",
        } satisfies RowState])));
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? `No se pudieron recuperar registros previos: ${error.message}` : "No se pudieron recuperar registros previos.");
      } finally {
        if (!cancelled) setLoadingRecords(false);
      }
    }

    loadRecords();
    return () => { cancelled = true; };
  }, [providerId, period]);

  function setControl(spaceId: string, key: ControlKey, value: ControlValue) {
    setSaveState("idle");
    setRows((current) => {
      const row = current[spaceId] ?? emptyRow();
      const dateKey = `${key}_date` as const;
      const nextValue = row[key] === value ? "" : value;
      return {
        ...current,
        [spaceId]: {
          ...row,
          [key]: nextValue,
          [dateKey]: nextValue ? row[dateKey] || todayISO() : "",
        },
      };
    });
  }

  async function save() {
    setSaving(true);
    setSaveState("idle");
    setMessage("");

    try {
      const client = getSupabaseBrowserClient();
      if (!client) throw new Error("Supabase no esta configurado. No se puede guardar el registro.");

      const { data: { user } } = await client.auth.getUser();
      if (!user) throw new Error("Inicia sesion para guardar el registro.");

      const payload = assignedSpaces.map((space) => {
        const row = rows[space.id] ?? emptyRow();
        return {
          provider_id: providerId,
          green_space_id: space.id,
          period_month: `${period}-01`,
          control_1: row.control_1 || null,
          control_1_date: row.control_1_date || null,
          control_2: row.control_2 || null,
          control_2_date: row.control_2_date || null,
          control_3: row.control_3 || null,
          control_3_date: row.control_3_date || null,
          recorded_by: user.id,
        };
      });

      const { error } = await client.from("control_records").upsert(payload, { onConflict: "provider_id,green_space_id,period_month" });
      if (error) throw error;
      setMessage("Registro de control guardado.");
      setSaveState("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar el registro.");
      setSaveState("error");
    } finally {
      setSaving(false);
    }
  }

  function exportPdf() {
    downloadPdf({ provider: selectedProvider, period, spaces: assignedSpaces, rows, totalSurface });
  }

  return <div className="content control-page">
    <div className="page-heading"><div><p>CERTIFICADO DE SERVICIOS</p><h1>Registro de control</h1><span>Selecciona una cooperativa y carga los controles por espacio asignado.</span></div><div className="page-actions"><button className="secondary-action" disabled={!assignedSpaces.length} onClick={exportPdf}><FileDown size={17} />Descargar PDF</button><button className={`primary ${saveState === "success" ? "saved" : ""}`} disabled={!assignedSpaces.length || saving || loadingRecords} onClick={save}>{saving ? <LoaderCircle className="spin" size={17} /> : saveState === "success" ? <Check size={17} /> : <Save size={17} />}{saveState === "success" ? "Guardado" : "Guardar registro"}</button></div></div>
    {saveState !== "idle" && <div className={`save-banner ${saveState}`}><div>{saveState === "success" ? <Check size={18} /> : <X size={18} />}</div><strong>{saveState === "success" ? "Registro guardado correctamente" : "No se pudo guardar el registro"}</strong><span>{message}</span></div>}

    <section className="control-sheet">
      <div className="control-sheet-head">
        <strong>MUNICIPALIDAD DE SAN MIGUEL DE TUCUMAN &quot;CIUDAD HISTORICA&quot;</strong>
        <span>SECRETARIA DE SERVICIOS PUBLICOS</span>
        <b>Certificado de Servicios</b>
      </div>

      <div className="control-tools">
        <label>Cooperativa<select value={providerId} onChange={(event) => { setProviderId(event.target.value); setMessage(""); setSaveState("idle"); }}><option value="">Seleccionar cooperativa</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
        <label>Mes<input type="month" value={period} onChange={(event) => { setPeriod(event.target.value); setMessage(""); setSaveState("idle"); }} /></label>
        <label className="control-search"><span>Buscar espacio</span><div><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ubicacion, seccion o nombre" />{query && <button onClick={() => setQuery("")} aria-label="Limpiar busqueda"><X size={14} /></button>}</div></label>
      </div>

      <div className="control-meta">
        <div><span>MES</span><strong>{periodLabel(period)}</strong></div>
        <div><span>Cooperativa</span><strong>{selectedProvider?.name ?? "Sin seleccionar"}</strong></div>
        <div><span>Servicio</span><strong>Limpieza, desmalezamiento y mantenimiento integral</strong></div>
        <div><span>Resumen</span><strong>{assignedSpaces.length} espacios · {Math.round(totalSurface).toLocaleString("es-AR")} mts2 · {completedCells} controles cargados</strong></div>
      </div>

      <div className="control-mobile-list">
        {filteredSpaces.map((space) => {
          const row = rows[space.id] ?? emptyRow();
          return <article className="control-mobile-card" key={space.id}>
            <div className="control-mobile-card-head"><div><strong>{space.name}</strong><span>{space.address || `Seccion ${space.section_code || "-"}`}</span></div><b>{space.surface_m2 ? `${Math.round(space.surface_m2).toLocaleString("es-AR")} mts2` : "Sin superficie"}</b></div>
            <div className="control-mobile-controls">
              {controlKeys.map((key, index) => <section key={key}>
                <div><strong>Control {index + 1}</strong><span>{row[`${key}_date`] || "Fecha automatica al marcar"}</span></div>
                <div className="control-mobile-toggle"><button className={row[key] === "si" ? "active yes" : ""} onClick={() => setControl(space.id, key, "si")}><Check size={15} />SI</button><button className={row[key] === "no" ? "active no" : ""} onClick={() => setControl(space.id, key, "no")}><X size={15} />NO</button></div>
              </section>)}
            </div>
          </article>;
        })}
      </div>

      <div className="control-table-wrap">
        <table className="control-table">
          <thead>
            <tr><th rowSpan={2}>Ubicacion</th><th rowSpan={2}>Superficie mts2</th>{controlKeys.map((key, index) => <th key={key} colSpan={3}>Control {index + 1}</th>)}</tr>
            <tr>{controlKeys.map((key) => <Fragment key={key}><th>SI</th><th>NO</th><th>Fecha Control</th></Fragment>)}</tr>
          </thead>
          <tbody>
            {filteredSpaces.map((space) => {
              const row = rows[space.id] ?? emptyRow();
              return <tr key={space.id}>
                <td><strong>{space.name}</strong><span>{space.address || `Seccion ${space.section_code || "-"}`}</span></td>
                <td>{space.surface_m2 ? Math.round(space.surface_m2).toLocaleString("es-AR") : "-"}</td>
                {controlKeys.map((key) => <Fragment key={`${space.id}-${key}`}>
                  <td><button className={row[key] === "si" ? "checked" : ""} onClick={() => setControl(space.id, key, "si")}><Check size={13} /></button></td>
                  <td><button className={row[key] === "no" ? "checked no" : ""} onClick={() => setControl(space.id, key, "no")}><X size={13} /></button></td>
                  <td><span className="control-date-text">{row[`${key}_date`] || "-"}</span></td>
                </Fragment>)}
              </tr>;
            })}
          </tbody>
          <tfoot><tr><td>Total</td><td>{Math.round(totalSurface).toLocaleString("es-AR")}</td><td colSpan={9}>Los registros se guardan en Supabase.</td></tr></tfoot>
        </table>
      </div>

      {!assignedSpaces.length && <div className="control-empty"><ClipboardCheck /><strong>No hay espacios asignados</strong><span>Elegí otra cooperativa o revisá las secciones/proveedores cargados.</span></div>}
      {loadingRecords && <p className="control-message loading"><LoaderCircle className="spin" size={15} />Recuperando ultima planilla guardada...</p>}
      {message && <p className="control-message"><CalendarDays size={15} />{message}</p>}
    </section>
  </div>;
}
