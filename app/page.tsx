import { DashboardView } from "@/components/dashboard-view";
import { getDashboardData } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { spaces, providers } = await getDashboardData();
  return <DashboardView initialSpaces={spaces} providers={providers} />;
}
