// Analiza el bucket de evidencias para decidir que fotos conviene recomprimir.
// Solo lee: no modifica ni borra nada en Supabase.
//
//   node scripts/photo-storage-report.mjs            -> informe por consola + tmp/photo-storage-report.json
//   node scripts/photo-storage-report.mjs --backup   -> ademas descarga una copia de todas las fotos
//                                                       a tmp/photo-backup-AAAA-MM-DD/
//
// Usa NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY de .env.local.
// Si existe SUPABASE_SERVICE_ROLE_KEY, tambien cruza con maintenance_photos
// para detectar archivos que ya no usa ninguna evidencia.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const BUCKET = "maintenance-photos";
// Peso esperado de una foto con la compresion actual (1600 px, calidad 0,72).
const TARGET_BYTES = 300 * 1024;
const LIST_PAGE = 1000;

const env = { ...loadEnvFile(".env.local"), ...process.env };
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const API_KEY = SERVICE_KEY || ANON_KEY;

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local");
  process.exit(1);
}

const wantsBackup = process.argv.includes("--backup");

const files = await listAll("");
const totalBytes = sum(files.map((file) => file.size));
const heavy = files.filter((file) => file.size > TARGET_BYTES);
const estimatedAfter = sum(files.map((file) => Math.min(file.size, TARGET_BYTES)));

const buckets = [
  ["< 300 KB", 0, 300 * 1024],
  ["300 KB - 1 MB", 300 * 1024, 1024 ** 2],
  ["1 - 3 MB", 1024 ** 2, 3 * 1024 ** 2],
  ["3 - 8 MB", 3 * 1024 ** 2, 8 * 1024 ** 2],
  ["> 8 MB", 8 * 1024 ** 2, Infinity],
].map(([label, min, max]) => {
  const group = files.filter((file) => file.size >= min && file.size < max);
  return { label, count: group.length, bytes: sum(group.map((file) => file.size)) };
});

const byType = Object.entries(groupBy(files, (file) => file.mimetype))
  .map(([type, group]) => ({ type, count: group.length, bytes: sum(group.map((file) => file.size)) }))
  .sort((a, b) => b.bytes - a.bytes);

const largest = [...files].sort((a, b) => b.size - a.size).slice(0, 20);

let orphans = null;
if (SERVICE_KEY) {
  const referenced = await referencedPaths();
  orphans = files.filter((file) => !referenced.has(file.path));
}

console.log(`\nBucket ${BUCKET}`);
console.log(`  Fotos:           ${files.length}`);
console.log(`  Peso total:      ${formatBytes(totalBytes)}`);
console.log(`  Promedio:        ${formatBytes(files.length ? totalBytes / files.length : 0)}`);
console.log(`\nPor tamaño`);
for (const group of buckets) console.log(`  ${group.label.padEnd(15)} ${String(group.count).padStart(5)} fotos  ${formatBytes(group.bytes).padStart(10)}`);
console.log(`\nPor formato`);
for (const group of byType) console.log(`  ${group.type.padEnd(15)} ${String(group.count).padStart(5)} fotos  ${formatBytes(group.bytes).padStart(10)}`);
console.log(`\nLas 20 más pesadas`);
for (const file of largest) console.log(`  ${formatBytes(file.size).padStart(9)}  ${file.created.slice(0, 10)}  ${file.path}`);
console.log(`\nEstimación si se recomprimen las ${heavy.length} fotos de más de ${formatBytes(TARGET_BYTES)}:`);
console.log(`  ${formatBytes(totalBytes)} -> ~${formatBytes(estimatedAfter)} (se liberarían ~${formatBytes(totalBytes - estimatedAfter)})`);
console.log(`  Es una estimación: el peso real depende de cada foto.`);
if (orphans) {
  console.log(`\nArchivos sin evidencia asociada en maintenance_photos: ${orphans.length} (${formatBytes(sum(orphans.map((file) => file.size)))})`);
} else {
  console.log(`\n(Sin SUPABASE_SERVICE_ROLE_KEY no se buscan archivos huérfanos.)`);
}

mkdirSync("tmp", { recursive: true });
writeFileSync(
  "tmp/photo-storage-report.json",
  JSON.stringify({ generatedAt: new Date().toISOString(), totalBytes, estimatedAfter, buckets, byType, files, orphans: orphans?.map((file) => file.path) ?? null }, null, 2),
);
console.log(`\nDetalle completo en tmp/photo-storage-report.json`);

if (wantsBackup) await backup(files);

async function listAll(prefix) {
  const found = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const entries = await storageRequest(`/storage/v1/object/list/${BUCKET}`, {
      method: "POST",
      body: JSON.stringify({ prefix, limit: LIST_PAGE, offset, sortBy: { column: "name", order: "asc" } }),
    });
    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Las carpetas vienen sin id ni metadata.
      if (!entry.id) found.push(...(await listAll(path)));
      else found.push({ path, size: entry.metadata?.size ?? 0, mimetype: entry.metadata?.mimetype ?? "desconocido", created: entry.created_at ?? "" });
    }
    if (entries.length < LIST_PAGE) return found;
  }
}

async function referencedPaths() {
  const marker = `/${BUCKET}/`;
  const paths = new Set();
  for (let from = 0; ; from += LIST_PAGE) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/maintenance_photos?select=image_url`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Range: `${from}-${from + LIST_PAGE - 1}` },
    });
    if (!response.ok) throw new Error(`maintenance_photos respondió HTTP ${response.status}`);
    const rows = await response.json();
    for (const { image_url: url } of rows) {
      const index = url?.indexOf(marker) ?? -1;
      if (index >= 0) paths.add(decodeURIComponent(url.slice(index + marker.length).split("?")[0]));
    }
    if (rows.length < LIST_PAGE) return paths;
  }
}

async function backup(list) {
  const folder = join("tmp", `photo-backup-${new Date().toISOString().slice(0, 10)}`);
  let downloaded = 0;
  let skipped = 0;
  const failed = [];
  for (const file of list) {
    const target = join(folder, ...file.path.split("/"));
    if (existsSync(target)) { skipped += 1; continue; }
    try {
      const response = await fetch(`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${file.path.split("/").map(encodeURIComponent).join("/")}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== file.size) throw new Error(`se descargaron ${bytes.length} bytes de ${file.size}`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
      downloaded += 1;
      if (downloaded % 50 === 0) console.log(`  ${downloaded + skipped}/${list.length} fotos copiadas...`);
    } catch (error) {
      failed.push({ path: file.path, error: error.message });
    }
  }
  console.log(`\nCopia en ${folder}: ${downloaded} descargadas, ${skipped} ya estaban, ${failed.length} con error.`);
  if (failed.length) {
    writeFileSync(join(folder, "_errores.json"), JSON.stringify(failed, null, 2));
    console.log(`Revisá ${join(folder, "_errores.json")} y volvé a correr --backup para reintentar.`);
    process.exitCode = 1;
  }
}

async function storageRequest(path, init) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: { apikey: API_KEY, Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error(`Storage respondió HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return values;
}

function groupBy(list, key) {
  return list.reduce((groups, item) => ((groups[key(item)] ??= []).push(item), groups), {});
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
