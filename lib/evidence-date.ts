// Fecha de las evidencias fotográficas.
// Por defecto una evidencia toma la hora de carga (created_at lo completa la base). Para cargar un
// control que se pasó, se puede elegir un día anterior: la evidencia se guarda con esa fecha y así
// cuenta para ese día y ese mes en auditoría, informes, recorridos y Migue.
// Argentina no tiene horario de verano: UTC-03:00 fijo.

const OPERATING_OFFSET = "-03:00";

/** Fecha de hoy (AAAA-MM-DD) en la hora del dispositivo. */
export function todayDateInput(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function isValidDateInput(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00${OPERATING_OFFSET}`).getTime());
}

/** true si se eligió un día anterior a hoy (en ese caso se informa la fecha al guardar). */
export function isPastEvidenceDate(value: string, today = todayDateInput()) {
  return isValidDateInput(value) && value < today;
}

/**
 * Marca de tiempo para una evidencia de un día anterior: mediodía de ese día en hora argentina, con un
 * segundo de diferencia por foto para conservar el orden del lote. El mediodía evita que el día cambie
 * al pasar a UTC.
 */
export function pastEvidenceTimestamp(value: string, index: number) {
  const base = new Date(`${value}T12:00:00${OPERATING_OFFSET}`);
  return new Date(base.getTime() + Math.min(index, 3599) * 1000).toISOString();
}

/** Día (AAAA-MM-DD) de una marca de tiempo en hora argentina. */
export function operatingDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Date(date.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** true si la foto se cargó otro día distinto del día de la evidencia (requiere la columna uploaded_at). */
export function wasUploadedLate(photo: { created_at: string; uploaded_at?: string | null }) {
  return Boolean(photo.uploaded_at && operatingDay(photo.uploaded_at) > operatingDay(photo.created_at));
}

export function formatEvidenceDay(value: string) {
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(value.length === 10 ? `${value}T12:00:00${OPERATING_OFFSET}` : value));
}
