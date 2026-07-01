import Image from "next/image";

export default function Loading() {
  return <main className="app-loading"><Image src="/logo-municipal.png" alt="Municipalidad de San Miguel de Tucumán" width={58} height={58} priority /><div><strong>Cargando Applaza</strong><span>Consultando información territorial…</span></div><i /></main>;
}
