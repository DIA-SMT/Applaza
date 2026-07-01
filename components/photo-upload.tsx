"use client";

import { useMemo, useRef, useState } from "react";
import { Camera, Check, LoaderCircle, MapPin, Upload } from "lucide-react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";
import type { MaintenancePhoto, PhotoType, SpaceRecord } from "@/types/domain";

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
  onUploaded: (photo: MaintenancePhoto, spaceId?: string) => void;
}) {
  const spacesWithTask = useMemo(() => spaces.filter((space) => space.task), [spaces]);
  const [selectedSpaceId, setSelectedSpaceId] = useState(spacesWithTask[0]?.id ?? "");
  const selectedSpace = spacesWithTask.find((space) => space.id === selectedSpaceId);
  const effectiveTaskId = taskId ?? selectedSpace?.task?.id;
  const effectiveSpaceName = spaceName ?? selectedSpace?.name;
  const [type, setType] = useState<PhotoType>("durante");
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    if (!effectiveTaskId) {
      setMessage("Selecciona un espacio verde con mantenimiento activo.");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      let imageUrl = URL.createObjectURL(file);
      const client = getSupabaseBrowserClient();
      const location = await getCurrentPosition();

      if (client) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-") || "evidencia.jpg";
        const path = `${effectiveTaskId}/${crypto.randomUUID()}-${safeName}`;
        const { error: uploadError } = await client.storage.from("maintenance-photos").upload(path, file, { contentType: file.type || "image/jpeg" });
        if (uploadError) throw uploadError;

        imageUrl = client.storage.from("maintenance-photos").getPublicUrl(path).data.publicUrl;
        const { data: { user } } = await client.auth.getUser();
        if (!user) throw new Error("Inicia sesion para guardar evidencias.");

        const row = {
          maintenance_task_id: effectiveTaskId,
          image_url: imageUrl,
          photo_type: type,
          uploaded_by: user.id,
          latitude: location?.latitude ?? null,
          longitude: location?.longitude ?? null,
        };
        const { data, error } = await client.from("maintenance_photos").insert(row).select().single();
        if (error) throw error;
        onUploaded(data as MaintenancePhoto, selectedSpace?.id);
      } else {
        onUploaded({
          id: crypto.randomUUID(),
          maintenance_task_id: effectiveTaskId,
          image_url: imageUrl,
          photo_type: type,
          uploaded_by: null,
          latitude: location?.latitude ?? null,
          longitude: location?.longitude ?? null,
          created_at: new Date().toISOString(),
        }, selectedSpace?.id);
      }

      setFile(undefined);
      if (input.current) input.current.value = "";
      setMessage(isSupabaseConfigured ? `Evidencia guardada para ${effectiveSpaceName}` : `Evidencia agregada en modo demo para ${effectiveSpaceName}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo subir la foto");
    } finally {
      setBusy(false);
    }
  }

  return <form className="upload-form" onSubmit={submit}>
    <div className="upload-heading"><Camera size={18} /><div><strong>Nueva evidencia</strong><small>{isSupabaseConfigured ? "Se guardara en Supabase Storage" : "Modo demo - configure Supabase para persistir"}</small></div></div>
    {!taskId && <label className="upload-space-field"><span><MapPin size={14} />Espacio verde</span><select value={selectedSpaceId} onChange={(event) => setSelectedSpaceId(event.target.value)}><option value="">Seleccionar espacio</option>{spacesWithTask.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>}
    {taskId && effectiveSpaceName && <div className="upload-space-readonly"><MapPin size={14} /><span>{effectiveSpaceName}</span></div>}
    <label className="dropzone"><Camera size={20} /><span>{file ? file.name : "Sacar foto o elegir imagen"}</span><input ref={input} type="file" accept="image/*" capture="environment" onChange={(event) => setFile(event.target.files?.[0])} /></label>
    <div className="upload-actions"><select value={type} onChange={(event) => setType(event.target.value as PhotoType)}><option value="antes">Antes</option><option value="durante">Durante</option><option value="despues">Despues</option></select><button disabled={!file || busy || !effectiveTaskId}>{busy ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />} Subir foto</button></div>
    {message && <p className="form-message"><Check size={14} />{message}</p>}
  </form>;
}
