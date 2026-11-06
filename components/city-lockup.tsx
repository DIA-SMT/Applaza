import Image from "next/image";
import { Leaf } from "lucide-react";

/** Marca combinada: logo oficial municipal + nombre de la ciudad + Applaza. */
export function CityLockup({ compact = false, priority = false }: { compact?: boolean; priority?: boolean }) {
  return <span className={`city-lockup ${compact ? "compact" : ""}`}>
    <Image src="/logo-municipal.png" alt="" width={40} height={40} priority={priority} />
    <span className="city-name"><small>Ciudad</small><b>San Miguel de Tucumán</b></span>
    <i aria-hidden="true" />
    <Leaf className="app-leaf" aria-hidden="true" />
    <span className="app-name"><b>Applaza</b><small>Espacios verdes</small></span>
  </span>;
}
