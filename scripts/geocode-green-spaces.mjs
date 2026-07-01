import fs from "node:fs";
import path from "node:path";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter(line => line.includes("=")).map(line => line.split(/=(.*)/s).slice(0, 2)));
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || !anonKey) throw new Error("Faltan variables de Supabase en .env.local");

const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };
const source = await fetch(`${supabaseUrl}/rest/v1/green_spaces?select=source_key,name,address,neighborhood,section_code&source_key=not.is.null&latitude=is.null&order=source_key`, { headers });
if (!source.ok) throw new Error(`Supabase: ${source.status} ${await source.text()}`);
const spaces = await source.json();

const cleanQuery = value => value
  .replace(/\bP\.?\s*U\.?.*$/i, "")
  .replace(/\bVER\s+MAPA\b/gi, "")
  .replace(/\bSECCIONES?\b.*$/i, "")
  .replace(/(?<=[A-Za-zÁÉÍÓÚÜÑáéíóúüñ])(?=\d)/g, " ")
  .replace(/(?<=\d)(?=[A-Za-zÁÉÍÓÚÜÑáéíóúüñ])/g, " ")
  .replace(/\s+/g, " ").trim();

const requestEntries = spaces.map((space, sourceIndex) => ({ sourceIndex, request: {
  direccion: cleanQuery(space.address),
  departamento: "Capital",
  provincia: "Tucumán",
  max: 1,
} })).filter(entry => entry.request.direccion.length >= 4);
const requests = requestEntries.map(entry => entry.request);

const response = await fetch("https://apis.datos.gob.ar/georef/api/v2.0/direcciones", {
  method: "POST",
  headers: { "Content-Type": "application/json", "User-Agent": "Applaza-Municipal/0.1 geocoding-import" },
  body: JSON.stringify({ direcciones: requests }),
});
if (!response.ok) throw new Error(`Georef: ${response.status} ${await response.text()}`);
const payload = await response.json();
if (!Array.isArray(payload.resultados) || payload.resultados.length !== requests.length) throw new Error(`Respuesta inesperada: ${payload.resultados?.length ?? 0}/${requests.length}`);
const resultBySourceIndex = new Map(requestEntries.map((entry, index) => [entry.sourceIndex, payload.resultados[index]]));

const normalize = value => (value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const stop = new Set(["avenida","av","calle","pje","pasaje","entre","esquina","desde","hasta","norte","sur","este","oeste","san","santa","del","de","la","las","los","y","miguel","tucuman","argentina","capital","departamento","municipio"]);
const meaningful = value => normalize(value).split(" ").filter(token => token.length >= 4 && !stop.has(token));
const quote = value => `'${String(value ?? "").replaceAll("'", "''")}'`;
const csv = value => `"${String(value ?? "").replaceAll('"', '""')}"`;

const results = spaces.map((space, index) => {
  const request = requestEntries.find(entry => entry.sourceIndex === index)?.request;
  const result = resultBySourceIndex.get(index);
  const match = result?.direcciones?.[0];
  const lat = match?.ubicacion?.lat == null ? NaN : Number(match.ubicacion.lat);
  const lon = match?.ubicacion?.lon == null ? NaN : Number(match.ubicacion.lon);
  const inBounds = Number.isFinite(lat) && Number.isFinite(lon) && lat >= -27 && lat <= -26.70 && lon >= -65.40 && lon <= -65.05;
  const query = request?.direccion ?? "";
  const queryTokens = meaningful(query);
  const normalizedTokens = new Set(meaningful(match?.nomenclatura));
  const overlap = queryTokens.filter(token => normalizedTokens.has(token));
  const structured = /\d{2,}|\b(esquina|entre| y )\b/i.test(query);
  const accepted = Boolean(match && inBounds && structured && overlap.length > 0);
  let reason = "aceptado";
  if (!query) reason = "sin_direccion_consultable";
  else if (!match) reason = "sin_resultado";
  else if (!Number.isFinite(lat) || !Number.isFinite(lon)) reason = "sin_coordenadas";
  else if (!inBounds) reason = "fuera_del_area";
  else if (!structured) reason = "direccion_no_estructurada";
  else if (!overlap.length) reason = "coincidencia_de_calle_dudosa";
  return { ...space, query, normalized_address: match?.nomenclatura ?? "", latitude: Number.isFinite(lat) ? lat : "", longitude: Number.isFinite(lon) ? lon : "", accepted, reason, token_matches: overlap.join("|"), geocoding_source: accepted ? "Georef Argentina v2" : "" };
});

// One-time fallback for unresolved rows. Public Nominatim policy: serial, <=1 request/s, identifiable UA and local cache.
fs.mkdirSync("tmp/geocoding", { recursive: true });
const cachePath = "tmp/geocoding/nominatim-cache.json";
const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, "utf8")) : {};
const unresolved = results.filter(row => !row.accepted && row.query);
for (let index = 0; index < unresolved.length; index++) {
  const row = unresolved[index];
  const structured = /\d{2,}|\b(esquina|entre| y )\b/i.test(row.query);
  const searchText = `${structured ? row.query : `${row.name}, ${row.query}`}, San Miguel de Tucumán, Tucumán, Argentina`;
  let matches = cache[searchText];
  if (!matches) {
    const params = new URLSearchParams({ q: searchText, format: "jsonv2", limit: "1", countrycodes: "ar", viewbox: "-65.40,-26.70,-65.05,-27.00", bounded: "1", addressdetails: "1" });
    const nominatim = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { "User-Agent": "Applaza-Municipal/0.1 geocoding-import (municipal green spaces)" } });
    if (!nominatim.ok) throw new Error(`Nominatim: ${nominatim.status} ${await nominatim.text()}`);
    matches = await nominatim.json();
    cache[searchText] = matches;
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf8");
    await new Promise(resolve => setTimeout(resolve, 1100));
  }
  const match = matches[0];
  if (match) {
    const lat = Number(match.lat), lon = Number(match.lon);
    const inBounds = lat >= -27 && lat <= -26.70 && lon >= -65.40 && lon <= -65.05;
    const queryTokens = meaningful(searchText);
    const displayTokens = new Set(meaningful(match.display_name));
    const overlap = queryTokens.filter(token => displayTokens.has(token));
    const queryNumber = row.query.match(/\b\d{2,5}\b/)?.[0];
    const displayNumberMatches = !queryNumber || normalize(match.display_name).split(" ").includes(queryNumber);
    const textualMatch = queryNumber ? overlap.length > 0 && displayNumberMatches : overlap.length >= 2;
    if (inBounds && textualMatch) {
      row.latitude = lat; row.longitude = lon; row.normalized_address = match.display_name;
      row.accepted = true; row.reason = "aceptado_nominatim"; row.token_matches = overlap.join("|"); row.geocoding_source = "OpenStreetMap Nominatim";
    } else row.reason = inBounds && queryNumber && !displayNumberMatches ? "nominatim_ignoro_altura" : inBounds ? "nominatim_coincidencia_dudosa" : "nominatim_fuera_del_area";
  } else if (row.reason === "sin_resultado" || row.reason === "sin_coordenadas") row.reason = "sin_resultado_en_geocodificadores";
  if ((index + 1) % 20 === 0) console.log(`Nominatim: ${index + 1}/${unresolved.length}`);
}

fs.mkdirSync("data", { recursive: true });
const fields = ["source_key","name","address","neighborhood","section_code","query","normalized_address","latitude","longitude","accepted","reason","token_matches","geocoding_source"];
const serialize = rows => [fields.join(","), ...rows.map(row => fields.map(field => csv(row[field])).join(","))].join("\n") + "\n";
fs.writeFileSync("data/geocoding-results.csv", "\ufeff" + serialize(results), "utf8");
fs.writeFileSync("data/geocoding-review.csv", "\ufeff" + serialize(results.filter(row => !row.accepted)), "utf8");

const accepted = results.filter(row => row.accepted);
const sql = [
  "-- Coordenadas aceptadas automáticamente mediante API Georef Argentina.",
  "begin;",
  "alter table public.green_spaces add column if not exists normalized_address text;",
  "alter table public.green_spaces add column if not exists geocoding_source text;",
  "alter table public.green_spaces add column if not exists geocoded_at timestamptz;",
  "",
  ...accepted.map(row => `update public.green_spaces set latitude=${row.latitude}, longitude=${row.longitude}, normalized_address=${quote(row.normalized_address)}, geocoding_source=${quote(row.geocoding_source)}, geocoded_at=now() where source_key=${quote(row.source_key)} and latitude is null;`),
  "",
  "commit;",
  "",
].join("\n");
fs.writeFileSync("supabase/geocoding-update.sql", sql, "utf8");

const counts = Object.groupBy(results, row => row.reason);
console.log(`Consultados: ${results.length}`);
console.log(`Aceptados: ${accepted.length}`);
console.log(`A revisar: ${results.length - accepted.length}`);
for (const [reason, rows] of Object.entries(counts)) console.log(`${reason}: ${rows.length}`);
