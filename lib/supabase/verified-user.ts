// El middleware valida la sesión contra Supabase Auth y le pasa el resultado a la página en un
// encabezado interno, para no repetir esa consulta en cada ingreso. El middleware borra este
// encabezado de todo pedido entrante, así que el navegador no puede inyectarlo.

export const VERIFIED_USER_HEADER = "x-applaza-verified-user";
/** Lo agrega el middleware cuando Supabase Auth no respondió a tiempo, para no reintentar en la página. */
export const AUTH_UNREACHABLE_HEADER = "x-applaza-auth-unreachable";

export type VerifiedUser = { id: string; email?: string };

export function encodeVerifiedUser(user: VerifiedUser) {
  return encodeURIComponent(JSON.stringify({ id: user.id, email: user.email }));
}

export function decodeVerifiedUser(value: string | null): VerifiedUser | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Partial<VerifiedUser>;
    return typeof parsed.id === "string" && parsed.id ? { id: parsed.id, email: typeof parsed.email === "string" ? parsed.email : undefined } : null;
  } catch {
    return null;
  }
}
