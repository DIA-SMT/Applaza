export type SpaceType = "plaza" | "espacio_verde" | "platabanda";
export type MaintenanceStatus = "programado" | "en_curso" | "finalizado" | "vencido" | "incumplido" | "observado";
export type Fulfilled = "si" | "no" | "pendiente";
export type PhotoType = "antes" | "durante" | "despues";

export interface Provider { id: string; name: string; contact_name: string; phone: string; email: string; notes?: string; active: boolean; created_at: string; updated_at: string }
export interface GreenSpace { id: string; name: string; type: SpaceType; address: string; neighborhood: string; latitude: number | null; longitude: number | null; status: MaintenanceStatus; created_at: string; updated_at: string; source_type?: string | null; surface_m2?: number | null; section_code?: string | null }
export interface MaintenanceTask { id: string; green_space_id: string; provider_id: string; start_date: string; end_date: string; completed_date: string | null; status: MaintenanceStatus; fulfilled: Fulfilled; observations: string; created_at: string; updated_at: string }
export interface MaintenancePhoto { id: string; maintenance_task_id: string; image_url: string; photo_type: PhotoType; uploaded_by: string | null; latitude: number | null; longitude: number | null; created_at: string }
export interface SpaceRecord extends GreenSpace { task?: MaintenanceTask; provider?: Provider; photos: MaintenancePhoto[] }
