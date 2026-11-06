// Mapa base de Leaflet.
// Desde el 25/09/2026 CARTO exige una clave para sus mosaicos raster; sin clave devuelve
// una imagen con "API KEY REQUIRED". Con NEXT_PUBLIC_CARTO_BASEMAP_KEY se usa CARTO
// (estilo claro light_all, el que tenía la app); sin clave se usa OpenStreetMap como respaldo.
// La clave viaja al navegador por diseño: conviene restringirla al dominio de la app desde CARTO.

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export type Basemap = {
  provider: "carto" | "osm";
  url: string;
  attribution: string;
  maxZoom: number;
};

export function getBasemap(): Basemap {
  const cartoKey = process.env.NEXT_PUBLIC_CARTO_BASEMAP_KEY?.trim();

  if (cartoKey) {
    return {
      provider: "carto",
      url: `https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(cartoKey)}`,
      attribution: `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a>`,
      maxZoom: 20,
    };
  }

  return {
    provider: "osm",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: OSM_ATTRIBUTION,
    maxZoom: 19,
  };
}
