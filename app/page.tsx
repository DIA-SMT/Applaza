import { DashboardView } from "@/components/dashboard-view";
import { getDashboardData } from "@/lib/dashboard-data";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types/domain";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("id,full_name,role,provider_id").eq("id", user.id).single();
  const { spaces, providers } = await getDashboardData(supabase);
  const currentUser: UserProfile = profile ? { ...profile, email: user.email } as UserProfile : { id: user.id, full_name: user.email?.split("@")[0] || "Usuario", role: "provider", provider_id: null, email: user.email };
  return <DashboardView initialSpaces={spaces} providers={providers} currentUser={currentUser} />;
}
