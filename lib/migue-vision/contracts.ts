// Contratos de Migue Intelligence: análisis de una foto de control contra una rúbrica versionada.
// El modelo devuelve ModelPhotoOutput; el servidor lo valida (validate.ts) y deriva el estado con
// reglas trazables (scoring.ts). El estado nunca lo decide el modelo sin explicar por qué.

export type SuggestedStatus = "satisfactorio" | "requiere_atencion" | "critico" | "indeterminado";
export type FindingKind = "observado" | "posible_problema" | "no_determinable";
export type Severity = "baja" | "media" | "alta";
export type EvidenceLevel = "buena" | "aceptable" | "insuficiente";
export type EvidenceIssue = "borrosa" | "oscura" | "sobreexpuesta" | "encuadre_parcial" | "obstruida" | "lejana" | "no_es_espacio_verde";
export type AnalysisMode = "real" | "prueba";

export interface RubricDimension {
  key: string;
  label: string;
  /** Qué mirar. Va textual al prompt. */
  guidance: string;
  /** Peso en el promedio (solo entre dimensiones evaluadas). */
  weight: number;
}

export interface Rubric {
  version: string;
  name: string;
  dimensions: RubricDimension[];
  thresholds: {
    /** Una dimensión evaluada por debajo de este puntaje lleva a "crítico". */
    critical: number;
    /** Una dimensión evaluada por debajo de este puntaje lleva a "requiere atención". */
    attention: number;
  };
  /** Mínimo de dimensiones evaluadas para dar un estado distinto de "indeterminado". */
  minEvaluatedDimensions: number;
  /** Confianza mínima para que una dimensión o hallazgo cuente en el estado. */
  minConfidence: number;
}

export interface DimensionAssessment {
  dimension: string;
  evaluable: boolean;
  /** 0-100, solo si evaluable. */
  score: number | null;
  /** 0-1 */
  confidence: number;
  /** Qué se ve en la foto que justifica el puntaje, o por qué no se puede evaluar. */
  evidence: string;
}

export interface Finding {
  dimension: string;
  observation: string;
  kind: FindingKind;
  severity: Severity;
  confidence: number;
  requires_review: boolean;
  /** Zona aproximada de la imagen, si se puede indicar (p. ej. "esquina inferior izquierda"). */
  area: string | null;
}

export interface ModelPhotoOutput {
  evidence_quality: { level: EvidenceLevel; issues: EvidenceIssue[] };
  scene_summary: string;
  dimensions: DimensionAssessment[];
  findings: Finding[];
  recommendations: string[];
  privacy: { people_visible: boolean; plates_visible: boolean };
}

export interface StatusDerivation {
  status: SuggestedStatus;
  /** Promedio ponderado de las dimensiones evaluadas con confianza suficiente; null si no hay. */
  overall_score: number | null;
  /** Dimensiones evaluadas / dimensiones de la rúbrica. */
  coverage: { evaluated: number; total: number };
  /** Motivos legibles del estado (trazabilidad). */
  reasons: string[];
}

export interface ProviderUsage {
  input_tokens: number | null;
  output_tokens: number | null;
  /** USD informado por el proveedor; null si no lo informa. */
  cost_usd: number | null;
}

export interface PhotoAnalysisResult extends StatusDerivation {
  mode: AnalysisMode;
  model: string;
  prompt_version: string;
  rubric_version: string;
  output: ModelPhotoOutput;
  usage: ProviderUsage;
  duration_ms: number;
}

export interface PhotoAnalysisInput {
  photoId: string;
  imageUrl: string;
  spaceType: "plaza" | "espacio_verde" | "platabanda";
  /** Fecha del control (YYYY-MM-DD). Solo contexto; no se usa para puntuar. */
  controlDate: string;
}
