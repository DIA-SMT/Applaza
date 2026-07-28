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

  const decoded = await decodeImage(file);
  const width = decoded.image.width;
  const height = decoded.image.height;
  const longestEdge = Math.max(width, height);
  const canPassThrough = file.size <= PASSTHROUGH_BYTES
    && longestEdge <= MAX_IMAGE_EDGE
    && /image\/(jpeg|webp)/i.test(file.type);

  if (canPassThrough) {
    decoded.cleanup();
    return {
      blob: file,
      contentType: file.type,
      fileName: safePhotoName(file.name, file.type),
      originalBytes: file.size,
      outputBytes: file.size,
    };
  }

  const scale = Math.min(1, MAX_IMAGE_EDGE / longestEdge);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");

  if (!context) {
    decoded.cleanup();
    throw new Error(`No se pudo procesar ${file.name}.`);
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);
  decoded.cleanup();

  const blob = await canvasToBlob(canvas, "image/jpeg", JPEG_QUALITY);
  return {
    blob,
    contentType: "image/jpeg",
    fileName: safePhotoName(file.name, "image/jpeg"),
    originalBytes: file.size,
    outputBytes: blob.size,
  };
}

function safePhotoName(name: string, contentType: string) {
  const base = name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-") || "evidencia";
  const extension = contentType === "image/webp" ? "webp" : "jpg";
  return `${base}.${extension}`;
}

async function decodeImage(file: File): Promise<{
  image: CanvasImageSource & { width: number; height: number };
  cleanup: () => void;
}> {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { image: bitmap, cleanup: () => bitmap.close() };
    } catch {
      // Some mobile image formats are only decoded through an HTMLImageElement.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = objectUrl;

  try {
    await image.decode();
    return { image, cleanup: () => URL.revokeObjectURL(objectUrl) };
  } catch {
    URL.revokeObjectURL(objectUrl);
    throw new Error(`El formato de ${file.name} no se puede procesar en este dispositivo.`);
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
