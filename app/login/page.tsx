"use client";

import { useState } from "react";
import Image from "next/image";
import { LoaderCircle, LockKeyhole } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase";

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
    <section className="login-brand">
      <div className="brand-mark">
        <Image src="/logo-municipal.png" alt="Municipalidad de San Miguel de Tucuman" width={58} height={58} priority />
      </div>
      <h1>Applaza</h1>
      <p>Control municipal de espacios verdes</p>
      <span>Municipalidad de San Miguel de Tucuman</span>
    </section>
    <section className="login-card">
      <div className="login-icon"><LockKeyhole /></div>
      <h2>Acceso institucional</h2>
      <p>Ingresa con tu cuenta autorizada.</p>
      <form onSubmit={login}>
        <label>
          Correo electronico
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
          Contrasena
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
