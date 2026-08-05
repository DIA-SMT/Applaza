import type { SupabaseClient } from "@supabase/supabase-js";
import { withTimeout } from "./async-timeout";
import { isNetworkError } from "./offline-queue";
import { canUseResumableUploads, uploadPhotoResumable } from "./resumable-photo-upload";

export type PhotoOutboxEntry = {
  id: string;
  path: string;
  contentType: string;
  blob: Blob;
  row: { id: string; maintenance_task_id: string; image_url: string; photo_type: string; uploaded_by: string; latitude: number | null; longitude: number | null };
  taskSeed: Record<string, unknown> | null;
  label: string;
  queuedAt: string;
};

// En disco la foto se guarda como bytes crudos (ArrayBuffer): almacenar Blobs
// en IndexedDB se cuelga o se corrompe en varios Android/WebKit. Se mantiene
// compatibilidad de lectura con entradas viejas que tengan Blob.
type StoredPhotoEntry = Omit<PhotoOutboxEntry, "blob"> & { blob?: Blob; buffer?: ArrayBuffer };

const DB_NAME = "applaza-offline";
const STORE = "photo-outbox";
const IDB_TIMEOUT_MESSAGE = "El almacenamiento del dispositivo no responde. Cerrá otras pestañas de Applaza y reintentá la subida.";
const listeners = new Set<() => void>();
let flushing = false;

export function onPhotoOutboxChanged(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function notifyChanged() { listeners.forEach((listener) => listener()); }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("Este navegador no permite guardar fotos en el dispositivo.")); return; }
    const timer = setTimeout(() => reject(new Error(IDB_TIMEOUT_MESSAGE)), 5_000);
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" }); };
    request.onsuccess = () => { clearTimeout(timer); resolve(request.result); };
    request.onerror = () => { clearTimeout(timer); reject(request.error); };
    request.onblocked = () => { clearTimeout(timer); reject(new Error(IDB_TIMEOUT_MESSAGE)); };
  });
}

function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
    transaction.oncomplete = () => { db.close(); resolve(request.result); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error(IDB_TIMEOUT_MESSAGE)); };
  }));
}

export async function addPhotoToOutbox(entry: PhotoOutboxEntry) {
  // Pedir almacenamiento persistente para que el sistema no purgue la cola
  // si el dispositivo se queda sin espacio. Es fire-and-forget: si el
  // navegador no lo soporta o lo niega, la cola funciona igual.
  try { void navigator.storage?.persist?.(); } catch { /* sin soporte */ }
  const { blob, ...rest } = entry;
  const buffer = await withTimeout(blob.arrayBuffer(), 10_000, "No se pudo leer la foto para guardarla en el dispositivo. Reintentá la subida.");
  const stored: StoredPhotoEntry = { ...rest, buffer };
  await withTimeout(withStore("readwrite", (store) => store.put(stored)), 10_000, IDB_TIMEOUT_MESSAGE);
  notifyChanged();
}

export function listPhotoOutbox(): Promise<PhotoOutboxEntry[]> {
  if (typeof indexedDB === "undefined") return Promise.resolve([]);
  return withStore("readonly", (store) => store.getAll() as IDBRequest<StoredPhotoEntry[]>)
    .then((records) => records.map((record) => ({
      ...record,
      blob: record.blob instanceof Blob ? record.blob : new Blob([record.buffer ?? new ArrayBuffer(0)], { type: record.contentType }),
    })))
    .catch(() => []);
}

export async function countPhotoOutbox(): Promise<number> { return (await listPhotoOutbox()).length; }

async function removeFromOutbox(id: string) { await withStore("readwrite", (store) => store.delete(id)); }

export async function flushPhotoOutbox(client: SupabaseClient): Promise<{ remaining: number; rejected: string[] }> {
  const rejected: string[] = [];
  if (flushing || typeof indexedDB === "undefined") return { remaining: await countPhotoOutbox(), rejected };
  flushing = true;
  try {
    const entries = await listPhotoOutbox();
    const { data: { session } } = entries.length ? await client.auth.getSession() : { data: { session: null } };
    for (const entry of entries) {
      try {
        if (entry.taskSeed) {
          const { error } = await withTimeout(
            client.from("maintenance_tasks").insert(entry.taskSeed),
            20_000,
            "La conexión está inestable. No se pudo sincronizar el mantenimiento.",
          );
          if (error && !/duplicate key|already exists/i.test(error.message)) throw new Error(error.message);
        }

        await uploadQueuedPhoto(client, entry, session?.access_token);

        const { error: rowError } = await withTimeout(
          client.from("maintenance_photos").insert(entry.row),
          20_000,
          "La conexión está inestable. La evidencia seguirá pendiente.",
        );
        if (rowError && !/duplicate key|already exists/i.test(rowError.message)) throw new Error(rowError.message);

        await removeFromOutbox(entry.id);
        notifyChanged();
      } catch (error) {
        const message = error instanceof Error ? error.message : "No se pudo sincronizar la evidencia.";
        if (isNetworkError(message)) break;
        rejected.push(`${entry.label}: ${message}`);
        await removeFromOutbox(entry.id);
        notifyChanged();
      }
    }
  } finally {
    flushing = false;
  }
  return { remaining: await countPhotoOutbox(), rejected };
}

async function uploadQueuedPhoto(client: SupabaseClient, entry: PhotoOutboxEntry, accessToken?: string) {
  if (accessToken && canUseResumableUploads()) {
    try {
      await uploadPhotoResumable({ blob: entry.blob, path: entry.path, contentType: entry.contentType, accessToken });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo reanudar la carga.";
      if (/exists|duplicate|already exists|409/i.test(message)) return;
      throw error;
    }
  }

  const upload = await withTimeout(
    client.storage.from("maintenance-photos").upload(entry.path, entry.blob, { contentType: entry.contentType, upsert: false }),
    30_000,
    "La conexión está lenta o inestable. La evidencia seguirá pendiente.",
  );
  if (upload.error && !/exists|duplicate|already exists/i.test(upload.error.message)) throw new Error(upload.error.message);
}
