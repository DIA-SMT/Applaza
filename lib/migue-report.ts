// Reporte de cada consulta del asistente al dashboard de la Direccion de IA
// (seccion "Migue" de Organizacion DIA), para ver su uso y efectividad.
//
// Reglas, porque esto corre al lado de la respuesta:
// - Apagado si falta MIGUE_API_KEY o MIGUE_DASHBOARD_URL: sin esas variables
//   no se arma ni se envia nada.
// - Nunca tira errores ni demora la respuesta: el envio tiene tiempo maximo y
//   cualquier falla se anota en el log y se descarta.
// - No manda el usuario ni su correo. Por defecto tampoco manda el texto de la
//   consulta: solo con MIGUE_ENVIAR_PREGUNTAS=1 viaja la que Migue no pudo
//   responder, con correos y numeros largos tapados. Los nombres de personas
//   NO se tapan: activarlo solo si las consultas no suelen nombrar vecinos.
//
// El formato es el que documenta el dashboard (docs/migue-conexion.md en el
// repo de Organizacion DIA). Cada consulta cuenta como una conversacion.
// Este archivo no importa nada del proyecto para poder probarlo aislado.

const REQUEST_TIMEOUT_MS = 3000;
const MAX_QUESTION_LENGTH = 300;
// Tope antes de filtrar: un texto enorme no puede trabar el servidor.
const MAX_MASK_INPUT = 1000;
// Tope del dashboard para el tiempo de respuesta: mas que eso no se informa.
const MAX_RESPONSE_MS = 600_000;

export type MigueReportConfig = { key: string; url: string; sendQuestions: boolean };

export type MigueUsage = { tokensIn: number | null; tokensOut: number | null; costUsd: number | null };

export type MigueReportInput = {
  question: string;
  topic: string;
  answered: boolean;
  // false cuando fallo el sistema (no es una consulta que Migue no sepa responder).
  ok: boolean;
  usage: MigueUsage | null;
  ms: number;
};

// Conversacion en el formato de POST /api/migue/conversaciones.
export type MigueReport = {
  conversation_id: string;
  started_at: string;
  ended_at: string;
  channel: string;
  messages: number;
  outcome: "resuelta" | "sin_respuesta";
  avg_response_ms?: number;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
  topic: string;
  unanswered_question?: string;
};

// null = reporte apagado.
export function getMigueReportConfig(env: Record<string, string | undefined> = process.env): MigueReportConfig | null {
  const key = env.MIGUE_API_KEY?.trim();
  const url = env.MIGUE_DASHBOARD_URL?.trim().replace(/\/+$/, "");
  if (!key || !url) return null;
  return { key, url, sendQuestions: env.MIGUE_ENVIAR_PREGUNTAS?.trim() === "1" };
}

export type MigueTopicFlags = {
  // Nombrados en la consulta actual.
  mentionsSpaces: boolean;
  focusedProvider: boolean;
  reportRequest: boolean;
  // Heredados de mensajes anteriores: solo cuentan si la consulta no dice otra cosa.
  spacesFromHistory: boolean;
  providerFromHistory: boolean;
};

// Minusculas y sin acentos (NFD separa la tilde y \p{M} la saca).
function plain(text: string) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es");
}

// Tema de la consulta, con las mismas palabras clave que usa la respuesta local del chat.
// Primero lo que dice la consulta actual; lo heredado de la conversacion va al final.
export function detectMigueTopic(message: string, flags: MigueTopicFlags): string {
  const text = plain(message);
  const has = (...words: string[]) => words.some((word) => text.includes(word));
  if (flags.mentionsSpaces) return "Consulta de un espacio";
  if (has("produccion", "dias fuertes", "dia fuerte", "mas fotos", "carga de evidencia")) return "Produccion de evidencias";
  if (has("cada cuanto", "frecuencia", "periodicidad", "revision")) return "Frecuencia de revisiones";
  if (flags.focusedProvider) return "Cooperativas";
  if (has("ubicacion", "ubicados", "ubicar")) return "Ubicaciones";
  if (has("observacion", "notas")) return "Observaciones";
  if (has("pendiente")) return "Pendientes";
  if (has("evidencia", "foto")) return "Evidencias";
  // Un pedido de informe sin tema propio ("pasame lo del mes").
  if (flags.reportRequest) return "Informe de auditoria";
  if (flags.spacesFromHistory) return "Consulta de un espacio";
  if (flags.providerFromHistory) return "Cooperativas";
  return "Resumen operativo";
}

// Aperturas que dicen que falta el dato, con los calificativos habituales: "No hay datos
// disponibles para ese espacio", "No tengo suficiente informacion sobre...". "No hay datos de
// fotos en ..." sin "disponibles" ni "ese/esa" se deja como respuesta: puede ser un resultado.
const MISSING_DATA_START = new RegExp(
  [
    "^(lo siento,? )?(",
    [
      "no (lo |la |los |las )?(encontr[eo]|encuentro|pude encontrar)",
      "no se encontr",
      "no (tengo|dispongo de|cuento con) (suficientes? )?(ese|esa|el|la|esos|esas|informacion|datos?)",
      "no hay (suficientes? )?(informacion|datos) (disponibles?|suficientes?)",
      "no hay suficientes? (informacion|datos)",
      "no hay (informacion|datos) (de|sobre|para) (ese|esa|el|la|esos|esas)",
      "no (esta|estan) disponibles? (ese|esa|el|la|esos|esas|los|las) (dato|datos|informacion)",
      "(ese|esa|el|la) ?(espacio|plaza|dato|cooperativa)? no (esta|figura|aparece)n? en (los datos|el contexto)",
    ].join("|"),
    ")",
  ].join(""),
);

// Sin respuesta es cuando Migue ARRANCA diciendo que no tiene el dato (el prompt le pide avisarlo).
// Solo se mira la primera oracion: una respuesta completa suele cerrar con una aclaracion del tipo
// "no hay datos de fotos en X", y eso no la hace una consulta sin responder. Tampoco cuenta un
// resultado en cero ("No encontre pendientes para septiembre"): eso es una respuesta.
export function answerSaysDataIsMissing(answer: string): boolean {
  const text = plain(answer.replace(/[*#_>`]/g, "").trim());
  const firstSentence = text.split(/(?<=[.!?])\s|\n/)[0] ?? "";
  if (/no (se )?encontr(e|aron) (pendientes|observaciones|evidencias|controles|registros|fotos)\b/.test(firstSentence)) return false;
  return MISSING_DATA_START.test(firstSentence);
}

// Lee tokens y costo de la respuesta de OpenRouter (el costo llega con usage: { include: true }).
export function readOpenRouterUsage(payload: unknown): MigueUsage | null {
  if (!payload || typeof payload !== "object" || !("usage" in payload)) return null;
  const usage = (payload as { usage?: Record<string, unknown> }).usage;
  if (!usage || typeof usage !== "object") return null;
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);
  return { tokensIn: num(usage.prompt_tokens), tokensOut: num(usage.completion_tokens), costUsd: num(usage.cost) };
}

// Tapa correos y numeros de 7 cifras o mas (documentos, telefonos). Deja montos y fechas.
export function maskPersonalData(text: string): string {
  return text
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[correo]")
    .replace(/\+?\d(?:[\s.-]{0,2}\d){6,}/g, (value: string, position: number, full: string) => {
      const before = full.slice(0, position);
      const after = full.slice(position + value.length);
      const isAmount = /\$\s*$/.test(before) || /^\s*(?:pesos|millones|mil)\b/i.test(after);
      const isDate = /^\d{1,2}[.-]\d{1,2}[.-]\d{2,4}$/.test(value.trim());
      return isAmount || isDate ? value : "[número]";
    })
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function buildMigueReport(
  input: MigueReportInput,
  id: string,
  now: number,
  options: { sendQuestions: boolean } = { sendQuestions: false },
): MigueReport {
  const duration = Math.max(0, Math.round(input.ms));
  const report: MigueReport = {
    conversation_id: `applaza:${id}`,
    started_at: new Date(now - duration).toISOString(),
    ended_at: new Date(now).toISOString(),
    channel: "App",
    // La consulta y la respuesta de Migue.
    messages: 2,
    outcome: input.answered ? "resuelta" : "sin_respuesta",
    topic: input.topic.slice(0, 80),
  };
  // Mas alla del tope del dashboard se omite: la conversacion cuenta igual, sin tiempo.
  if (duration <= MAX_RESPONSE_MS) report.avg_response_ms = duration;
  if (input.usage?.tokensIn) report.tokens_in = Math.round(input.usage.tokensIn);
  if (input.usage?.tokensOut) report.tokens_out = Math.round(input.usage.tokensOut);
  if (input.usage?.costUsd != null && input.usage.costUsd < 1000) report.cost_usd = input.usage.costUsd;
  // Una falla del sistema no es una consulta que Migue no sepa: no se manda el texto.
  if (options.sendQuestions && !input.answered && input.ok) {
    // Sin dejar un emoji partido a la mitad (Postgres rechaza el pedazo suelto).
    const question = maskPersonalData(input.question.slice(0, MAX_MASK_INPUT)).slice(0, MAX_QUESTION_LENGTH).replace(/[\uD800-\uDBFF]$/, "");
    if (question) report.unanswered_question = question;
  }
  return report;
}

// Envia el reporte. Nunca tira: si algo falla, lo anota en el log y sigue.
export async function sendMigueReport(
  report: MigueReport,
  config: MigueReportConfig,
  send: typeof fetch = fetch,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<void> {
  try {
    const response = await send(`${config.url}/api/migue/conversaciones`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ conversations: [report] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      console.warn(`[migue] el dashboard rechazo el reporte (${response.status})`);
      return;
    }
    // El dashboard responde 200 aunque descarte la fila: el motivo viene en "rejected".
    const body = (await response.json().catch(() => null)) as { rejected?: Array<{ error?: string }> } | null;
    if (Array.isArray(body?.rejected) && body.rejected.length > 0) {
      console.warn(`[migue] el dashboard descarto el reporte: ${body.rejected[0]?.error ?? "sin motivo"}`);
    }
  } catch (error) {
    console.warn("[migue] no se pudo enviar el reporte al dashboard", error instanceof Error ? error.message : error);
  }
}
