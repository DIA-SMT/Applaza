import { isSupported, Upload } from "tus-js-client";

const CHUNK_BYTES = 6 * 1024 * 1024;
const INACTIVITY_TIMEOUT_MS = 45_000;

export const RESUMABLE_UPLOAD_THRESHOLD = CHUNK_BYTES;

export function canUseResumableUploads() {
  return isSupported && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function uploadPhotoResumable({
  blob,
  path,
  contentType,
  accessToken,
  onProgress,
  onSlowConnection,
}: {
  blob: Blob;
  path: string;
  contentType: string;
  accessToken: string;
  onProgress?: (percent: number) => void;
  onSlowConnection?: () => void;
}) {
  const endpoint = resumableEndpoint();
  const apiKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!endpoint || !apiKey || !isSupported) return Promise.reject(new Error("Las cargas reanudables no están disponibles en este dispositivo."));

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let slowConnectionReported = false;
    const startedAt = Date.now();
    let inactivityTimer: ReturnType<typeof setTimeout>;

    const upload = new Upload(blob, {
      endpoint,
      chunkSize: CHUNK_BYTES,
      retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      fingerprint: async () => `applaza-${path}`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        apikey: apiKey,
      },
      metadata: {
        bucketName: "maintenance-photos",
        objectName: path,
        contentType,
        cacheControl: "3600",
      },
      onProgress: (uploadedBytes, totalBytes) => {
        refreshInactivityTimer();
        onProgress?.(totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 0);
        const elapsedSeconds = (Date.now() - startedAt) / 1000;
        if (!slowConnectionReported && elapsedSeconds >= 8 && uploadedBytes / elapsedSeconds < 128 * 1024) {
          slowConnectionReported = true;
          onSlowConnection?.();
        }
      },
      onError: (error) => finish(error),
      onSuccess: () => finish(),
    });

    function refreshInactivityTimer() {
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        void upload.abort().finally(() => finish(new Error("La conexión está lenta o inestable. La carga se pausará para reintentarse.")));
      }, INACTIVITY_TIMEOUT_MS);
    }

    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(inactivityTimer);
      if (error) reject(error);
      else resolve();
    }

    refreshInactivityTimer();
    upload.findPreviousUploads()
      .then((previousUploads) => {
        if (previousUploads.length) upload.resumeFromPreviousUpload(previousUploads[0]);
        upload.start();
      })
      .catch((error) => finish(error instanceof Error ? error : new Error("No se pudo iniciar la carga reanudable.")));
  });
}

function resumableEndpoint() {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configuredUrl) return null;
  const url = new URL(configuredUrl);
  if (url.hostname.endsWith(".supabase.co")) {
    const projectId = url.hostname.split(".")[0];
    return `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`;
  }
  return `${url.origin}/storage/v1/upload/resumable`;
}
