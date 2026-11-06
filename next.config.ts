import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

// Solo en desarrollo: IPs de esta PC en la red local, para abrir el servidor desde un celular.
const lanAddresses = Object.values(networkInterfaces())
  .flat()
  .filter((address) => address && address.family === "IPv4" && !address.internal)
  .map((address) => address!.address);

const nextConfig: NextConfig = {
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  allowedDevOrigins: [...lanAddresses, ...(process.env.DEV_LAN_ORIGINS?.split(",").filter(Boolean) ?? [])],
};

export default nextConfig;
