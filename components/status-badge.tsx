import type { MaintenanceStatus } from "@/types/domain";

export const statusLabels: Record<MaintenanceStatus, string> = { programado: "Programado", en_curso: "En curso", finalizado: "Finalizado", vencido: "Vencido", incumplido: "Incumplido", observado: "Observado" };
export const statusColors: Record<MaintenanceStatus, string> = { programado: "#2563eb", en_curso: "#0891b2", finalizado: "#16a34a", vencido: "#dc2626", incumplido: "#7f1d1d", observado: "#d97706" };
export function StatusBadge({ status }: { status: MaintenanceStatus }) { return <span className={`status status-${status}`}><i />{statusLabels[status]}</span>; }
