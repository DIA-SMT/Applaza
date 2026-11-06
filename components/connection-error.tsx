"use client";

import { RefreshCw, WifiOff } from "lucide-react";
import { useState } from "react";
import { MascotaApplaza } from "./mascota-applaza";

/** Se muestra cuando Supabase no responde a tiempo, en lugar de dejar la app cargando sin fin. */
export function ConnectionError({ compact = false }: { compact?: boolean }) {
  const [retrying, setRetrying] = useState(false);

  function retry() {
    setRetrying(true);
    window.location.reload();
  }

  return <main className={`connection-error ${compact ? "compact" : ""}`} role="alert">
    <div className="connection-error-card">
      <MascotaApplaza variant="avatar" size={88} decorative />
      <span className="connection-error-icon" aria-hidden="true"><WifiOff size={20} /></span>
      <h1>No pudimos conectar con el servidor</h1>
      <p>El servicio está tardando más de lo normal o la conexión es inestable. Tus datos no se perdieron.</p>
      <button type="button" onClick={retry} disabled={retrying}>
        <RefreshCw size={17} className={retrying ? "spin" : undefined} />
        {retrying ? "Reintentando…" : "Reintentar"}
      </button>
    </div>
  </main>;
}
