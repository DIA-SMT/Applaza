// Mapa base de Leaflet: mosaicos estándar de OpenStreetMap.
// No requieren clave; su política de uso pide mantener visible la atribución
// y no hacer descargas masivas (https://operations.osmfoundation.org/policies/tiles/).
// Antes se usaba CARTO, que desde el 25/09/2026 exige una clave para sus mosaicos.

export const BASEMAP = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19,
} as const;
