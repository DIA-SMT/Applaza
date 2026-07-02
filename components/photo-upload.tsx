"use client";

import { useMemo, useRef, useState } from "react";
import { Camera, Check, ImagePlus, LoaderCircle, MapPin, Upload } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import type { MaintenancePhoto, MaintenanceTask, PhotoType, SpaceRecord } from "@/types/domain";

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
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    if (!taskId && !selectedSpace) {
      setMessage("Selecciona un espacio verde.");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const client = getSupabaseBrowserClient();
      if (!client) throw new Error("Supabase no esta configurado. No se puede guardar evidencia sin base de datos.");

      const location = await getCurrentPosition();
      let taskForUpload = selectedSpace?.task;
      let uploadTaskId = taskId ?? taskForUpload?.id;

      if (!uploadTaskId) {
        if (!selectedSpace) throw new Error("Selecciona un espacio verde.");
        const today = new Date().toISOString().slice(0, 10);
        const { data: taskData, error: taskError } = await client
          .from("maintenance_tasks")
          .insert({
            green_space_id: selectedSpace.id,
            provider_id: selectedSpace.provider?.id ?? null,
            start_date: today,
            end_date: today,
            status: "programado",
            fulfilled: "pendiente",
            observations: "Registro creado para asociar evidencia fotografica.",
          })
          .select()
          .single();

        if (taskError) throw taskError;
        taskForUpload = taskData as MaintenanceTask;
        uploadTaskId = taskForUpload.id;
      }

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-") || "evidencia.jpg";
      const path = `${uploadTaskId}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await client.storage.from("maintenance-photos").upload(path, file, { contentType: file.type || "image/jpeg" });
      if (uploadError) throw uploadError;

      const imageUrl = client.storage.from("maintenance-photos").getPublicUrl(path).data.publicUrl;
      const { data: { user } } = await client.auth.getUser();
      if (!user) throw new Error("Inicia sesion para guardar evidencias.");

      const row = {
        maintenance_task_id: uploadTaskId,
        image_url: imageUrl,
        photo_type: type,
        uploaded_by: user.id,
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
      };
      const { data, error } = await client.from("maintenance_photos").insert(row).select().single();
      if (error) throw error;
      onUploaded(data as MaintenancePhoto, selectedSpace?.id, taskForUpload);

      setFile(undefined);
      if (cameraInput.current) cameraInput.current.value = "";
      if (galleryInput.current) galleryInput.current.value = "";
      setMessage(`Evidencia guardada para ${effectiveSpaceName}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo subir la foto");
    } finally {
      setBusy(false);
    }
  }

  return <form className="upload-form" onSubmit={submit}>
    <div className="upload-heading"><Camera size={18} /><div><strong>Nueva evidencia</strong></div></div>
    {!taskId && <label className="upload-space-field"><span><MapPin size={14} />Espacio verde</span><input list="upload-space-options" value={spaceQuery} onChange={(event) => {
      const value = event.target.value;
      setSpaceQuery(value);
      const match = spaceOptions.find((space) => optionLabel(space) === value || space.name.toLocaleLowerCase("es") === value.toLocaleLowerCase("es"));
      setSelectedSpaceId(match?.id ?? "");
    }} placeholder="Buscar por nombre, barrio o seccion" /><datalist id="upload-space-options">{spaceOptions.map((space) => <option key={space.id} value={optionLabel(space)} />)}</datalist></label>}
    {taskId && effectiveSpaceName && <div className="upload-space-readonly"><MapPin size={14} /><span>{effectiveSpaceName}</span></div>}
    <div className="upload-source-actions">
      <button type="button" className="source-button" onClick={() => cameraInput.current?.click()}><Camera size={18} /><span>Sacar foto</span></button>
      <button type="button" className="source-button" onClick={() => galleryInput.current?.click()}><ImagePlus size={18} /><span>Elegir galeria</span></button>
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" onChange={(event) => setFile(event.target.files?.[0])} />
      <input ref={galleryInput} type="file" accept="image/*" onChange={(event) => setFile(event.target.files?.[0])} />
    </div>
    {file && <div className="upload-selected-file"><Check size={14} /><span>{file.name}</span></div>}
    <div className="upload-actions"><select value={type} onChange={(event) => setType(event.target.value as PhotoType)}><option value="antes">1er control</option><option value="durante">2do control</option><option value="despues">3er control</option></select><button disabled={!file || busy || (!taskId && !selectedSpace)}>{busy ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />} Subir foto</button></div>
    {message && <p className="form-message"><Check size={14} />{message}</p>}
  </form>;
}

function optionLabel(space: SpaceRecord) {
  return [space.name, space.neighborhood, space.section_code ? `Seccion ${space.section_code}` : null].filter(Boolean).join(" - ");
}
