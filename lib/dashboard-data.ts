import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { GreenSpace, MaintenancePhoto, MaintenanceTask, Provider, SpaceRecord } from "@/types/domain";

type ServiceSection = { section_code: string; provider_id: string };

export async function getDashboardData(authenticatedClient?: SupabaseClient): Promise<{ spaces: SpaceRecord[]; providers: Provider[]; error: string | null }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { spaces: [], providers: [], error: "Supabase no está configurado." };

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
    const taskIdsBySpace = new Map<string, Set<string>>();
    const photosByTask = new Map<string, MaintenancePhoto[]>();

    for (const task of tasks) {
      if (!latestTaskBySpace.has(task.green_space_id)) latestTaskBySpace.set(task.green_space_id, task);
      const taskIds = taskIdsBySpace.get(task.green_space_id) ?? new Set<string>();
      taskIds.add(task.id);
      taskIdsBySpace.set(task.green_space_id, taskIds);
    }

    for (const photo of photos) {
      const taskPhotos = photosByTask.get(photo.maintenance_task_id) ?? [];
      taskPhotos.push(photo);
      photosByTask.set(photo.maintenance_task_id, taskPhotos);
    }

    const documentSpaces = ((spacesResult.data ?? []) as GreenSpace[]).filter(isDocumentSpace);
    const sourceSpaces = documentSpaces.length ? documentSpaces : (spacesResult.data ?? []) as GreenSpace[];

    const spaces: SpaceRecord[] = sourceSpaces.map((space) => {
      const task = latestTaskBySpace.get(space.id);
      const provider = task ? providerById.get(task.provider_id) : space.section_code ? providerBySection.get(space.section_code) : undefined;
      const taskIds = Array.from(taskIdsBySpace.get(space.id) ?? []);
      const spacePhotos = taskIds.flatMap((taskId) => photosByTask.get(taskId) ?? []);
      return { ...space, status: task?.status ?? space.status, task, provider, photos: spacePhotos };
    });
    return { spaces, providers, error: null };
  } catch (error) {
    console.error("Supabase dashboard error:", error);
    return { spaces: [], providers: [], error: "No se pudieron cargar los datos operativos desde Supabase." };
  }
}

function isDocumentSpace(space: GreenSpace) {
  if (space.source_key?.startsWith("applaza-")) return true;
  const match = space.source_key?.match(/^pdf-2026-06-30-(\d+)$/);
  return Boolean(match && Number(match[1]) <= 218);
}
