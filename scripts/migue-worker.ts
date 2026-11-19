// Worker de Migue: analiza las fotos encoladas en public.migue_jobs.
//
// Corre aparte de la web (proceso PM2 "applaza-migue"), así un análisis lento nunca traba la
// carga de evidencias. Toma un trabajo por vez con migue_claim_jobs (FOR UPDATE SKIP LOCKED),
// guarda el resultado sin pisar nada y reintenta con espera creciente si el proveedor falla.
//
// Uso:
//   node --env-file=<.env> scripts/migue-worker.ts            -> queda escuchando la cola
//   node --env-file=<.env> scripts/migue-worker.ts --una-vez 5 -> procesa hasta 5 trabajos y termina
//
// Variables: MIGUE_SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
// MIGUE_VISION_MODE ("real" para enviar fotos al proveedor; si no, modo prueba),
// OPENROUTER_API_KEY, OPENROUTER_MODEL / MIGUE_VISION_MODEL,
// MIGUE_MONTHLY_BUDGET_USD (opcional: deja de analizar al llegar al tope del mes).

import { createClient } from "@supabase/supabase-js";
import { hostname } from "node:os";
import { analyzePhoto } from "../lib/migue-vision/analyze.ts";
import type { PhotoAnalysisInput, Rubric } from "../lib/migue-vision/contracts.ts";
import { getVisionProvider } from "../lib/migue-vision/provider.ts";
import { RUBRIC_V1 } from "../lib/migue-vision/rubric-v1.ts";

const IDLE_MS = 20_000;
const BETWEEN_JOBS_MS = 1_000;
const BUDGET_PAUSE_MS = 30 * 60_000;
const SPACE_TYPES = ["plaza", "espacio_verde", "platabanda"] as const;

const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const apiUrl = (process.env.MIGUE_SUPABASE_URL || publicUrl)?.replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!apiUrl || !serviceKey) {
  console.error("Faltan MIGUE_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const db = createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const provider = getVisionProvider(process.env);
const workerId = `${hostname()}:${process.pid}`;
const budget = Number(process.env.MIGUE_MONTHLY_BUDGET_USD) || null;

const onceIndex = process.argv.indexOf("--una-vez");
const maxJobs = onceIndex >= 0 ? Math.max(1, Number(process.argv[onceIndex + 1]) || 1) : Infinity;

let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message: string) => console.log(`[migue] ${message}`);

interface Job { id: string; photo_id: string; rubric_version: string; attempts: number }

/** La rúbrica que se usa es la guardada en la base para ese trabajo (auditable), no la del código. */
const rubricCache = new Map<string, Rubric>();
async function loadRubric(version: string): Promise<Rubric> {
  const cached = rubricCache.get(version);
  if (cached) return cached;
  const { data, error } = await db.from("migue_rubrics").select("definition").eq("version", version).single();
  if (error || !data) throw new Error(`No se encontró la rúbrica ${version}.`);
  const rubric = data.definition as Rubric;
  if (!Array.isArray(rubric?.dimensions) || !rubric.dimensions.length) throw new Error(`La rúbrica ${version} no tiene dimensiones.`);
  rubricCache.set(version, rubric);
  return rubric;
}

/** JSON con las claves ordenadas: Postgres (jsonb) no conserva el orden original. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Registra la rúbrica del código si todavía no está en la base (inactiva: activarla es una decisión aparte). */
async function registerCodeRubric() {
  const { data } = await db.from("migue_rubrics").select("definition").eq("version", RUBRIC_V1.version).maybeSingle();
  if (!data) {
    const { error } = await db.from("migue_rubrics").insert({ version: RUBRIC_V1.version, name: RUBRIC_V1.name, definition: RUBRIC_V1, active: false });
    if (error) throw new Error(`No se pudo registrar la rúbrica: ${error.message}`);
    log(`Rúbrica ${RUBRIC_V1.version} registrada (inactiva).`);
  } else if (canonical(data.definition) !== canonical(RUBRIC_V1)) {
    log(`AVISO: la rúbrica ${RUBRIC_V1.version} de la base no coincide con la del código. Se usa la de la base; para cambiarla hay que crear una versión nueva.`);
  }
}

async function monthSpend(): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const { data, error } = await db.from("migue_usage").select("cost_usd").gte("created_at", start.toISOString());
  if (error) throw new Error(`No se pudo leer el gasto del mes: ${error.message}`);
  return (data ?? []).reduce((sum, row) => sum + Number(row.cost_usd ?? 0), 0);
}

async function photoInput(photoId: string): Promise<PhotoAnalysisInput | null> {
  const { data, error } = await db
    .from("maintenance_photos")
    .select("id, image_url, created_at, maintenance_tasks(green_spaces(type))")
    .eq("id", photoId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la foto: ${error.message}`);
  if (!data) return null;
  const task = data.maintenance_tasks as unknown as { green_spaces: { type: string } | null } | null;
  const type = task?.green_spaces?.type;
  // Dentro del VPS la foto se baja por la red interna, no dando la vuelta por internet.
  const imageUrl = publicUrl && apiUrl !== publicUrl && data.image_url.startsWith(publicUrl) ? apiUrl + data.image_url.slice(publicUrl.length) : data.image_url;
  return {
    photoId: data.id,
    imageUrl,
    spaceType: SPACE_TYPES.includes(type as (typeof SPACE_TYPES)[number]) ? (type as PhotoAnalysisInput["spaceType"]) : "espacio_verde",
    controlDate: String(data.created_at).slice(0, 10),
  };
}

async function finish(job: Job, succeeded: boolean, errorText?: string, retryable = true) {
  const { error } = await db.rpc("migue_finish_job", { job: job.id, succeeded, error_text: errorText ?? null, retryable });
  if (error) log(`No se pudo cerrar el trabajo ${job.id}: ${error.message}`);
}

async function recordUsage(job: Job, ok: boolean, call: { mode: string; model: string; usage: { input_tokens: number | null; output_tokens: number | null; cost_usd: number | null } }) {
  const { error } = await db.from("migue_usage").insert({
    feature: "analisis_foto",
    job_id: job.id,
    mode: call.mode,
    model: call.model,
    ok,
    input_tokens: call.usage.input_tokens,
    output_tokens: call.usage.output_tokens,
    cost_usd: call.usage.cost_usd,
  });
  if (error) log(`No se pudo registrar el uso: ${error.message}`);
}

async function processJob(job: Job) {
  const input = await photoInput(job.photo_id);
  if (!input) return finish(job, false, "La foto ya no existe.", false);
  const rubric = await loadRubric(job.rubric_version);

  const outcome = await analyzePhoto(input, provider, rubric);
  if (!outcome.ok) {
    if (outcome.call) await recordUsage(job, false, outcome.call);
    log(`Foto ${job.photo_id}: ${outcome.error}${outcome.retryable ? " (se reintenta)" : ""}`);
    return finish(job, false, outcome.error, outcome.retryable);
  }

  const r = outcome.result;
  await recordUsage(job, true, { mode: r.mode, model: r.model, usage: r.usage });
  const { error } = await db.from("photo_analyses").insert({
    photo_id: job.photo_id,
    job_id: job.id,
    mode: r.mode,
    model: r.model,
    prompt_version: r.prompt_version,
    rubric_version: r.rubric_version,
    suggested_status: r.status,
    overall_score: r.overall_score,
    coverage_evaluated: r.coverage.evaluated,
    coverage_total: r.coverage.total,
    reasons: r.reasons,
    output: r.output,
    warnings: outcome.warnings,
    duration_ms: r.duration_ms,
  });
  // job_id es único: si el worker se cortó después de guardar, el reintento no duplica.
  if (error && error.code !== "23505") {
    log(`Foto ${job.photo_id}: no se pudo guardar el análisis: ${error.message}`);
    return finish(job, false, `No se pudo guardar el análisis: ${error.message}`, true);
  }
  const cost = r.usage.cost_usd !== null ? ` · USD ${r.usage.cost_usd.toFixed(5)}` : "";
  log(`Foto ${job.photo_id}: ${r.status} (${r.overall_score ?? "s/p"}) · ${r.mode} · ${r.model}${cost} · ${r.duration_ms} ms`);
  return finish(job, true);
}

async function main() {
  log(`Iniciado (${workerId}) en modo ${provider.mode.toUpperCase()} con ${provider.model}${budget ? `, tope USD ${budget}/mes` : ""}.`);
  await registerCodeRubric();

  let processed = 0;
  while (!stopping && processed < maxJobs) {
    if (budget !== null && (await monthSpend()) >= budget) {
      log(`Se alcanzó el tope de USD ${budget} del mes: se pausa el análisis.`);
      if (maxJobs !== Infinity) break;
      await sleep(BUDGET_PAUSE_MS);
      continue;
    }

    const { data, error } = await db.rpc("migue_claim_jobs", { worker: workerId, batch: 1 });
    if (error) {
      log(`No se pudo leer la cola: ${error.message}`);
      await sleep(IDLE_MS);
      continue;
    }
    const job = (data as Job[] | null)?.[0];
    if (!job) {
      if (maxJobs !== Infinity) break;
      await sleep(IDLE_MS);
      continue;
    }

    try {
      await processJob(job);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`Foto ${job.photo_id}: ${message}`);
      await finish(job, false, message, true);
    }
    processed += 1;
    await sleep(BETWEEN_JOBS_MS);
  }
  log(`Fin (${processed} trabajos).`);
}

main().catch((err) => {
  console.error("[migue] Error fatal:", err);
  process.exit(1);
});
