// Mensajes para el usuario cuando algo falla: sin términos técnicos (Supabase, SQL, tablas,
// políticas...). El detalle técnico va a la consola del navegador para quien tenga que investigar.

export const MSG_SERVICE_UNAVAILABLE = "No se pudo conectar con el servicio. Intentá de nuevo en unos minutos; si sigue, avisá a DIA.";
export const MSG_NO_PERMISSION = "Tu usuario no tiene permiso para hacer esto. Si lo necesitás, pedíselo a DIA.";
export const MSG_NOT_ENABLED = "Esta función todavía no está habilitada. Avisá a DIA.";
export const MSG_DUPLICATE = "Ese dato ya está cargado.";

const KNOWN = new Set([MSG_SERVICE_UNAVAILABLE, MSG_NO_PERMISSION, MSG_NOT_ENABLED, MSG_DUPLICATE]);

function rawMessage(error: unknown) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message ?? "");
  return "";
}

/**
 * Convierte un error en un texto para el usuario. Los errores técnicos (base de datos, permisos,
 * red) se traducen; los mensajes propios de la app, ya escritos para el usuario, se respetan.
 */
export function userErrorMessage(error: unknown, fallback: string) {
  const message = rawMessage(error).trim();
  if (!message) return fallback;
  if (KNOWN.has(message)) return message;

  const technical = /row-level|policy|permission|denied|not authorized|unauthorized|jwt|relation .* does not exist|schema cache|does not exist|violates|duplicate key|invalid input|column|null value|syntax|supabase|sql|bucket|postgrest|pgrst|failed to fetch|fetch failed|networkerror|load failed|status code|internal server error/i;
  if (!technical.test(message)) return message;

  console.warn("[Applaza] detalle técnico:", message);
  if (/row-level|policy|permission|denied|not authorized|unauthorized|jwt/i.test(message)) return MSG_NO_PERMISSION;
  if (/relation .* does not exist|schema cache|does not exist/i.test(message)) return MSG_NOT_ENABLED;
  if (/duplicate key|unique/i.test(message)) return MSG_DUPLICATE;
  if (/failed to fetch|fetch failed|networkerror|load failed|internal server error|status code/i.test(message)) return MSG_SERVICE_UNAVAILABLE;
  return fallback;
}
