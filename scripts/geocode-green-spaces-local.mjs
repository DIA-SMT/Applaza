import fs from "node:fs";

const INPUT = "data/pdf-green-spaces.csv";
const CACHE_PATH = "tmp/geocoding/nominatim-local-cache.json";
const CITY = "San Miguel de Tucuman, Tucuman, Argentina";
const VIEWBOX = "-65.40,-26.70,-65.05,-27.00";
const BOUNDS = { minLat: -27, maxLat: -26.7, minLon: -65.4, maxLon: -65.05 };
const USER_AGENT = "Applaza-Municipal/0.1 geocoding-import (green spaces)";

if (!fs.existsSync(INPUT)) throw new Error(`No existe ${INPUT}`);
fs.mkdirSync("tmp/geocoding", { recursive: true });
fs.mkdirSync("data", { recursive: true });

const rows = parseCsv(fs.readFileSync(INPUT, "utf8").replace(/^\uFEFF/, ""));
const spaces = rows.map((row, index) => ({
  ...row,
  source_key: `pdf-2026-06-30-${String(index + 1).padStart(3, "0")}`,
  row_number: index + 1,
}));
const cache = fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) : {};
const georefByKey = await georefBatch(spaces);

const results = [];

for (let index = 0; index < spaces.length; index += 1) {
  const space = spaces[index];
  const candidates = buildCandidates(space);
  let best = georefByKey.get(space.source_key) ?? null;

  if (!best) {
    for (const candidate of candidates) {
      const matches = await nominatim(candidate.query);
      const scored = matches.map((match) => scoreMatch(space, candidate, match)).filter(Boolean);
      scored.sort((left, right) => right.score - left.score);
      if (scored[0] && (!best || scored[0].score > best.score)) best = scored[0];
      if (best?.confidence === "alta") break;
    }
  }

  const accepted = best && (best.confidence === "alta" || best.confidence === "media");
  results.push({
    source_key: space.source_key,
    name: space.name,
    source_type: space.source_type,
    address: space.address,
    neighborhood: space.neighborhood,
    section_code: space.section,
    query: best?.query ?? candidates[0]?.query ?? "",
    normalized_address: best?.display_name ?? "",
    latitude: accepted ? best.lat : "",
    longitude: accepted ? best.lon : "",
    accepted: Boolean(accepted),
    confidence: accepted ? best.confidence : "revisar",
    score: best?.score?.toFixed(2) ?? "",
    reason: accepted ? best.reason : best?.reason ?? "sin_resultado_confiable",
    geocoding_source: accepted ? best.source : "",
  });

  if ((index + 1) % 10 === 0 || index + 1 === spaces.length) {
    console.log(`Geocodificados ${index + 1}/${spaces.length}`);
  }
}

writeCsv("data/geocoding-results-local.csv", results);
writeCsv("data/geocoding-review-local.csv", results.filter((row) => !row.accepted));
writeSql("supabase/geocoding-update.sql", results.filter((row) => row.accepted));

const counts = countBy(results, "confidence");
console.log(`Total: ${results.length}`);
console.log(`Aceptados: ${results.filter((row) => row.accepted).length}`);
console.log(`A revisar: ${results.filter((row) => !row.accepted).length}`);
for (const [key, value] of Object.entries(counts)) console.log(`${key}: ${value}`);

async function nominatim(query) {
  if (cache[query]) return cache[query];
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "5",
    countrycodes: "ar",
    viewbox: VIEWBOX,
    bounded: "1",
    addressdetails: "1",
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) throw new Error(`Nominatim ${response.status}: ${await response.text()}`);
  const data = await response.json();
  cache[query] = data;
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), "utf8");
  await new Promise((resolve) => setTimeout(resolve, 1100));
  return data;
}

async function georefBatch(sourceSpaces) {
  const entries = sourceSpaces
    .map((space) => ({ space, direccion: cleanAddress(space.address) }))
    .filter((entry) => entry.direccion.length >= 4);
  const response = await fetch("https://apis.datos.gob.ar/georef/api/v2.0/direcciones", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({
      direcciones: entries.map((entry) => ({
        direccion: entry.direccion,
        departamento: "Capital",
        provincia: "Tucuman",
        max: 1,
      })),
    }),
  });
  if (!response.ok) throw new Error(`Georef ${response.status}: ${await response.text()}`);
  const payload = await response.json();
  const out = new Map();
  const resultados = payload.resultados ?? [];

  for (let index = 0; index < entries.length; index += 1) {
    const { space, direccion } = entries[index];
    const match = resultados[index]?.direcciones?.[0];
    const lat = Number(match?.ubicacion?.lat);
    const lon = Number(match?.ubicacion?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inBounds(lat, lon)) continue;

    const display = match.nomenclatura ?? "";
    const displayTokens = new Set(meaningful(display));
    const addressTokens = meaningful(direccion);
    const overlap = addressTokens.filter((token) => displayTokens.has(token));
    const queryNumber = direccion.match(/\b\d{2,5}\b/)?.[0];
    const numberMatch = !queryNumber || normalize(display).split(" ").includes(queryNumber);
    if (!overlap.length && !numberMatch) continue;

    out.set(space.source_key, {
      lat,
      lon,
      display_name: `${display}, San Miguel de Tucuman, Capital, Tucuman`,
      query: direccion,
      score: 8 + overlap.length,
      confidence: queryNumber && numberMatch ? "alta" : "media",
      reason: queryNumber && numberMatch ? "direccion_con_altura" : "calle_o_tramo_aproximado",
      source: "Georef Argentina v2",
    });
  }

  console.log(`Georef acepto ${out.size}/${sourceSpaces.length}`);
  return out;
}

function buildCandidates(space) {
  const address = cleanAddress(space.address);
  const neighborhood = cleanPlace(space.neighborhood);
  const name = cleanName(space.name);
  const sourceType = cleanName(space.source_type);
  const candidates = [];

  if (address) {
    if (neighborhood) candidates.push({ kind: "address", query: `${address}, ${neighborhood}, ${CITY}` });
    candidates.push({ kind: "address", query: `${address}, ${CITY}` });
    if (name && !isGenericName(name)) candidates.push({ kind: "mixed", query: `${name}, ${address}, ${CITY}` });
  }
  if (name && !isGenericName(name)) {
    if (sourceType) candidates.push({ kind: "name", query: `${sourceType} ${name}, ${CITY}` });
    if (neighborhood) candidates.push({ kind: "name", query: `${name}, ${neighborhood}, ${CITY}` });
    candidates.push({ kind: "name", query: `${name}, ${CITY}` });
  }

  return uniqueBy(candidates, (candidate) => normalize(candidate.query)).slice(0, 4);
}

function scoreMatch(space, candidate, match) {
  const lat = Number(match.lat);
  const lon = Number(match.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inBounds(lat, lon)) return null;

  const display = match.display_name ?? "";
  const displayTokens = new Set(meaningful(display));
  const queryTokens = meaningful(candidate.query);
  const nameTokens = meaningful(space.name);
  const addressTokens = meaningful(cleanAddress(space.address));
  const queryOverlap = queryTokens.filter((token) => displayTokens.has(token));
  const nameOverlap = nameTokens.filter((token) => displayTokens.has(token));
  const addressOverlap = addressTokens.filter((token) => displayTokens.has(token));
  const queryNumber = candidate.query.match(/\b\d{2,5}\b/)?.[0];
  const numberMatch = !queryNumber || normalize(display).split(" ").includes(queryNumber);
  const isRoad = match.category === "highway";
  const isPlace = match.category === "leisure" || ["park", "garden", "recreation_ground", "square"].includes(match.type);

  let score = 0;
  score += Math.min(queryOverlap.length, 5);
  score += Math.min(addressOverlap.length, 4) * 0.75;
  score += Math.min(nameOverlap.length, 4) * 0.75;
  if (candidate.kind === "address" && isRoad) score += 1.5;
  if (candidate.kind === "name" && isPlace) score += 2.5;
  if (queryNumber && numberMatch) score += 2;
  if (queryNumber && !numberMatch) score -= 1.5;
  if (/san miguel de tucum/i.test(display)) score += 1;

  let confidence = "baja";
  let reason = "coincidencia_aproximada";
  if ((isPlace && nameOverlap.length >= 1) || (queryNumber && numberMatch && addressOverlap.length >= 1)) {
    confidence = "alta";
    reason = isPlace ? "nombre_del_espacio" : "direccion_con_altura";
  } else if ((isRoad && addressOverlap.length >= 1) || queryOverlap.length >= 2) {
    confidence = "media";
    reason = isRoad ? "calle_o_tramo_aproximado" : "coincidencia_textual";
  }

  if (score < 3.5) confidence = "baja";
  return { lat, lon, display_name: display, query: candidate.query, score, confidence, reason, source: "OpenStreetMap Nominatim" };
}

function cleanAddress(value) {
  return cleanPlace(value)
    .replace(/\bP\.?\s*U\.?.*$/i, "")
    .replace(/\bCOOPERATIVA.*$/i, "")
    .replace(/\bVER\s+MAPA\b.*$/i, "")
    .replace(/\bSECCIONES?\b.*$/i, "")
    .replace(/\bTRAMO\s*\d?.*$/i, "")
    .replace(/\bPU\s*:?.*$/i, "")
    .replace(/\bB\*|\bBÂ°/gi, "Barrio ")
    .replace(/\bAV\.?/gi, "Avenida ")
    .replace(/\bPJE\.?/gi, "Pasaje ")
    .replace(/\bGRAL\.?/gi, "General ")
    .replace(/(?<=[A-Za-zÁÉÍÓÚÜÑáéíóúüñ])(?=\d)/g, " ")
    .replace(/(?<=\d)(?=[A-Za-zÁÉÍÓÚÜÑáéíóúüñ])/g, " ")
    .replace(/(\d+)\s*y\s*/gi, "$1 y ")
    .replace(/([a-záéíóúüñ])y\s+([A-ZÁÉÍÓÚÜÑ])/g, "$1 y $2")
    .replace(/([a-záéíóúüñ])entre/gi, "$1 entre")
    .replace(/entre([A-ZÁÉÍÓÚÜÑa-záéíóúüñ])/g, "entre $1")
    .replace(/desde([A-ZÁÉÍÓÚÜÑa-záéíóúüñ])/g, "desde $1")
    .replace(/hasta([A-ZÁÉÍÓÚÜÑa-záéíóúüñ])/g, "hasta $1")
    .replace(/\bdel a\b/gi, "de la")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanPlace(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/Ã¡/g, "á")
    .replace(/Ã©/g, "é")
    .replace(/Ã­/g, "í")
    .replace(/Ã³/g, "ó")
    .replace(/Ãº/g, "ú")
    .replace(/Ã±/g, "ñ")
    .replace(/Â°/g, "°")
    .replace(/[()]/g, " ")
    .replace(/[-/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanName(value) {
  return cleanPlace(value).replace(/\bS\/N\b|\bSin nombre\b/gi, "").replace(/\s+/g, " ").trim();
}

function isGenericName(value) {
  return !value || /^(plaza|plazoleta|espacio verde|platabanda|boulevard|parque)$/i.test(value);
}

function inBounds(lat, lon) {
  return lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat && lon >= BOUNDS.minLon && lon <= BOUNDS.maxLon;
}

function meaningful(value) {
  const stop = new Set(["avenida", "calle", "pasaje", "pje", "entre", "esquina", "desde", "hasta", "norte", "sur", "este", "oeste", "san", "santa", "santo", "del", "de", "la", "las", "los", "y", "miguel", "tucuman", "argentina", "capital", "departamento", "barrio", "plaza", "plazoleta", "espacio", "verde"]);
  return normalize(value).split(" ").filter((token) => token.length >= 3 && !stop.has(token));
}

function normalize(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = splitCsvLine(lines.shift());
  return lines.map((line) => Object.fromEntries(splitCsvLine(line).map((value, index) => [headers[index], value])));
}

function splitCsvLine(line) {
  const out = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      out.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  out.push(value);
  return out;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function writeCsv(file, rowsToWrite) {
  const fields = ["source_key", "name", "source_type", "address", "neighborhood", "section_code", "query", "normalized_address", "latitude", "longitude", "accepted", "confidence", "score", "reason", "geocoding_source"];
  const body = [fields.join(","), ...rowsToWrite.map((row) => fields.map((field) => csv(row[field])).join(","))].join("\n");
  fs.writeFileSync(file, `\uFEFF${body}\n`, "utf8");
}

function writeSql(file, accepted) {
  const sql = [
    "-- Coordenadas aceptadas automaticamente mediante OpenStreetMap Nominatim.",
    "-- Revisar data/geocoding-review-local.csv antes de completar las filas dudosas.",
    "begin;",
    "alter table public.green_spaces add column if not exists normalized_address text;",
    "alter table public.green_spaces add column if not exists geocoding_source text;",
    "alter table public.green_spaces add column if not exists geocoding_confidence text;",
    "alter table public.green_spaces add column if not exists geocoded_at timestamptz;",
    "",
    ...accepted.map((row) => `update public.green_spaces set latitude=${row.latitude}, longitude=${row.longitude}, normalized_address=${quote(row.normalized_address)}, geocoding_source=${quote(row.geocoding_source)}, geocoding_confidence=${quote(row.confidence)}, geocoded_at=now() where source_key=${quote(row.source_key)} and latitude is null;`),
    "",
    "commit;",
    "",
  ].join("\n");
  fs.writeFileSync(file, sql, "utf8");
}

function countBy(items, field) {
  return items.reduce((acc, item) => {
    acc[item[field]] = (acc[item[field]] ?? 0) + 1;
    return acc;
  }, {});
}

function quote(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function csv(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}
