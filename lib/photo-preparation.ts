import { withTimeout } from "./async-timeout";

const MAX_SOURCE_BYTES = 30 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1920;
const PASSTHROUGH_BYTES = 2 * 1024 * 1024;
const JPEG_QUALITY = 0.82;

export const PHOTO_BATCH_LIMIT = 40;

export type PreparedPhoto = {
  blob: Blob;
  contentType: string;
  fileName: string;
  originalBytes: number;
  outputBytes: number;
  compressed: boolean;
};

export async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name} no es una imagen.`);
  }

  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error(`${file.name} supera el limite de 30 MB.`);
  }

  // Comprimir es una optimizacion: si este dispositivo no puede decodificar o
  // recomprimir la imagen, se sube el archivo original tal cual antes que
  // perder la evidencia.
  let decoded: Awaited<ReturnType<typeof decodeImage>>;
  try {
    decoded = await withTimeout(
      decodeImage(file),
      12_000,
      "El teléfono demoró demasiado en preparar la imagen. Se usará el archivo original.",
    );
  } catch {
    return passthrough(file);
  }

  try {
    const { width, height } = decoded;
    const longestEdge = Math.max(width, height);
    const canPassThrough = file.size <= PASSTHROUGH_BYTES
      && longestEdge <= MAX_IMAGE_EDGE
      && /image\/(jpeg|webp)/i.test(file.type);

    if (canPassThrough || !width || !height) {
      return passthrough(file);
    }

    const scale = Math.min(1, MAX_IMAGE_EDGE / longestEdge);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) return passthrough(file);

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);

    const blob = await withTimeout(
      canvasToBlob(canvas, "image/jpeg", JPEG_QUALITY),
      12_000,
      "El teléfono demoró demasiado en comprimir la imagen. Se usará el archivo original.",
    );
    // Si la "compresion" agranda el archivo, mejor el original.
    if (blob.size >= file.size && /image\/(jpeg|webp)/i.test(file.type)) return passthrough(file);
    return {
      blob,
      contentType: "image/jpeg",
      fileName: safePhotoName(file.name, "image/jpeg"),
      originalBytes: file.size,
      outputBytes: blob.size,
      compressed: true,
    };
  } catch {
    return passthrough(file);
  } finally {
    decoded.cleanup();
  }
}

function passthrough(file: File): PreparedPhoto {
  const contentType = file.type || "image/jpeg";
  return {
    blob: file,
    contentType,
    fileName: safePhotoName(file.name, contentType),
    originalBytes: file.size,
    outputBytes: file.size,
    compressed: false,
  };
}

function safePhotoName(name: string, contentType: string) {
  const base = name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-") || "evidencia";
  const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/webp": "webp", "image/png": "png", "image/heic": "heic", "image/heif": "heif", "image/gif": "gif" };
  const fallback = name.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase() ?? "jpg";
  return `${base}.${extensions[contentType.toLowerCase()] ?? fallback}`;
}

async function decodeImage(file: File): Promise<{
  image: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}> {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { image: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close() };
    } catch {
      // Algunos navegadores fallan con las opciones o con ciertos formatos:
      // probar sin opciones y despues con <img>.
    }
    try {
      const bitmap = await createImageBitmap(file);
      return { image: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close() };
    } catch {
      // Continuar con HTMLImageElement.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();

  try {
    // El evento load es mas confiable que image.decode(), que en Android
    // rechaza fotos validas en algunos dispositivos.
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`El formato de ${file.name} no se puede procesar en este dispositivo.`));
      image.src = objectUrl;
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error(`El formato de ${file.name} no se puede procesar en este dispositivo.`);
    return { image, width: image.naturalWidth, height: image.naturalHeight, cleanup: () => URL.revokeObjectURL(objectUrl) };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("No se pudo comprimir la imagen."));
    }, type, quality);
  });
}
