import type {
  DimensionAssessment,
  EvidenceIssue,
  EvidenceLevel,
  Finding,
  FindingKind,
  ModelPhotoOutput,
  Rubric,
  Severity,
} from "./contracts.ts";

// Validación estricta de la respuesta del modelo. Lo que no cumple el contrato se rechaza (no se
// "arregla" en silencio); lo único que se completa es una dimensión omitida, que queda como no
// evaluable y con una advertencia, porque omitirla equivale a no haberla evaluado.

const EVIDENCE_LEVELS: EvidenceLevel[] = ["buena", "aceptable", "insuficiente"];
const EVIDENCE_ISSUES: EvidenceIssue[] = ["borrosa", "oscura", "sobreexpuesta", "encuadre_parcial", "obstruida", "lejana", "no_es_espacio_verde"];
const FINDING_KINDS: FindingKind[] = ["observado", "posible_problema", "no_determinable"];
const SEVERITIES: Severity[] = ["baja", "media", "alta"];

const MAX_TEXT = 400;
const MAX_FINDINGS = 20;
const MAX_RECOMMENDATIONS = 6;

export type ValidationResult =
  | { ok: true; value: ModelPhotoOutput; warnings: string[] }
  | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);

class Collector {
  errors: string[] = [];
  warnings: string[] = [];
  fail(path: string, message: string) {
    this.errors.push(`${path}: ${message}`);
  }
}

function text(c: Collector, value: unknown, path: string, { allowEmpty = false } = {}): string {
  if (typeof value !== "string") {
    c.fail(path, "debe ser texto");
    return "";
  }
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!allowEmpty && !trimmed) c.fail(path, "no puede estar vacío");
  return trimmed.length > MAX_TEXT ? `${trimmed.slice(0, MAX_TEXT - 1)}…` : trimmed;
}

function oneOf<T extends string>(c: Collector, value: unknown, options: readonly T[], path: string): T {
  if (typeof value !== "string" || !options.includes(value as T)) c.fail(path, `debe ser uno de: ${options.join(", ")}`);
  return value as T;
}

function bool(c: Collector, value: unknown, path: string): boolean {
  if (typeof value !== "boolean") c.fail(path, "debe ser verdadero o falso");
  return value === true;
}

function confidence(c: Collector, value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    c.fail(path, "debe ser un número entre 0 y 1");
    return 0;
  }
  return Math.round(value * 100) / 100;
}

function dimensions(c: Collector, value: unknown, rubric: Rubric): DimensionAssessment[] {
  if (!Array.isArray(value)) {
    c.fail("dimensions", "debe ser una lista");
    return [];
  }
  const known = new Set(rubric.dimensions.map((d) => d.key));
  const seen = new Map<string, DimensionAssessment>();

  value.forEach((item, index) => {
    const path = `dimensions[${index}]`;
    if (!isObj(item)) return c.fail(path, "debe ser un objeto");
    const key = item.dimension;
    if (typeof key !== "string" || !known.has(key)) return c.fail(`${path}.dimension`, `dimensión desconocida: ${String(key)}`);
    if (seen.has(key)) return c.fail(`${path}.dimension`, `dimensión repetida: ${key}`);

    const evaluable = bool(c, item.evaluable, `${path}.evaluable`);
    let score: number | null = null;
    if (evaluable) {
      if (typeof item.score !== "number" || !Number.isInteger(item.score) || item.score < 0 || item.score > 100) {
        c.fail(`${path}.score`, "debe ser un entero entre 0 y 100 cuando la dimensión es evaluable");
      } else score = item.score;
    } else if (item.score !== null && item.score !== undefined) {
      c.fail(`${path}.score`, "debe ser nulo cuando la dimensión no es evaluable");
    }

    seen.set(key, {
      dimension: key,
      evaluable,
      score,
      confidence: confidence(c, item.confidence, `${path}.confidence`),
      evidence: text(c, item.evidence, `${path}.evidence`),
    });
  });

  return rubric.dimensions.map((d) => {
    const found = seen.get(d.key);
    if (found) return found;
    c.warnings.push(`El modelo no evaluó "${d.label}"; queda como no evaluable.`);
    return { dimension: d.key, evaluable: false, score: null, confidence: 0, evidence: "Sin evaluación del modelo." };
  });
}

function findings(c: Collector, value: unknown, rubric: Rubric): Finding[] {
  if (!Array.isArray(value)) {
    c.fail("findings", "debe ser una lista");
    return [];
  }
  if (value.length > MAX_FINDINGS) c.fail("findings", `no puede tener más de ${MAX_FINDINGS} hallazgos`);
  const known = new Set(rubric.dimensions.map((d) => d.key));
  return value.slice(0, MAX_FINDINGS).map((item, index) => {
    const path = `findings[${index}]`;
    if (!isObj(item)) {
      c.fail(path, "debe ser un objeto");
      return null;
    }
    if (typeof item.dimension !== "string" || !known.has(item.dimension)) c.fail(`${path}.dimension`, `dimensión desconocida: ${String(item.dimension)}`);
    const area = item.area === null || item.area === undefined ? null : text(c, item.area, `${path}.area`, { allowEmpty: true }) || null;
    return {
      dimension: String(item.dimension),
      observation: text(c, item.observation, `${path}.observation`),
      kind: oneOf(c, item.kind, FINDING_KINDS, `${path}.kind`),
      severity: oneOf(c, item.severity, SEVERITIES, `${path}.severity`),
      confidence: confidence(c, item.confidence, `${path}.confidence`),
      requires_review: bool(c, item.requires_review, `${path}.requires_review`),
      area,
    } satisfies Finding;
  }).filter((f): f is Finding => f !== null);
}

export function validateModelOutput(raw: unknown, rubric: Rubric): ValidationResult {
  const c = new Collector();
  if (!isObj(raw)) return { ok: false, errors: ["la respuesta no es un objeto JSON"] };

  const quality = isObj(raw.evidence_quality) ? raw.evidence_quality : (c.fail("evidence_quality", "debe ser un objeto"), {} as Obj);
  const issues = Array.isArray(quality.issues) ? quality.issues : (c.fail("evidence_quality.issues", "debe ser una lista"), []);
  const privacy = isObj(raw.privacy) ? raw.privacy : (c.fail("privacy", "debe ser un objeto"), {} as Obj);
  const recommendations = Array.isArray(raw.recommendations) ? raw.recommendations : (c.fail("recommendations", "debe ser una lista"), []);
  if (recommendations.length > MAX_RECOMMENDATIONS) c.fail("recommendations", `no puede tener más de ${MAX_RECOMMENDATIONS}`);

  const value: ModelPhotoOutput = {
    evidence_quality: {
      level: oneOf(c, quality.level, EVIDENCE_LEVELS, "evidence_quality.level"),
      issues: [...new Set(issues.map((issue, i) => oneOf(c, issue, EVIDENCE_ISSUES, `evidence_quality.issues[${i}]`)))],
    },
    scene_summary: text(c, raw.scene_summary, "scene_summary"),
    dimensions: dimensions(c, raw.dimensions, rubric),
    findings: findings(c, raw.findings, rubric),
    recommendations: recommendations.slice(0, MAX_RECOMMENDATIONS).map((r, i) => text(c, r, `recommendations[${i}]`)),
    privacy: {
      people_visible: bool(c, privacy.people_visible, "privacy.people_visible"),
      plates_visible: bool(c, privacy.plates_visible, "privacy.plates_visible"),
    },
  };

  return c.errors.length ? { ok: false, errors: c.errors } : { ok: true, value, warnings: c.warnings };
}

/** Saca el JSON de la respuesta del modelo aunque venga envuelto en ```json ... ```. */
export function parseJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}
