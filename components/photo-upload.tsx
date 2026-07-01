"use client";
import { useRef, useState } from "react";
import { Camera, Check, LoaderCircle, Upload } from "lucide-react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";
import type { MaintenancePhoto, PhotoType } from "@/types/domain";

export function PhotoUpload({ taskId, onUploaded }: { taskId: string; onUploaded: (photo: MaintenancePhoto) => void }) {
  const [type, setType] = useState<PhotoType>("durante"); const [file, setFile] = useState<File>(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const input = useRef<HTMLInputElement>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!file) return; setBusy(true); setMessage("");
    try {
      let imageUrl = URL.createObjectURL(file); const client = getSupabaseBrowserClient();
      if (client) {
        const path = `${taskId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
        const { error: uploadError } = await client.storage.from("maintenance-photos").upload(path, file); if (uploadError) throw uploadError;
        imageUrl = client.storage.from("maintenance-photos").getPublicUrl(path).data.publicUrl;
        const { data: { user } } = await client.auth.getUser();
        if (!user) throw new Error("Iniciá sesión para guardar evidencias.");
        const row = { maintenance_task_id: taskId, image_url: imageUrl, photo_type: type, uploaded_by: user.id };
        const { data, error } = await client.from("maintenance_photos").insert(row).select().single(); if (error) throw error; onUploaded(data as MaintenancePhoto);
      } else onUploaded({ id: crypto.randomUUID(), maintenance_task_id: taskId, image_url: imageUrl, photo_type: type, uploaded_by: null, latitude: null, longitude: null, created_at: new Date().toISOString() });
      setFile(undefined); if (input.current) input.current.value = ""; setMessage(isSupabaseConfigured ? "Evidencia guardada" : "Evidencia agregada en modo demo");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo subir la foto"); } finally { setBusy(false); }
  }
  return <form className="upload-form" onSubmit={submit}>
    <div className="upload-heading"><Camera size={18} /><div><strong>Nueva evidencia</strong><small>{isSupabaseConfigured ? "Se guardará en Supabase Storage" : "Modo demo · configure Supabase para persistir"}</small></div></div>
    <label className="dropzone"><Upload size={20} /><span>{file ? file.name : "Seleccionar o tomar una foto"}</span><input ref={input} type="file" accept="image/*" capture="environment" onChange={(e) => setFile(e.target.files?.[0])} /></label>
    <div className="upload-actions"><select value={type} onChange={(e) => setType(e.target.value as PhotoType)}><option value="antes">Antes</option><option value="durante">Durante</option><option value="despues">Después</option></select><button disabled={!file || busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />} Subir foto</button></div>
    {message && <p className="form-message"><Check size={14} />{message}</p>}
  </form>;
}
