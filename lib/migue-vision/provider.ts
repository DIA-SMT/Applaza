import type { AnalysisMode, PhotoAnalysisInput, ProviderUsage, Rubric } from "./contracts.ts";
import { buildResponseSchema, buildSystemPrompt, buildUserPrompt } from "./prompt.ts";

// Adaptador de proveedor multimodal. Hoy: OpenRouter (la misma cuenta que ya usa Migue).
// Si no hay clave, o MIGUE_VISION_MODE=prueba, se usa el proveedor de PRUEBA: devuelve resultados
// simulados marcados como tales (mode="prueba") y nunca se presentan como un análisis real.

export interface ProviderResponse {
  mode: AnalysisMode;
  model: string;
  /** Texto crudo devuelto (se parsea y valida afuera). */
  content: string;
  usage: ProviderUsage;
}

export interface VisionProvider {
  readonly mode: AnalysisMode;
  readonly model: string;
  analyze(input: PhotoAnalysisInput, rubric: Rubric): Promise<ProviderResponse>;
}

export class ProviderError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "ProviderError";
    this.retryable = retryable;
  }
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Descarga la foto y la manda embebida: no depende de que el bucket sea público. */
export async function fetchImageAsDataUrl(url: string, fetchImpl: typeof fetch = fetch, timeoutMs = 20_000): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new ProviderError("No se pudo descargar la foto.", true);
  }
  if (response.status === 404) throw new ProviderError("La foto ya no existe.", false);
  if (!response.ok) throw new ProviderError(`Descarga de la foto: HTTP ${response.status}.`, response.status >= 500);
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!IMAGE_TYPES.includes(type)) throw new ProviderError(`Tipo de archivo no admitido: ${type || "desconocido"}.`, false);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ProviderError("La foto supera el tamaño máximo.", false);
  return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
}

interface OpenRouterOptions {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  siteUrl?: string;
  appName?: string;
}

export class OpenRouterVisionProvider implements VisionProvider {
  readonly mode = "real" as const;
  readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly options: OpenRouterOptions;

  constructor(options: OpenRouterOptions) {
    this.options = options;
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async analyze(input: PhotoAnalysisInput, rubric: Rubric): Promise<ProviderResponse> {
    const image = await fetchImageAsDataUrl(input.imageUrl, this.fetchImpl);
    let response: Response;
    try {
      response = await this.fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 60_000),
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": this.options.siteUrl || "http://localhost:3000",
          "X-Title": this.options.appName || "Applaza",
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          max_tokens: 1800,
          messages: [
            { role: "system", content: buildSystemPrompt(rubric) },
            {
              role: "user",
              content: [
                { type: "text", text: buildUserPrompt(input) },
                { type: "image_url", image_url: { url: image, detail: "high" } },
              ],
            },
          ],
          response_format: { type: "json_schema", json_schema: { name: "analisis_foto", strict: true, schema: buildResponseSchema(rubric) } },
          // Solo proveedores que no guardan ni usan los datos para entrenar, y que respetan el esquema.
          provider: { data_collection: "deny", require_parameters: true },
          usage: { include: true },
        }),
      });
    } catch {
      throw new ProviderError("El proveedor de IA no respondió a tiempo.", true);
    }

    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      throw new ProviderError(`Proveedor de IA: HTTP ${response.status}.`, retryable);
    }

    const payload = (await response.json().catch(() => null)) as {
      model?: string;
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    } | null;
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new ProviderError("El proveedor de IA devolvió una respuesta vacía.", true);

    return {
      mode: "real",
      model: payload?.model ?? this.model,
      content,
      usage: {
        input_tokens: payload?.usage?.prompt_tokens ?? null,
        output_tokens: payload?.usage?.completion_tokens ?? null,
        cost_usd: typeof payload?.usage?.cost === "number" ? payload.usage.cost : null,
      },
    };
  }
}

/**
 * Proveedor de PRUEBA. Resultado determinístico según el id de la foto, para probar el circuito
 * (cola, validación, guardado, pantallas) sin clave ni costo. No mira la imagen.
 */
export class TestVisionProvider implements VisionProvider {
  readonly mode = "prueba" as const;
  readonly model = "prueba/sin-modelo";

  async analyze(input: PhotoAnalysisInput, rubric: Rubric): Promise<ProviderResponse> {
    let seed = 0;
    for (const ch of input.photoId) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const pick = (n: number) => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed % n;
    };
    const dimensions = rubric.dimensions.map((d) => {
      const evaluable = pick(4) !== 0;
      return {
        dimension: d.key,
        visibility: evaluable ? "clara" : "no_visible",
        evaluable,
        score: evaluable ? 35 + pick(66) : null,
        confidence: evaluable ? 0.5 + pick(50) / 100 : 0.2,
        evidence: evaluable ? "[MODO PRUEBA] Valor simulado." : "[MODO PRUEBA] Simulado como no visible.",
      };
    });
    const output = {
      evidence_quality: { level: pick(8) === 0 ? "insuficiente" : "buena", issues: [] },
      scene_summary: "[MODO PRUEBA] Resultado simulado: no proviene del análisis de la foto.",
      season_light_note: null,
      dimensions,
      findings: [],
      recommendations: [],
      privacy: { people_visible: false, plates_visible: false },
    };
    return { mode: "prueba", model: this.model, content: JSON.stringify(output), usage: { input_tokens: 0, output_tokens: 0, cost_usd: 0 } };
  }
}

/**
 * Elige el proveedor según el entorno del servidor. La clave nunca llega al navegador.
 * El envío de fotos a un proveedor externo requiere activarlo a propósito (MIGUE_VISION_MODE=real):
 * tener la clave de OpenRouter cargada (la usa el chat) no alcanza.
 */
export function getVisionProvider(env: Record<string, string | undefined> = process.env): VisionProvider {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (env.MIGUE_VISION_MODE !== "real" || !apiKey) return new TestVisionProvider();
  // Misma cuenta, modelo y encabezados que el chat de Migue (app/api/chat/route.ts).
  return new OpenRouterVisionProvider({
    apiKey,
    model: env.MIGUE_VISION_MODEL?.trim() || env.OPENROUTER_MODEL?.trim() || "openai/gpt-4o-mini",
    siteUrl: env.OPENROUTER_SITE_URL,
    appName: env.OPENROUTER_APP_NAME,
  });
}
