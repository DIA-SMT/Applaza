import type { SupabaseClient } from "@supabase/supabase-js";

export type PendingOp = {
  id: string;
  kind: "insert" | "update";
  match?: string;
  values: Record<string, unknown>;
  label: string;
  queuedAt: string;
};

const STORAGE_KEY = "applaza-sync-queue";

export function loadQueue(): PendingOp[] {
  if (typeof window === "undefined") return [];
  try { const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

export function persistQueue(queue: PendingOp[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(queue)); } catch { /* almacenamiento no disponible */ }
}

export function isNetworkError(message: string) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  return /fetch|network|conexión|load failed|timeout/i.test(message);
}

export async function runPendingOp(supabase: SupabaseClient, op: PendingOp): Promise<{ ok: boolean; retry: boolean; message?: string }> {
  const result = op.kind === "insert"
    ? await supabase.from("green_spaces").insert(op.values)
    : await supabase.from("green_spaces").update(op.values).eq("id", op.match!);
  if (!result.error) return { ok: true, retry: false };
  // Si el alta ya llegó en un intento anterior (misma source_key), darla por hecha.
  if (op.kind === "insert" && /duplicate key|already exists/i.test(result.error.message)) return { ok: true, retry: false };
  if (isNetworkError(result.error.message)) return { ok: false, retry: true };
  return { ok: false, retry: false, message: result.error.message };
}
