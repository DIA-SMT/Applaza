import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";

export const metadata: Metadata = {
  title: "Applaza | Gestión de espacios verdes",
  description: "Control municipal de mantenimiento y relevamiento",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Applaza" },
  icons: { apple: "/icons/icon-192.png" },
};
export const viewport: Viewport = { themeColor: "#0166ff" };

// Tipografía de títulos (Outfit, OFL) incluida en el repo: el build no depende de Google Fonts,
// cuya descarga hizo fallar el deploy de producción. Archivo variable, subconjunto latino (cubre español).
const display = localFont({
  src: [{ path: "./fonts/Outfit-latin.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-outfit",
  display: "swap",
  fallback: ["DM Sans", "system-ui", "sans-serif"],
});

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es" className={display.variable}><body>{children}<PwaRegister /></body></html>;
}
