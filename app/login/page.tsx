"use client";

import { useState } from "react";
import { CheckCircle2, LoaderCircle, LockKeyhole } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { CityLockup } from "@/components/city-lockup";
import { MascotaApplaza } from "@/components/mascota-applaza";

function getLoginErrorMessage(error: {
  code?: string;
  status?: number;
}) {
  if (error.code === "email_not_confirmed") {
    return "El correo de esta cuenta todavia no fue confirmado.";
  }

  if (error.code === "user_banned") {
    return "Esta cuenta se encuentra bloqueada. Contacta a un administrador.";
  }

  if (error.code === "over_request_rate_limit" || error.status === 429) {
    return "Hubo demasiados intentos. Espera unos minutos y vuelve a probar.";
  }

  if (
    error.code === "request_timeout" ||
    error.code === "unexpected_failure" ||
    (error.status !== undefined && error.status >= 500)
  ) {
    return "No se pudo conectar con el servicio de acceso. Intenta nuevamente.";
  }

  return "Correo o contrasena incorrectos.";
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase no esta configurado.");
      setBusy(false);
      return;
    }

    try {
      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (loginError) {
        setError(getLoginErrorMessage(loginError));
        setBusy(false);
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setError("La sesion no pudo guardarse. Recarga la pagina e intenta nuevamente.");
        setBusy(false);
        return;
      }

      window.location.assign("/");
    } catch {
      setError("No se pudo conectar con el servicio de acceso. Intenta nuevamente.");
      setBusy(false);
    }
  }

  return <main className="login-page">
    <section className="login-brand" aria-labelledby="login-title">
      <header className="login-lockup" aria-label="Municipalidad de San Miguel de Tucumán · Applaza"><CityLockup priority /></header>
      <div className="login-hero-copy">
        <p className="eyebrow">Municipalidad de San Miguel de Tucumán</p>
        <h1 id="login-title">
          <span className="title-line">Applaza</span>
          <span className="title-line accent">
            Espacios verde<span className="grab-letter">s</span>
            {/* Migue llega y se apoya sobre la última letra: su brazo queda por delante de la "s" 3D. */}
            <span className="lean-migue" aria-hidden="true"><MascotaApplaza variant="apoyado" size={384} decorative priority /></span>
          </span>
        </h1>
        <p>Gestión integral de plazas, parques y espacios verdes de la Municipalidad de San Miguel de Tucumán.</p>
        <ul className="login-features">
          <li><CheckCircle2 aria-hidden="true" />Mapa operativo georreferenciado</li>
          <li><CheckCircle2 aria-hidden="true" />Registro de control por cooperativa</li>
          <li><CheckCircle2 aria-hidden="true" />Evidencias fotográficas de campo</li>
          <li><CheckCircle2 aria-hidden="true" />Auditoría e informes</li>
        </ul>
      </div>
      <svg className="hero-waves" viewBox="0 0 1200 110" preserveAspectRatio="none" aria-hidden="true">
        <path className="wave-sky" d="M0 110V62c230 40 470 44 700 10 190-28 350-46 500-30v68z" />
        <path className="wave-yellow" d="M0 110V84c240 26 480 26 720 0 180-20 330-30 480-18v44z" />
        <path className="wave-white" d="M0 110V100c260 10 520 8 780-8 160-10 300-14 420-8v26z" />
      </svg>
    </section>
    <section className="login-card">
      <div className="login-icon"><LockKeyhole /></div>
      <h2>Acceso institucional</h2>
      <p>Ingresá con tu cuenta autorizada.</p>
      <form onSubmit={login}>
        <label>
          Correo electrónico
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="usuario@smt.gob.ar"
          />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && <div className="login-error" role="alert">{error}</div>}
        <button disabled={busy} type="submit">
          {busy && <LoaderCircle className="spin" size={17} />}
          {busy ? "Ingresando..." : "Ingresar"}
        </button>
      </form>
      <small>El alta de usuarios es administrada por DIA.</small>
    </section>
  </main>;
}
