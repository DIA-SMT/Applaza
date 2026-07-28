"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, CloudOff, ImagePlus, LoaderCircle, MapPin, TriangleAlert, Upload, X } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { isNetworkError } from "@/lib/offline-queue";
import { addPhotoToOutbox, countPhotoOutbox, flushPhotoOutbox, onPhotoOutboxChanged } from "@/lib/photo-outbox";
import { PHOTO_BATCH_LIMIT, preparePhoto, runWithConcurrency, type PreparedPhoto } from "@/lib/photo-preparation";
import type { MaintenancePhoto, MaintenanceTask, PhotoType, SpaceRecord } from "@/types/domain";

type UploadMessage = { tone: "success" | "error" | "info"; text: string };
type UploadProgress = { completed: number; total: number };

function getCurrentPosition(): Promise<{ latitude: number; longitude: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 5000 },
    );
  });
}

export function PhotoUpload({
  taskId,
  spaceName,
  spaces = [],
  onUploaded,
}: {
  taskId?: string;
  spaceName?: string;
  spaces?: SpaceRecord[];
  onUploaded: (photo: MaintenancePhoto, spaceId?: string, task?: MaintenanceTask) => void;
}) {
  const spaceOptions = useMemo(() => [...spaces].sort((left, right) => left.name.localeCompare(right.name, "es")), [spaces]);
  const [selectedSpaceId, setSelectedSpaceId] = useState(spaceOptions[0]?.id ?? "");
  const [spaceQuery, setSpaceQuery] = useState(spaceOptions[0]?.name ?? "");
  const selectedSpace = spaceOptions.find((space) => space.id === selectedSpaceId);
  const effectiveSpaceName = spaceName ?? selectedSpace?.name;
  const [type, setType] = useState<PhotoType>("durante");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<UploadMessage>();
  const [progress, setProgress] = useState<UploadProgress>({ completed: 0, total: 0 });
  const [pendingCount, setPendingCount] = useState(0);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    const refresh = () => { void countPhotoOutbox().then((count) => { if (active) setPendingCount(count); }); };
    refresh();
    const unsubscribe = onPhotoOutboxChanged(refresh);
    const trySync = () => { const client = getSupabaseBrowserClient(); if (client && navigator.onLine) void flushPhotoOutbox(client); };
    window.addEventListener("online", trySync);
    trySync();
    return () => { active = false; unsubscribe(); window.removeEventListener("online", trySync); };
  }, []);

  function addSelectedFiles(selected: FileList | null) {
    if (!selected?.length) return;

    const incoming = Array.from(selected).filter((file) => file.type.startsWith("image/"));
    const next = [...files];
    for (const file of incoming) {
      const duplicate = next.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified);
      if (!duplicate && next.length < PHOTO_BATCH_LIMIT) next.push(file);
    }

    setFiles(next);
    setMessage(incoming.length !== selected.length
      ? { tone: "error", text: "Se omitieron archivos que no eran imagenes." }
      : next.length < files.length + incoming.length
        ? { tone: "info", text: `Puedes cargar hasta ${PHOTO_BATCH_LIMIT} fotos por lote.` }
        : undefined);
  }

  function clearSelection() {
    setFiles([]);
    setProgress({ completed: 0, total: 0 });
    setMessage(undefined);
    if (cameraInput.current) cameraInput.current.value = "";
    if (galleryInput.current) galleryInput.current.value = "";
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!files.length) return;
    if (!taskId && !selectedSpace) {
      setMessage({ tone: "error", text: "Selecciona un espacio verde." });
      return;
    }

    const selectedFiles = [...files];
    setBusy(true);
    setMessage(undefined);
    setProgress({ completed: 0, total: selectedFiles.length });

    try {
      const client = getSupabaseBrowserClient();
      if (!client) throw new Error("Supabase no esta configurado. No se puede guardar evidencia sin base de datos.");

      const [{ data: { session } }, location] = await Promise.all([
        client.auth.getSession(),
        getCurrentPosition(),
      ]);
      const userId = session?.user?.id;
      if (!userId) throw new Error("Inicia sesion para guardar evidencias.");

      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      const batchStartedAt = new Date().toISOString();
      const today = batchStartedAt.slice(0, 10);
      let taskForUpload = selectedSpace?.task;
      let uploadTaskId = taskId ?? taskForUpload?.id;
      let taskSeed: Record<string, unknown> | null = null;

      if (!uploadTaskId) {
        if (!selectedSpace) throw new Error("Selecciona un espacio verde.");
        const seed = {
          id: crypto.randomUUID(),
          green_space_id: selectedSpace.id,
          provider_id: selectedSpace.provider?.id ?? null,
          start_date: today,
          end_date: today,
          status: "programado",
          fulfilled: "pendiente",
          observations: "Registro creado para asociar evidencia fotografica.",
        };
        const localTask = { ...seed, completed_date: null, created_at: batchStartedAt, updated_at: batchStartedAt } as unknown as MaintenanceTask;

        if (offline) {
          taskSeed = seed;
          taskForUpload = localTask;
          uploadTaskId = seed.id;
        } else {
          const { data: taskData, error: taskError } = await client.from("maintenance_tasks").insert(seed).select().single();
          if (taskError) {
            if (!isNetworkError(taskError.message)) throw taskError;
            taskSeed = seed;
            taskForUpload = localTask;
            uploadTaskId = seed.id;
          } else {
            taskForUpload = taskData as MaintenanceTask;
            uploadTaskId = taskForUpload.id;
          }
        }
      }

      if (!uploadTaskId) throw new Error("No se pudo determinar el mantenimiento para las fotos.");

      const failedFiles: File[] = [];
      const errors: string[] = [];
      let uploadedCount = 0;
      let queuedCount = 0;
      let originalBytes = 0;
      let outputBytes = 0;

      await runWithConcurrency(selectedFiles, 2, async (file) => {
        try {
          const prepared = await preparePhoto(file);
          originalBytes += prepared.originalBytes;
          outputBytes += prepared.outputBytes;
          const result = await savePreparedPhoto({
            client,
            prepared,
            originalFile: file,
            uploadTaskId,
            taskSeed,
            taskForUpload,
            selectedSpace,
            effectiveSpaceName,
            userId,
            location,
            type,
            forceQueue: offline || Boolean(taskSeed),
            onUploaded,
          });
          if (result === "queued") queuedCount += 1;
          else uploadedCount += 1;
        } catch (error) {
          failedFiles.push(file);
          errors.push(error instanceof Error ? error.message : `No se pudo subir ${file.name}.`);
        } finally {
          setProgress((current) => ({ ...current, completed: current.completed + 1 }));
        }
      });

      setFiles(failedFiles);
      resetFileInputs(cameraInput, galleryInput);

      if (failedFiles.length) {
        setMessage({
          tone: "error",
          text: `${uploadedCount + queuedCount} de ${selectedFiles.length} fotos procesadas. ${failedFiles.length} quedaron listas para reintentar. ${errors[0]}`,
        });
      } else {
        const savedText = queuedCount
          ? `${queuedCount} quedaron en espera y se subiran al recuperar conexion.`
          : `${uploadedCount} se guardaron correctamente.`;
        const reduction = originalBytes > 0 ? Math.max(0, Math.round((1 - outputBytes / originalBytes) * 100)) : 0;
        setMessage({
          tone: queuedCount ? "info" : "success",
          text: `${selectedFiles.length === 1 ? "Foto procesada." : `${selectedFiles.length} fotos procesadas.`} ${savedText}${reduction > 0 ? ` Peso reducido ${reduction}%.` : ""}`,
        });
      }
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudieron subir las fotos." });
    } finally {
      setBusy(false);
    }
  }

  const selectedBytes = files.reduce((total, file) => total + file.size, 0);
  const progressPercent = progress.total ? Math.round((progress.completed / progress.total) * 100) : 0;

  return <form className="upload-form" onSubmit={submit}>
    <div className="upload-heading"><Camera size={18} /><div><strong>Nueva evidencia</strong></div></div>
    {!taskId && <label className="upload-space-field"><span><MapPin size={14} />Espacio verde</span><input disabled={busy} list="upload-space-options" value={spaceQuery} onChange={(event) => {
      const value = event.target.value;
      setSpaceQuery(value);
      const match = spaceOptions.find((space) => optionLabel(space) === value || space.name.toLocaleLowerCase("es") === value.toLocaleLowerCase("es"));
      setSelectedSpaceId(match?.id ?? "");
    }} placeholder="Buscar por nombre, barrio o seccion" /><datalist id="upload-space-options">{spaceOptions.map((space) => <option key={space.id} value={optionLabel(space)} />)}</datalist></label>}
    {taskId && effectiveSpaceName && <div className="upload-space-readonly"><MapPin size={14} /><span>{effectiveSpaceName}</span></div>}
    <div className="upload-source-actions">
      <button disabled={busy} type="button" className="source-button" onClick={() => cameraInput.current?.click()}><Camera size={18} /><span>Sacar foto</span></button>
      <button disabled={busy} type="button" className="source-button" onClick={() => galleryInput.current?.click()}><ImagePlus size={18} /><span>Elegir galeria</span></button>
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" onChange={(event) => addSelectedFiles(event.target.files)} />
      <input ref={galleryInput} type="file" accept="image/*" multiple onChange={(event) => addSelectedFiles(event.target.files)} />
    </div>
    {files.length > 0 && <div className="upload-selected-batch">
      <Check size={15} />
      <div><strong>{files.length === 1 ? files[0].name : `${files.length} fotos seleccionadas`}</strong><span>{formatBytes(selectedBytes)} en total</span></div>
      <button type="button" disabled={busy} onClick={clearSelection} aria-label="Quitar fotos seleccionadas" title="Quitar seleccion"><X size={15} /></button>
    </div>}
    {busy && <div className="upload-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
      <div><span>Procesando lote</span><strong>{progress.completed}/{progress.total}</strong></div>
      <i><span style={{ width: `${progressPercent}%` }} /></i>
    </div>}
    <div className="upload-actions"><select disabled={busy} value={type} onChange={(event) => setType(event.target.value as PhotoType)}><option value="antes">1er control</option><option value="durante">2do control</option><option value="despues">3er control</option></select><button disabled={!files.length || busy || (!taskId && !selectedSpace)}>{busy ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}{busy ? "Procesando..." : files.length > 1 ? `Subir ${files.length} fotos` : "Subir foto"}</button></div>
    {message && <p className={`form-message ${message.tone}`}>{message.tone === "error" ? <TriangleAlert size={14} /> : <Check size={14} />}{message.text}</p>}
    {pendingCount > 0 && <p className="form-message offline-note"><CloudOff size={14} />{pendingCount === 1 ? "1 evidencia esperando conexion para subirse" : `${pendingCount} evidencias esperando conexion para subirse`}</p>}
  </form>;
}

async function savePreparedPhoto({
  client,
  prepared,
  originalFile,
  uploadTaskId,
  taskSeed,
  taskForUpload,
  selectedSpace,
  effectiveSpaceName,
  userId,
  location,
  type,
  forceQueue,
  onUploaded,
}: {
  client: NonNullable<ReturnType<typeof getSupabaseBrowserClient>>;
  prepared: PreparedPhoto;
  originalFile: File;
  uploadTaskId: string;
  taskSeed: Record<string, unknown> | null;
  taskForUpload?: MaintenanceTask;
  selectedSpace?: SpaceRecord;
  effectiveSpaceName?: string;
  userId: string;
  location: { latitude: number; longitude: number } | null;
  type: PhotoType;
  forceQueue: boolean;
  onUploaded: (photo: MaintenancePhoto, spaceId?: string, task?: MaintenanceTask) => void;
}): Promise<"uploaded" | "queued"> {
  const nowIso = new Date().toISOString();
  const photoId = crypto.randomUUID();
  const path = `${uploadTaskId}/${photoId}-${prepared.fileName}`;
  const imageUrl = client.storage.from("maintenance-photos").getPublicUrl(path).data.publicUrl;
  const row = {
    id: photoId,
    maintenance_task_id: uploadTaskId,
    image_url: imageUrl,
    photo_type: type,
    uploaded_by: userId,
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
  };

  const queueIt = async () => {
    await addPhotoToOutbox({
      id: photoId,
      path,
      contentType: prepared.contentType,
      blob: prepared.blob,
      row,
      taskSeed,
      label: `${originalFile.name} - ${effectiveSpaceName ?? "espacio verde"}`,
      queuedAt: nowIso,
    });
    onUploaded({ ...row, image_url: URL.createObjectURL(prepared.blob), created_at: nowIso } as MaintenancePhoto, selectedSpace?.id, taskForUpload);
    return "queued" as const;
  };

  if (forceQueue) return queueIt();

  const { error: uploadError } = await client.storage.from("maintenance-photos").upload(path, prepared.blob, {
    contentType: prepared.contentType,
    cacheControl: "3600",
    upsert: false,
  });
  if (uploadError) {
    if (isNetworkError(uploadError.message)) return queueIt();
    throw uploadError;
  }

  const { data, error: rowError } = await client.from("maintenance_photos").insert(row).select().single();
  if (rowError) {
    if (isNetworkError(rowError.message)) return queueIt();
    await client.storage.from("maintenance-photos").remove([path]);
    throw rowError;
  }

  onUploaded(data as MaintenancePhoto, selectedSpace?.id, taskForUpload);
  return "uploaded";
}

function resetFileInputs(cameraInput: React.RefObject<HTMLInputElement | null>, galleryInput: React.RefObject<HTMLInputElement | null>) {
  if (cameraInput.current) cameraInput.current.value = "";
  if (galleryInput.current) galleryInput.current.value = "";
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function optionLabel(space: SpaceRecord) {
  return [space.name, space.neighborhood, space.section_code ? `Seccion ${space.section_code}` : null].filter(Boolean).join(" - ");
}
