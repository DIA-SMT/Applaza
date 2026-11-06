"use client";

import Image from "next/image";
import { useState } from "react";

/**
 * Migue, mascota original de Applaza (campera verde, credencial "Gestión Espacios Verdes").
 * Usa únicamente los assets del repositorio. Si la imagen no carga, muestra un
 * contenedor accesible en lugar de un personaje sustituto.
 */
const VARIANTS = {
  full: { src: "/migue-bot-cutout.png", width: 1254, height: 1254 },
  avatar: { src: "/migue-avatar.png", width: 512, height: 512 },
  // Pose apoyado sobre una letra, pulgar arriba (login).
  apoyado: { src: "/migue-apoyado.webp", width: 384, height: 628 },
} as const;

export function MascotaApplaza({
  variant = "full",
  size,
  decorative = false,
  priority = false,
  className = "",
}: {
  variant?: keyof typeof VARIANTS;
  size: number;
  decorative?: boolean;
  priority?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const asset = VARIANTS[variant];
  const label = "Migue, asistente de Applaza";

  if (failed) {
    return <div className={`mascota-applaza mascota-placeholder ${className}`} style={{ width: size, height: size }} role={decorative ? undefined : "img"} aria-label={decorative ? undefined : label} aria-hidden={decorative || undefined}>
      <span>Migue</span>
    </div>;
  }

  return <Image
    className={`mascota-applaza ${className}`}
    src={asset.src}
    width={size}
    height={Math.round((size * asset.height) / asset.width)}
    alt={decorative ? "" : label}
    priority={priority}
    sizes={`${size}px`}
    onError={() => setFailed(true)}
  />;
}
