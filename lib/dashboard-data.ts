import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { providers as mockProviders, spaceRecords as mockSpaces } from "@/lib/mock-data";
import type { GreenSpace, MaintenancePhoto, MaintenanceTask, Provider, SpaceRecord } from "@/types/domain";

type ServiceSection = { section_code: string; provider_id: string };

export async function getDashboardData(authenticatedClient?: SupabaseClient): Promise<{ spaces: SpaceRecord[]; providers: Provider[] }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { spaces: mockSpaces, providers: mockProviders };

  try {
    const supabase = authenticatedClient ?? createClient(url, key, { auth: { persistSession: false } });
    const [spacesResult, providersResult, tasksResult, photosResult, sectionsResult] = await Promise.all([
      supabase.from("green_spaces").select("*").order("name"),
      supabase.from("providers").select("*").order("name"),
      supabase.from("maintenance_tasks").select("*").order("created_at", { ascending: false }),
      supabase.from("maintenance_photos").select("*").order("created_at", { ascending: false }),
      supabase.from("service_sections").select("section_code,provider_id"),
    ]);
    const error = spacesResult.error || providersResult.error || tasksResult.error || photosResult.error || sectionsResult.error;
    if (error) throw error;

    const providers = (providersResult.data ?? []) as Provider[];
    const tasks = (tasksResult.data ?? []) as MaintenanceTask[];
    const photos = (photosResult.data ?? []) as MaintenancePhoto[];
    const sections = (sectionsResult.data ?? []) as ServiceSection[];
    const providerById = new Map(providers.map((provider) => [provider.id, provider]));
    const providerBySection = new Map(sections.map((section) => [section.section_code, providerById.get(section.provider_id)]));
    const latestTaskBySpace = new Map<string, MaintenanceTask>();
    for (const task of tasks) if (!latestTaskBySpace.has(task.green_space_id)) latestTaskBySpace.set(task.green_space_id, task);

    const spaces: SpaceRecord[] = ((spacesResult.data ?? []) as GreenSpace[]).map((space) => {
      const task = latestTaskBySpace.get(space.id);
      const provider = task ? providerById.get(task.provider_id) : space.section_code ? providerBySection.get(space.section_code) : undefined;
      return { ...space, task, provider, photos: task ? photos.filter((photo) => photo.maintenance_task_id === task.id) : [] };
    });
    return { spaces, providers };
  } catch (error) {
    console.error("Supabase dashboard fallback:", error);
    return { spaces: mockSpaces, providers: mockProviders };
  }
}
