"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, LoaderCircle, PencilLine, X } from "lucide-react";
import type { ModelPhotoOutput, SuggestedStatus } from "@/lib/migue-vision/contracts.ts";
import { CURRENT_RUBRIC } from "@/lib/migue-vision/rubric.ts";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { userErrorMessage } from "@/lib/user-messages";
import type { UserProfile } from "@/types/domain";
import { MascotaApplaza } from "./mascota-applaza";

// Análisis automático de una foto + revisión humana. Lo que muestra Migue es una sugerencia:
// el estado vigente es el que confirma o corrige una persona.

export const STATUS_LABEL: Record<SuggestedStatus, string> = {
  satisfactorio: "Satisfactorio",
  requiere_atencion: "Requiere atención",
  critico: "Crítico",
  indeterminado: "Indeterminado",
};
const KIND_LABEL = { observado: "Se observa", posible_problema: "Posible problema", no_determinable: "No determinable" } as const;
const SEVERITY_LABEL = { baja: "leve", media: "moderado", alta: "grave" } as const;
const DECISION_LABEL = { confirmado: "Confirmado", corregido: "Corregido", rechazado: "Rechazado" } as const;
const DIMENSION_LABEL = new Map(CURRENT_RUBRIC.dimensions.map((d) => [d.key, d.label]));

type Decision = keyof typeof DECISION_LABEL;
interface Review { id: string; decision: Decision; corrected_status: SuggestedStatus | null; comment: string; reviewed_by: string; created_at: string }
interface Analysis {
  id: string;
  mode: "real" | "prueba";
  model: string;
  rubric_version: string;
  prompt_version: string;
  suggested_status: SuggestedStatus;
  overall_score: number | null;
  coverage_evaluated: number;
  coverage_total: number;
  reasons: string[];
  output: ModelPhotoOutput;
  created_at: string;
  photo_analysis_reviews: Review[];
}

const ANALYSIS_COLUMNS = "id, mode, model, rubric_version, prompt_version, suggested_status, overall_score, coverage_evaluated, coverage_total, reasons, output, created_at, photo_analysis_reviews(id, decision, corrected_status, comment, reviewed_by, created_at)";

const day = (value: string) => new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
const latest = <T extends { created_at: string }>(items: T[]) => [...items].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

/** Estado vigente: el de la última revisión humana; si la rechazaron, no hay estado. */
export function effectiveStatus(suggested: SuggestedStatus, reviews: Pick<Review, "decision" | "corrected_status" | "created_at">[]): SuggestedStatus | null {
  const review = latest(reviews);
  if (!review) return suggested;
  if (review.decision === "rechazado") return null;
  if (review.decision === "corregido") return review.corrected_status ?? suggested;
  return suggested;
}

export function MiguePhotoAnalysis({ photoId, currentUser }: { photoId: string; currentUser: UserProfile }) {
  const canReview = currentUser.role === "admin" || currentUser.role === "supervisor" || currentUser.role === "inspector";
  const [state, setState] = useState<{ loading: boolean; analysis: Analysis | null; queued: boolean; failed: boolean }>({ loading: true, analysis: null, queued: false, failed: false });
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"idle" | "corregir" | "rechazar">("idle");
  const [corrected, setCorrected] = useState<SuggestedStatus>("satisfactorio");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return setState({ loading: false, analysis: null, queued: false, failed: true });
    const [{ data: analyses, error: analysisError }, { data: jobs }] = await Promise.all([
      supabase.from("photo_analyses").select(ANALYSIS_COLUMNS).eq("photo_id", photoId).order("created_at", { ascending: false }).limit(1),
      supabase.from("migue_jobs").select("status").eq("photo_id", photoId).in("status", ["pendiente", "procesando"]).limit(1),
    ]);
    if (analysisError) return setState({ loading: false, analysis: null, queued: false, failed: true });
    setState({ loading: false, analysis: (analyses?.[0] as unknown as Analysis) ?? null, queued: Boolean(jobs?.length), failed: false });
  }, [photoId]);

  useEffect(() => {
    setState({ loading: true, analysis: null, queued: false, failed: false });
    setOpen(false); setMode("idle"); setComment(""); setError("");
    void load();
  }, [load]);

  async function review(decision: Decision) {
    const analysis = state.analysis;
    const supabase = getSupabaseBrowserClient();
    if (!analysis || !supabase) return;
    setBusy(true); setError("");
    const { error: insertError } = await supabase.from("photo_analysis_reviews").insert({
      analysis_id: analysis.id,
      decision,
      corrected_status: decision === "corregido" ? corrected : null,
      comment: comment.trim(),
      reviewed_by: currentUser.id,
    });
    setBusy(false);
    if (insertError) return setError(userErrorMessage(insertError, "No se pudo guardar la revisión. Intentá de nuevo."));
    setMode("idle"); setComment("");
    await load();
  }

  if (state.loading) return <div className="migue-analysis is-quiet"><LoaderCircle size={14} className="spin" /> Buscando el análisis de Migue…</div>;
  if (state.failed) return null; // sin conexión o sin las tablas: no se muestra nada, la foto se ve igual
  const { analysis } = state;
  if (!analysis) {
    return state.queued ? <div className="migue-analysis is-quiet"><MascotaApplaza variant="avatar" size={26} decorative /> Migue está analizando esta foto. Volvé a abrirla en unos minutos.</div> : null;
  }

  const output = analysis.output;
  const lastReview = latest(analysis.photo_analysis_reviews);
  const current = effectiveStatus(analysis.suggested_status, analysis.photo_analysis_reviews);
  const shownStatus = current ?? analysis.suggested_status;
  const findings = output.findings.filter((f) => f.kind !== "no_determinable");

  return <section className={`migue-analysis status-${shownStatus}${current === null ? " is-rejected" : ""}`} aria-label="Análisis de Migue">
    <header className="migue-analysis-head">
      <MascotaApplaza variant="avatar" size={34} decorative />
      <div className="migue-analysis-title">
        <strong>Análisis de Migue</strong>
        <span>{lastReview ? `${DECISION_LABEL[lastReview.decision]} ${lastReview.reviewed_by === currentUser.id ? "por vos" : "por el equipo"} el ${day(lastReview.created_at)}` : "Sugerencia automática · falta revisión"}</span>
      </div>
      <span className={`migue-status-chip status-${shownStatus}`}>{current === null ? "Descartado" : STATUS_LABEL[shownStatus]}</span>
    </header>

    {analysis.mode === "prueba" && <p className="migue-test-banner">Modo prueba: este resultado es simulado y no surge de mirar la foto.</p>}

    <div className="migue-analysis-summary">
      <p>{output.scene_summary}</p>
      {output.season_light_note && <p className="migue-season-note">No cuenta como falta: {output.season_light_note}</p>}
      <div className="migue-analysis-figures">
        <span><b>{analysis.overall_score ?? "—"}</b>/100</span>
        <span>{analysis.coverage_evaluated} de {analysis.coverage_total} aspectos evaluados</span>
        {output.evidence_quality.level !== "buena" && <span>Foto {output.evidence_quality.level}{output.evidence_quality.issues.length ? ` (${output.evidence_quality.issues.join(", ").replaceAll("_", " ")})` : ""}</span>}
      </div>
      {lastReview?.decision === "corregido" && <p className="migue-review-note">Estado sugerido por Migue: {STATUS_LABEL[analysis.suggested_status]}. {lastReview.comment}</p>}
      {lastReview?.decision !== "corregido" && lastReview?.comment && <p className="migue-review-note">{lastReview.comment}</p>}
      <ul className="migue-reasons">{analysis.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
    </div>

    <button className="migue-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      {open ? "Ocultar detalle" : "Ver detalle por aspecto"}<ChevronDown size={14} className={open ? "is-open" : ""} />
    </button>

    {open && <div className="migue-analysis-detail">
      <ul className="migue-dimensions">
        {output.dimensions.map((d) => <li key={d.dimension} className={d.evaluable ? "" : "is-off"}>
          <div><strong>{DIMENSION_LABEL.get(d.dimension) ?? d.dimension}</strong><span>{d.evaluable ? `${d.score}/100${d.visibility === "parcial" ? " · se ve parcial" : ""}` : "No evaluable"}</span></div>
          {d.evaluable && <meter min={0} max={100} low={40} high={70} optimum={100} value={d.score ?? 0} />}
          <p>{d.evidence}</p>
        </li>)}
      </ul>
      {findings.length > 0 && <><h4>Hallazgos</h4><ul className="migue-findings">{findings.map((f, i) => <li key={i}>
        <span className={`migue-kind kind-${f.kind}`}>{KIND_LABEL[f.kind]} · {SEVERITY_LABEL[f.severity]}</span> {f.observation}{f.area ? ` (${f.area})` : ""}
      </li>)}</ul></>}
      {output.recommendations.length > 0 && <><h4>Sugerencias de Migue</h4><ul className="migue-recommendations">{output.recommendations.map((r) => <li key={r}>{r}</li>)}</ul></>}
      <p className="migue-meta">Rúbrica {analysis.rubric_version} · {analysis.model} · {analysis.prompt_version} · {day(analysis.created_at)}. Es una sugerencia: revisala antes de usarla.</p>
    </div>}

    {canReview && <div className="migue-review">
      {mode === "idle" && <div className="migue-review-actions">
        <span>{lastReview ? "¿Cambiar tu revisión?" : "¿Coincide con lo que ves?"}</span>
        <button className="ok" disabled={busy} onClick={() => void review("confirmado")}>{busy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}Confirmar</button>
        <button disabled={busy} onClick={() => { setCorrected(analysis.suggested_status); setMode("corregir"); }}><PencilLine size={14} />Corregir</button>
        <button disabled={busy} onClick={() => setMode("rechazar")}><X size={14} />Rechazar</button>
      </div>}
      {mode !== "idle" && <div className="migue-review-form">
        {mode === "corregir" && <label>Estado correcto<select value={corrected} onChange={(e) => setCorrected(e.target.value as SuggestedStatus)}>{(Object.keys(STATUS_LABEL) as SuggestedStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>}
        <label>{mode === "corregir" ? "Qué estaba mal (opcional)" : "Por qué se descarta (opcional)"}<textarea rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={mode === "corregir" ? "Ej.: los juegos están bien, es pintura vieja" : "Ej.: la foto es de otro lugar"} /></label>
        <div className="migue-review-actions">
          <button disabled={busy} onClick={() => { setMode("idle"); setComment(""); }}>Cancelar</button>
          <button className="ok" disabled={busy} onClick={() => void review(mode === "corregir" ? "corregido" : "rechazado")}>{busy && <LoaderCircle size={14} className="spin" />}Guardar</button>
        </div>
      </div>}
      {error && <p className="migue-error">{error}</p>}
    </div>}
  </section>;
}
