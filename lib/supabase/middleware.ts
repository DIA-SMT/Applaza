import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { isAuthRetryableFetchError, type User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_TIMEOUT_MS, fetchWithTimeout, withServerTimeout } from "./timeouts";
import { AUTH_UNREACHABLE_HEADER, encodeVerifiedUser, VERIFIED_USER_HEADER } from "./verified-user";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Detrás de un proxy (nginx en el VPS) Next arma request.url con su nombre interno
// (localhost:3006). La redirección se arma con el dominio real que informa el proxy
// (X-Forwarded-Host/Proto, que también manda Vercel); si no viene, se usa request.url.
function redirectTo(request: NextRequest, path: string) {
  const first = (value: string | null) => value?.split(",")[0]?.trim() || null;
  const host = first(request.headers.get("x-forwarded-host")) ?? first(request.headers.get("host"));
  const proto = first(request.headers.get("x-forwarded-proto")) ?? request.nextUrl.protocol.replace(":", "");
  return NextResponse.redirect(new URL(path, host ? `${proto}://${host}` : request.url));
}

export async function updateSession(request: NextRequest) {
  // Encabezados que recibe la página: nunca se acepta el de usuario verificado desde el navegador.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(VERIFIED_USER_HEADER);
  requestHeaders.delete(AUTH_UNREACHABLE_HEADER);
  const cookiesToSet: CookieToSet[] = [];

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { fetch: fetchWithTimeout(AUTH_TIMEOUT_MS) },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values: CookieToSet[]) => {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        cookiesToSet.push(...values);
      },
    },
  });

  // "unknown": Supabase no respondió a tiempo o falló la red. En ese caso no se manda al login
  // (la sesión puede ser válida): la página vuelve a intentar y, si tampoco puede, ofrece reintentar.
  let user: User | null = null;
  let authState: "ok" | "unknown" = "ok";
  try {
    const { data, error } = await withServerTimeout(supabase.auth.getUser(), AUTH_TIMEOUT_MS + 1_000);
    if (error && isAuthRetryableFetchError(error)) authState = "unknown";
    user = data.user;
  } catch {
    authState = "unknown";
  }

  const withCookies = (response: NextResponse) => {
    cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
    return response;
  };

  const isLogin = request.nextUrl.pathname.startsWith("/login");
  if (authState === "ok" && !user && !isLogin) return withCookies(redirectTo(request, "/login"));
  if (user && isLogin) return withCookies(redirectTo(request, "/"));

  if (cookiesToSet.length) requestHeaders.set("cookie", request.headers.get("cookie") ?? "");
  if (user) requestHeaders.set(VERIFIED_USER_HEADER, encodeVerifiedUser({ id: user.id, email: user.email }));
  else if (authState === "unknown") requestHeaders.set(AUTH_UNREACHABLE_HEADER, "1");
  return withCookies(NextResponse.next({ request: { headers: requestHeaders } }));
}
