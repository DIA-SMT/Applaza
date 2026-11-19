import type { AnalysisMode, PhotoAnalysisInput, PhotoAnalysisResult, ProviderUsage, Rubric } from "./contracts.ts";
import { PROMPT_VERSION } from "./prompt.ts";
import { ProviderError, type VisionProvider } from "./provider.ts";
import { deriveStatus } from "./scoring.ts";
import { parseJsonContent, validateModelOutput } from "./validate.ts";

export type AnalyzeOutcome =
  | { ok: true; result: PhotoAnalysisResult; warnings: string[] }
  | {
      ok: false;
      error: string;
      retryable: boolean;
      rawContent?: string;
      /** Si el proveedor llegó a responder, la llamada se cobró igual: se registra. */
      call?: { mode: AnalysisMode; model: string; usage: ProviderUsage };
    };

/**
 * Analiza una foto: proveedor → JSON → validación estricta → estado por reglas.
 * No escribe nada: guardar el resultado y reintentar es tarea de la cola (worker).
 * Una respuesta que no cumple el esquema se informa como error reintentable (puede ser un desvío
 * puntual del modelo), y se devuelve el texto crudo para auditar.
 */
export async function analyzePhoto(input: PhotoAnalysisInput, provider: VisionProvider, rubric: Rubric): Promise<AnalyzeOutcome> {
  const started = Date.now();
  let response;
  try {
    response = await provider.analyze(input, rubric);
  } catch (error) {
    if (error instanceof ProviderError) return { ok: false, error: error.message, retryable: error.retryable };
    return { ok: false, error: "Error inesperado al consultar el proveedor de IA.", retryable: true };
  }

  const call = { mode: response.mode, model: response.model, usage: response.usage };
  let parsed: unknown;
  try {
    parsed = parseJsonContent(response.content);
  } catch {
    return { ok: false, error: "La respuesta del modelo no es JSON válido.", retryable: true, rawContent: response.content, call };
  }

  const validation = validateModelOutput(parsed, rubric);
  if (!validation.ok) {
    return { ok: false, error: `Respuesta fuera de esquema: ${validation.errors.slice(0, 5).join("; ")}`, retryable: true, rawContent: response.content, call };
  }

  return {
    ok: true,
    warnings: validation.warnings,
    result: {
      ...deriveStatus(validation.value, rubric),
      mode: response.mode,
      model: response.model,
      prompt_version: PROMPT_VERSION,
      rubric_version: rubric.version,
      output: validation.value,
      usage: response.usage,
      duration_ms: Date.now() - started,
    },
  };
}
