"use client";
import { useEffect, useState } from "react";
import { Check, LoaderCircle, X } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import type { Provider } from "@/types/domain";

const monthLabel = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" });

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function friendlyError(message: string) {
  return /relation .* does not exist|schema cache/i.test(message) ? "Falta ejecutar supabase/provider_ratings.sql en Supabase para habilitar las calificaciones." : message;
}

export function ProviderRating({ provider }: { provider: Provider }) {
  const [fulfilled, setFulfilled] = useState<"si" | "no" | null>(null);
  const [observations, setObservations] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const period = currentPeriod();

  useEffect(() => {
    let active = true;
    setLoading(true); setMessage(""); setError(""); setFulfilled(null); setObservations("");
    const client = getSupabaseBrowserClient();
    if (!client) { setLoading(false); setError("Supabase no está configurado."); return; }
    void client.from("provider_ratings").select("fulfilled,observations").eq("provider_id", provider.id).eq("period_month", period).maybeSingle().then(({ data, error: loadError }) => {
      if (!active) return;
      if (loadError) setError(friendlyError(loadError.message));
      if (data) { setFulfilled(data.fulfilled as "si" | "no"); setObservations(data.observations ?? ""); }
      setLoading(false);
    });
    return () => { active = false; };
  }, [provider.id, period]);

  async function save() {
    if (!fulfilled) return;
    setBusy(true); setMessage(""); setError("");
    const client = getSupabaseBrowserClient();
    if (!client) { setError("Supabase no está configurado."); setBusy(false); return; }
    const { data: { session } } = await client.auth.getSession();
    if (!session) { setError("Iniciá sesión para calificar."); setBusy(false); return; }
    const { error: saveError } = await client.from("provider_ratings").upsert({ provider_id: provider.id, period_month: period, fulfilled, observations: observations.trim(), rated_by: session.user.id }, { onConflict: "provider_id,period_month" });
    if (saveError) { setError(friendlyError(saveError.message)); setBusy(false); return; }
    setBusy(false);
    setMessage("Calificación guardada.");
  }

  return <div className="provider-rating">
    <div className="provider-rating-head">
      <strong>Calificación de {monthLabel.format(new Date())}</strong>
      <span>{provider.name}</span>
    </div>
    {loading ? <p className="provider-rating-loading"><LoaderCircle className="spin" size={15} />Buscando calificación del mes…</p> : <>
      <div className="provider-rating-toggle" role="group" aria-label="¿La cooperativa cumplió este mes?">
        <button className={fulfilled === "si" ? "active yes" : ""} aria-pressed={fulfilled === "si"} onClick={() => { setFulfilled("si"); setMessage(""); }}><Check size={17} />Cumplió</button>
        <button className={fulfilled === "no" ? "active no" : ""} aria-pressed={fulfilled === "no"} onClick={() => { setFulfilled("no"); setMessage(""); }}><X size={17} />No cumplió</button>
      </div>
      <label className="provider-rating-observation">Observación
        <textarea value={observations} onChange={(event) => { setObservations(event.target.value); setMessage(""); }} rows={3} placeholder="Ej.: cumplió en término; quedaron pendientes dos platabandas de la sección 3…" />
      </label>
      {error && <p className="provider-rating-error">{error}</p>}
      {message && <p className="provider-rating-saved"><Check size={14} />{message}</p>}
      <button className="provider-rating-save" disabled={!fulfilled || busy} onClick={() => void save()}>{busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}Guardar calificación</button>
    </>}
  </div>;
}
