import type { GreenSpace, MaintenancePhoto, MaintenanceTask, Provider, SpaceRecord } from "@/types/domain";

const now = "2026-06-30T12:00:00.000Z";
export const providers: Provider[] = [
  { id: "p1", name: "Verde Norte SAS", contact_name: "Mariana López", phone: "381 555-0182", email: "operaciones@verdenorte.test", notes: "Zona norte", active: true, created_at: now, updated_at: now },
  { id: "p2", name: "Servicios del Jardín SRL", contact_name: "Julián Roldán", phone: "381 555-0129", email: "contacto@jardin.test", notes: "Centro y oeste", active: true, created_at: now, updated_at: now },
  { id: "p3", name: "Tucumán Paisaje Coop.", contact_name: "Lucía Medina", phone: "381 555-0196", email: "cuadrillas@paisaje.test", notes: "Corredores viales", active: true, created_at: now, updated_at: now },
];

const rawSpaces: Array<Omit<GreenSpace, "created_at" | "updated_at">> = [
  { id: "g1", name: "Plaza Independencia", type: "plaza", address: "25 de Mayo y San Martín", neighborhood: "Centro", latitude: -26.83038, longitude: -65.20382, status: "en_curso" },
  { id: "g2", name: "Plaza Urquiza", type: "plaza", address: "25 de Mayo 817", neighborhood: "Barrio Norte", latitude: -26.82178, longitude: -65.20191, status: "finalizado" },
  { id: "g3", name: "Plaza San Martín", type: "plaza", address: "Lavalle y Chacabuco", neighborhood: "Sur", latitude: -26.83794, longitude: -65.20775, status: "observado" },
  { id: "g4", name: "Plaza Belgrano", type: "plaza", address: "Lavalle y Bernabé Aráoz", neighborhood: "Ciudadela", latitude: -26.83853, longitude: -65.2202, status: "programado" },
  { id: "g5", name: "Plaza Alberdi", type: "plaza", address: "Santiago del Estero y Catamarca", neighborhood: "Centro Norte", latitude: -26.82401, longitude: -65.20968, status: "vencido" },
  { id: "g6", name: "Parque 9 de Julio", type: "espacio_verde", address: "Av. Soldati 400", neighborhood: "Este", latitude: -26.83012, longitude: -65.19113, status: "en_curso" },
  { id: "g7", name: "Parque Guillermina", type: "espacio_verde", address: "Av. Mate de Luna 4100", neighborhood: "Oeste", latitude: -26.83165, longitude: -65.25868, status: "incumplido" },
  { id: "g8", name: "Parque Avellaneda", type: "espacio_verde", address: "Av. Mate de Luna 1700", neighborhood: "Oeste", latitude: -26.82963, longitude: -65.22406, status: "finalizado" },
  { id: "g9", name: "Platabanda Av. Roca", type: "platabanda", address: "Av. Roca 900–1500", neighborhood: "Sur", latitude: -26.84417, longitude: -65.21111, status: "programado" },
  { id: "g10", name: "Platabanda Av. Sarmiento", type: "platabanda", address: "Av. Sarmiento 300–900", neighborhood: "Barrio Norte", latitude: -26.81872, longitude: -65.20452, status: "observado" },
];
export const greenSpaces: GreenSpace[] = rawSpaces.map((s) => ({ ...s, created_at: now, updated_at: now }));

export const tasks: MaintenanceTask[] = greenSpaces.map((space, index) => ({
  id: `t${index + 1}`, green_space_id: space.id, provider_id: providers[index % 3].id,
  start_date: `2026-06-${String(3 + index).padStart(2, "0")}`, end_date: `2026-07-${String(2 + index).padStart(2, "0")}`,
  completed_date: space.status === "finalizado" ? "2026-06-24" : null, status: space.status,
  fulfilled: space.status === "finalizado" ? "si" : space.status === "incumplido" ? "no" : "pendiente",
  observations: space.status === "observado" ? "Revisar terminación de canteros y retiro de residuos." : "Mantenimiento integral de césped, arbolado y mobiliario.",
  created_at: now, updated_at: now,
}));

export const photos: MaintenancePhoto[] = [
  { id: "f1", maintenance_task_id: "t1", image_url: "https://images.unsplash.com/photo-1588714477688-cf28a50e94f7?auto=format&fit=crop&w=1000&q=80", photo_type: "durante", uploaded_by: null, latitude: -26.83038, longitude: -65.20382, created_at: "2026-06-30T10:15:00Z" },
  { id: "f2", maintenance_task_id: "t2", image_url: "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=1000&q=80", photo_type: "despues", uploaded_by: null, latitude: -26.82178, longitude: -65.20191, created_at: "2026-06-29T16:20:00Z" },
  { id: "f3", maintenance_task_id: "t6", image_url: "https://images.unsplash.com/photo-1501854140801-50d01698950b?auto=format&fit=crop&w=1000&q=80", photo_type: "antes", uploaded_by: null, latitude: -26.83012, longitude: -65.19113, created_at: "2026-06-28T11:00:00Z" },
];

export const spaceRecords: SpaceRecord[] = greenSpaces.map((space) => {
  const task = tasks.find((item) => item.green_space_id === space.id);
  return { ...space, task, provider: providers.find((item) => item.id === task?.provider_id), photos: photos.filter((photo) => photo.maintenance_task_id === task?.id) };
});
