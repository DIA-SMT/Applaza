// Límites de tiempo para las llamadas a Supabase del lado del servidor (middleware y páginas).
// Sin límite, una respuesta lenta de Supabase dejaba la app en "Cargando Applaza" hasta que
// Vercel cortaba el pedido. Funciona en el runtime Edge (middleware) y en Node.

export const AUTH_TIMEOUT_MS = 6_000;
export const DATA_TIMEOUT_MS = 12_000;

export class SupabaseTimeoutError extends Error {
  constructor(milliseconds: number) {
    super(`Supabase no respondió en ${Math.round(milliseconds / 1000)} s`);
    this.name = "SupabaseTimeoutError";
  }
}

/** fetch que se cancela si el servidor no responde a tiempo (respeta la señal original si existe). */
export function fetchWithTimeout(milliseconds: number): typeof fetch {
  return (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new SupabaseTimeoutError(milliseconds)), milliseconds);
    const outer = init?.signal;
    if (outer) {
      if (outer.aborted) controller.abort(outer.reason);
      else outer.addEventListener("abort", () => controller.abort(outer.reason), { once: true });
    }
    return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
  };
}

/** Rechaza si la promesa no termina a tiempo (respaldo por si algo queda colgado fuera de fetch). */
export function withServerTimeout<T>(promise: PromiseLike<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SupabaseTimeoutError(milliseconds)), milliseconds);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}
