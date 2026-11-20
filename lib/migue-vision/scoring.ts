import type { ModelPhotoOutput, Rubric, StatusDerivation } from "./contracts.ts";

// Estado sugerido derivado con reglas fijas de la rúbrica, no por el modelo. Cada regla que se
// aplica deja un motivo legible, para que el inspector vea por qué Migue sugiere ese estado.
//
// Reglas, en orden:
// 1. Evidencia insuficiente, o menos dimensiones evaluadas que el mínimo → indeterminado.
// 2. Una dimensión evaluada (con confianza suficiente) bajo el umbral crítico, o un hallazgo
//    OBSERVADO de severidad alta con confianza suficiente → crítico.
// 3. Una dimensión bajo el umbral de atención, o un hallazgo observado de severidad media o alta
//    → requiere atención.
// 4. Si no → satisfactorio.
// Los "posible_problema" no cambian el estado: se muestran para revisión humana.

export function deriveStatus(output: ModelPhotoOutput, rubric: Rubric): StatusDerivation {
  const labels = new Map(rubric.dimensions.map((d) => [d.key, d.label]));
  const weights = new Map(rubric.dimensions.map((d) => [d.key, d.weight]));
  const label = (key: string) => labels.get(key) ?? key;

  const counted = output.dimensions.filter(
    (d) => d.evaluable && d.score !== null && d.confidence >= rubric.minConfidence && labels.has(d.dimension),
  );
  const coverage = { evaluated: counted.length, total: rubric.dimensions.length };

  let weightSum = 0;
  let scoreSum = 0;
  for (const d of counted) {
    const w = weights.get(d.dimension) ?? 0;
    weightSum += w;
    scoreSum += w * (d.score as number);
  }
  const overall_score = weightSum > 0 ? Math.round(scoreSum / weightSum) : null;

  if (output.evidence_quality.level === "insuficiente") {
    const issues = output.evidence_quality.issues.join(", ");
    return { status: "indeterminado", overall_score, coverage, reasons: [`La foto no alcanza para evaluar${issues ? ` (${issues})` : ""}.`] };
  }
  if (counted.length < rubric.minEvaluatedDimensions) {
    return {
      status: "indeterminado",
      overall_score,
      coverage,
      reasons: [`Solo se pudieron evaluar ${counted.length} de ${coverage.total} aspectos; hacen falta al menos ${rubric.minEvaluatedDimensions}.`],
    };
  }

  const observed = output.findings.filter((f) => f.kind === "observado" && f.confidence >= rubric.minConfidence);
  const critical: string[] = [];
  const attention: string[] = [];

  // Lo que se ve solo en parte suma al promedio y queda a la vista, pero no cambia el estado por
  // sí solo: un detalle visto de lejos no alcanza para levantar una alerta. Eso vale solo si hay
  // suficientes aspectos vistos con claridad que respalden el estado; si no, lo parcial cuenta.
  const clearCount = counted.filter((d) => d.visibility !== "parcial").length;
  const discountPartial = clearCount >= rubric.minEvaluatedDimensions;
  const partial: string[] = [];
  for (const d of counted) {
    const score = d.score as number;
    if (score >= rubric.thresholds.attention) continue;
    if (d.visibility === "parcial" && discountPartial) {
      partial.push(`${label(d.dimension)}: ${score}/100, pero se ve solo en parte (no cambia el estado; conviene revisarlo).`);
    } else if (score < rubric.thresholds.critical) critical.push(`${label(d.dimension)}: ${score}/100 (bajo ${rubric.thresholds.critical}).`);
    else attention.push(`${label(d.dimension)}: ${score}/100 (bajo ${rubric.thresholds.attention}).`);
  }
  for (const f of observed) {
    if (f.severity === "alta") critical.push(`Hallazgo grave en ${label(f.dimension)}: ${f.observation}`);
    else if (f.severity === "media") attention.push(`Hallazgo en ${label(f.dimension)}: ${f.observation}`);
  }

  if (critical.length) return { status: "critico", overall_score, coverage, reasons: [...critical, ...attention, ...partial] };
  if (attention.length) return { status: "requiere_atencion", overall_score, coverage, reasons: [...attention, ...partial] };
  if (partial.length) return { status: "satisfactorio", overall_score, coverage, reasons: [`Lo que se ve con claridad está en buen estado.`, ...partial] };
  return { status: "satisfactorio", overall_score, coverage, reasons: [`Los ${counted.length} aspectos evaluados están en buen estado.`] };
}
