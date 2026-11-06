import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
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

// Tipografía de títulos con el carácter geométrico del portal Turismo SMT.
const display = Outfit({ subsets: ["latin"], weight: ["500", "600", "700", "800"], variable: "--font-outfit", display: "swap" });

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es" className={display.variable}><body>{children}<PwaRegister /></body></html>;
}
