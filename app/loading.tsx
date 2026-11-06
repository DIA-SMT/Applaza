"use client";

import Image from "next/image";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

const SLOW_AFTER_MS = 10_000;

export default function Loading() {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return <main className="app-loading">
    <Image src="/logo-municipal.png" alt="Municipalidad de San Miguel de Tucumán" width={58} height={58} priority />
    <div><strong>Cargando Applaza</strong><span>Consultando información territorial…</span></div>
    <i />
    {slow && <div className="app-loading-slow" role="status">
      <span>Está tardando más de lo normal. Puede ser la conexión.</span>
      <button type="button" onClick={() => window.location.reload()}><RefreshCw size={16} />Reintentar</button>
    </div>}
  </main>;
}
