"use client";
import { useState } from "react";
import { LoaderCircle, LockKeyhole, Trees } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function login(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setError("Supabase no está configurado."); setBusy(false); return; }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError("Correo o contraseña incorrectos."); setBusy(false); return; }
    window.location.href = "/";
  }
  return <main className="login-page"><section className="login-brand"><div className="brand-mark"><Trees /></div><h1>Applaza</h1><p>Control municipal de espacios verdes</p><span>Municipalidad de San Miguel de Tucumán</span></section><section className="login-card"><div className="login-icon"><LockKeyhole /></div><h2>Acceso institucional</h2><p>Ingresá con tu cuenta autorizada.</p><form onSubmit={login}><label>Correo electrónico<input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="usuario@smt.gob.ar" /></label><label>Contraseña<input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>{error && <div className="login-error">{error}</div>}<button disabled={busy}>{busy && <LoaderCircle className="spin" size={17} />}{busy ? "Ingresando…" : "Ingresar"}</button></form><small>El alta de usuarios es administrada por DIA.</small></section></main>;
}
