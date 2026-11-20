// Evaluación del análisis de fotos de Migue: analiza una muestra de fotos reales y guarda los
// resultados en un archivo JSON, SIN escribir nada en la base. Sirve para revisar foto por foto
// y comparar versiones de prompt o reglas antes de publicarlas.
//
// Uso (en el VPS, con las mismas variables que el worker):
//   node --env-file=<.env> --env-file=<migue.env> scripts/migue-evaluar.ts <salida.json> [cantidad] [repeticiones]
//   node ... scripts/migue-evaluar.ts <salida.json> --fotos id1,id2,...  [repeticiones]
//
// La muestra es fija (las mismas fotos en cada corrida) y variada: reparte entre tipos de espacio
// y controles. "repeticiones" analiza cada foto varias veces para medir cuánto varía el modelo.

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { analyzePhoto } from "../lib/migue-vision/analyze.ts";
import type { PhotoAnalysisInput } from "../lib/migue-vision/contracts.ts";
import { PROMPT_VERSION } from "../lib/migue-vision/prompt.ts";
import { getVisionProvider } from "../lib/migue-vision/provider.ts";
import { CURRENT_RUBRIC } from "../lib/migue-vision/rubric.ts";

const [, , outFile, second, third] = process.argv;
if (!outFile) {
  console.error("Falta el archivo de salida.");
  process.exit(1);
}
const explicitIds = second === "--fotos" ? third?.split(",").filter(Boolean) : null;
const sampleSize = explicitIds ? explicitIds.length : Number(second) || 12;
const repeats = Math.max(1, Number(explicitIds ? process.argv[5] : third) || 1);

const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const apiUrl = (process.env.MIGUE_SUPABASE_URL || publicUrl)?.replace(/\/$/, "");
const db = createClient(apiUrl!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const provider = getVisionProvider(process.env);

interface Row { id: string; image_url: string; photo_type: string; created_at: string; maintenance_tasks: { green_spaces: { name: string; type: string } } }

async function loadSample(): Promise<Row[]> {
  const columns = "id, image_url, photo_type, created_at, maintenance_tasks(green_spaces(name, type))";
  if (explicitIds) {
    const { data, error } = await db.from("maintenance_photos").select(columns).in("id", explicitIds);
    if (error) throw error;
    return explicitIds.map((id) => (data as unknown as Row[]).find((row) => row.id === id)).filter((row): row is Row => Boolean(row));
  }
  const { data, error } = await db.from("maintenance_photos").select(columns).order("id");
  if (error) throw error;
  const rows = data as unknown as Row[];
  // Muestra fija y repartida: recorre por tipo de espacio y control, tomando de a una.
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = `${row.maintenance_tasks?.green_spaces?.type}-${row.photo_type}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const lists = [...groups.values()];
  const picked: Row[] = [];
  for (let i = 0; picked.length < sampleSize && lists.some((list) => i < list.length); i++) {
    for (const list of lists) {
      const row = list[Math.floor((i * 7919) % list.length)];
      if (row && !picked.includes(row) && picked.length < sampleSize) picked.push(row);
    }
  }
  return picked;
}

const sample = await loadSample();
console.log(`[evaluación] ${sample.length} fotos × ${repeats} · ${provider.mode} · ${provider.model} · prompt ${PROMPT_VERSION} · rúbrica ${CURRENT_RUBRIC.version}`);

const results = [];
let cost = 0;
for (const row of sample) {
  const space = row.maintenance_tasks?.green_spaces;
  const imageUrl = publicUrl && apiUrl !== publicUrl && row.image_url.startsWith(publicUrl) ? apiUrl + row.image_url.slice(publicUrl.length) : row.image_url;
  const input: PhotoAnalysisInput = {
    photoId: row.id,
    imageUrl,
    spaceType: (["plaza", "espacio_verde", "platabanda"].includes(space?.type) ? space.type : "espacio_verde") as PhotoAnalysisInput["spaceType"],
    controlDate: String(row.created_at).slice(0, 10),
  };
  const runs = [];
  for (let r = 0; r < repeats; r++) {
    const outcome = await analyzePhoto(input, provider, CURRENT_RUBRIC);
    if (outcome.ok) {
      cost += outcome.result.usage.cost_usd ?? 0;
      runs.push({ ok: true, status: outcome.result.status, score: outcome.result.overall_score, coverage: outcome.result.coverage, reasons: outcome.result.reasons, output: outcome.result.output, warnings: outcome.warnings });
    } else {
      cost += outcome.call?.usage.cost_usd ?? 0;
      runs.push({ ok: false, error: outcome.error });
    }
  }
  const first = runs[0] as { status?: string; score?: number | null; error?: string };
  console.log(`[evaluación] ${space?.name} (${space?.type}, ${row.photo_type}): ${first.status ?? first.error} ${first.score ?? ""}${repeats > 1 ? ` · repeticiones: ${runs.map((run) => ("status" in run ? `${run.status}/${run.score}` : "error")).join(", ")}` : ""}`);
  results.push({ photo_id: row.id, image_url: row.image_url, space: space?.name, type: space?.type, control: row.photo_type, date: input.controlDate, runs });
}

writeFileSync(outFile, JSON.stringify({ prompt_version: PROMPT_VERSION, model: provider.model, mode: provider.mode, results }, null, 2));
console.log(`[evaluación] Listo · costo USD ${cost.toFixed(4)} · ${outFile}`);
