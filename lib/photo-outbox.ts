import type { SupabaseClient } from "@supabase/supabase-js";
import { isNetworkError } from "./offline-queue";

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

const DB_NAME = "applaza-offline";
const STORE = "photo-outbox";
const listeners = new Set<() => void>();
let flushing = false;

export function onPhotoOutboxChanged(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function notifyChanged() { listeners.forEach((listener) => listener()); }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
    transaction.oncomplete = () => { db.close(); resolve(request.result); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  }));
}

export async function addPhotoToOutbox(entry: PhotoOutboxEntry) {
  await withStore("readwrite", (store) => store.put(entry));
  notifyChanged();
}

export function listPhotoOutbox(): Promise<PhotoOutboxEntry[]> {
  if (typeof indexedDB === "undefined") return Promise.resolve([]);
  return withStore("readonly", (store) => store.getAll() as IDBRequest<PhotoOutboxEntry[]>).catch(() => []);
}

export async function countPhotoOutbox(): Promise<number> { return (await listPhotoOutbox()).length; }

async function removeFromOutbox(id: string) { await withStore("readwrite", (store) => store.delete(id)); }

export async function flushPhotoOutbox(client: SupabaseClient): Promise<{ remaining: number; rejected: string[] }> {
  const rejected: string[] = [];
  if (flushing || typeof indexedDB === "undefined") return { remaining: await countPhotoOutbox(), rejected };
  flushing = true;
  try {
    const entries = await listPhotoOutbox();
    for (const entry of entries) {
      if (entry.taskSeed) {
        const { error } = await client.from("maintenance_tasks").insert(entry.taskSeed);
        if (error && !/duplicate key|already exists/i.test(error.message)) {
          if (isNetworkError(error.message)) break;
          rejected.push(`${entry.label}: ${error.message}`); await removeFromOutbox(entry.id); notifyChanged(); continue;
        }
      }
      const upload = await client.storage.from("maintenance-photos").upload(entry.path, entry.blob, { contentType: entry.contentType, upsert: false });
      if (upload.error && !/exists|duplicate/i.test(upload.error.message)) {
        if (isNetworkError(upload.error.message)) break;
        rejected.push(`${entry.label}: ${upload.error.message}`); await removeFromOutbox(entry.id); notifyChanged(); continue;
      }
      const { error: rowError } = await client.from("maintenance_photos").insert(entry.row);
      if (rowError && !/duplicate key|already exists/i.test(rowError.message)) {
        if (isNetworkError(rowError.message)) break;
        rejected.push(`${entry.label}: ${rowError.message}`); await removeFromOutbox(entry.id); notifyChanged(); continue;
      }
      await removeFromOutbox(entry.id); notifyChanged();
    }
  } finally {
    flushing = false;
  }
  return { remaining: await countPhotoOutbox(), rejected };
}
