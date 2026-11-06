import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ConnectionError } from "@/components/connection-error";
import { DashboardView } from "@/components/dashboard-view";
import { getDashboardData } from "@/lib/dashboard-data";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { AUTH_TIMEOUT_MS, DATA_TIMEOUT_MS, withServerTimeout } from "@/lib/supabase/timeouts";
import { AUTH_UNREACHABLE_HEADER, decodeVerifiedUser, VERIFIED_USER_HEADER, type VerifiedUser } from "@/lib/supabase/verified-user";
import type { UserProfile } from "@/types/domain";

export const dynamic = "force-dynamic";

type AuthCheck = { user: VerifiedUser } | { user: null; reason: "signed-out" | "unreachable" };

export default async function Home() {
  const supabase = await getSupabaseServerClient();

  // El middleware ya validó la sesión en este mismo pedido. Si Supabase no le respondió, no se
  // vuelve a esperar: se ofrece reintentar enseguida.
  const requestHeaders = await headers();
  if (requestHeaders.get(AUTH_UNREACHABLE_HEADER)) return <ConnectionError />;
  const auth = await resolveUser(supabase, decodeVerifiedUser(requestHeaders.get(VERIFIED_USER_HEADER)));
  if (!auth.user && auth.reason === "signed-out") redirect("/login");
  if (!auth.user) return <ConnectionError />;
  const user = auth.user;

  let profileResult, dashboard;
  try {
    [profileResult, dashboard] = await Promise.all([
      withServerTimeout(supabase.from("profiles").select("id,full_name,role,provider_id").eq("id", user.id).single(), DATA_TIMEOUT_MS + 1_000),
      getDashboardData(supabase),
    ]);
  } catch {
    return <ConnectionError />;
  }

  // Sin fila de perfil (PGRST116) se usa el perfil básico como antes; cualquier otro error es de conexión
  // y no se debe mostrar la app con un rol equivocado.
  const { data: profile, error: profileError } = profileResult;
  if (profileError && profileError.code !== "PGRST116") return <ConnectionError />;

  const { spaces, providers, error } = dashboard;
  const currentUser: UserProfile = profile ? { ...profile, email: user.email } as UserProfile : { id: user.id, full_name: user.email?.split("@")[0] || "Usuario", role: "provider", provider_id: null, email: user.email };
  let userProfiles: UserProfile[] = [currentUser];

  if (currentUser.role === "admin") {
    const { data: profiles } = await supabase.from("profiles").select("id,full_name,role,provider_id").order("full_name");
    if (profiles?.length) userProfiles = profiles as UserProfile[];
  }

  return <DashboardView initialSpaces={spaces} providers={providers} currentUser={currentUser} userProfiles={userProfiles} dataError={error} />;
}

async function resolveUser(supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>, verified: VerifiedUser | null): Promise<AuthCheck> {
  if (verified) return { user: verified };
  try {
    const { data, error } = await withServerTimeout(supabase.auth.getUser(), AUTH_TIMEOUT_MS + 1_000);
    if (data.user) return { user: { id: data.user.id, email: data.user.email } };
    return { user: null, reason: error && isAuthRetryableFetchError(error) ? "unreachable" : "signed-out" };
  } catch {
    return { user: null, reason: "unreachable" };
  }
}
