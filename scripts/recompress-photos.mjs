// Recomprime las evidencias pesadas (> 1 MB) del bucket con la misma medida
// que la app (1600 px, calidad 72) y las reemplaza en el mismo path, asi que
// las URLs guardadas en maintenance_photos siguen funcionando.
//
// Requiere la copia hecha con `npm run photos:report -- --backup`: la fuente
// de cada foto es esa copia, y antes de reemplazar se verifica que la foto en
// Supabase siga siendo identica a la copia.
//
//   node scripts/recompress-photos.mjs                  -> prueba: comprime en tmp/photo-recompressed/ y no toca Supabase
//   node scripts/recompress-photos.mjs --apply --limit 5 -> reemplaza las primeras 5
//   node scripts/recompress-photos.mjs --apply           -> reemplaza todas las pendientes
//   node scripts/recompress-photos.mjs --restore         -> vuelve a subir los originales de todo lo reemplazado
//
// Necesita SUPABASE_SERVICE_ROLE_KEY en .env.local. Cada reemplazo queda
// anotado en tmp/photo-recompress-log.json, que es lo que usa --restore.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import sharp from "sharp";

const BUCKET = "maintenance-photos";
const MIN_BYTES = 1024 * 1024;
const MAX_EDGE = 1600;
const QUALITY = 72;
// Si la version nueva no ahorra al menos esto, no vale la pena reemplazar.
const MIN_SAVING = 0.3;
const REPORT = "tmp/photo-storage-report.json";
const OUTPUT = "tmp/photo-recompressed";
const LOG = "tmp/photo-recompress-log.json";

const env = { ...loadEnvFile(".env.local"), ...process.env };
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const restore = args.includes("--restore");
const limitIndex = args.indexOf("--limit");
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : Infinity;

if (!SUPABASE_URL || !SERVICE_KEY) fail("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
if (!existsSync(REPORT)) fail(`No existe ${REPORT}: corré primero npm run photos:report -- --backup`);

const backupDir = latestBackupDir();
const log = existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf8")) : [];
const done = new Set(log.filter((entry) => entry.status === "replaced").map((entry) => entry.path));

if (restore) {
  await restoreAll();
} else {
  await recompressAll();
}

async function recompressAll() {
  const report = JSON.parse(readFileSync(REPORT, "utf8"));
  const targets = report.files.filter((file) => file.size > MIN_BYTES && !done.has(file.path));
  console.log(`Copia de respaldo: ${backupDir}`);
  console.log(`${targets.length} fotos de más de 1 MB pendientes${done.size ? ` (${done.size} ya reemplazadas)` : ""}.`);
  console.log(apply ? `Modo REEMPLAZO${Number.isFinite(limit) ? `, hasta ${limit} fotos` : ""}.\n` : "Modo PRUEBA: no se modifica nada en Supabase.\n");

  let before = 0;
  let after = 0;
  let replaced = 0;
  const skipped = [];

  for (const file of targets) {
    if (apply && replaced >= limit) break;
    const backupPath = join(backupDir, ...file.path.split("/"));
    if (!existsSync(backupPath)) { skipped.push({ path: file.path, reason: "no está en la copia" }); continue; }
    const original = readFileSync(backupPath);
    if (original.length !== file.size) { skipped.push({ path: file.path, reason: "la copia no coincide con el informe" }); continue; }

    const compressed = await compress(original);
    const check = await sharp(compressed).metadata();
    const saving = 1 - compressed.length / original.length;
    if (saving < MIN_SAVING) { skipped.push({ path: file.path, reason: `solo ahorra ${Math.round(saving * 100)}%` }); continue; }

    const outPath = join(OUTPUT, ...file.path.split("/"));
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, compressed);
    before += original.length;
    after += compressed.length;

    const line = `${formatBytes(original.length).padStart(8)} -> ${formatBytes(compressed.length).padStart(7)}  ${check.width}x${check.height}  ${file.path}`;
    if (!apply) { console.log(`  ${line}`); continue; }

    // La foto en Supabase tiene que seguir siendo la misma que la copia.
    const live = await download(file.path);
    if (sha256(live) !== sha256(original)) {
      skipped.push({ path: file.path, reason: "cambió en Supabase desde la copia" });
      continue;
    }
    await upload(file.path, compressed);
    const uploaded = await download(file.path);
    const ok = sha256(uploaded) === sha256(compressed);
    log.push({
      path: file.path,
      status: ok ? "replaced" : "verify-failed",
      originalBytes: original.length,
      newBytes: compressed.length,
      originalSha256: sha256(original),
      newSha256: sha256(compressed),
      at: new Date().toISOString(),
    });
    writeFileSync(LOG, JSON.stringify(log, null, 2));
    if (!ok) fail(`La verificación de ${file.path} falló después de subirla. Se detiene todo; revisá ${LOG}.`);
    replaced += 1;
    console.log(`  ✓ ${line}`);
  }

  console.log(`\n${apply ? "Reemplazadas" : "Se reemplazarían"}: ${apply ? replaced : targets.length - skipped.length} fotos, ${formatBytes(before)} -> ${formatBytes(after)} (se liberan ${formatBytes(before - after)}).`);
  if (!apply) console.log(`Las versiones nuevas quedaron en ${OUTPUT}/ para revisarlas.`);
  if (skipped.length) {
    console.log(`\nSalteadas: ${skipped.length}`);
    for (const item of skipped) console.log(`  ${item.reason}: ${item.path}`);
  }
}

async function restoreAll() {
  const toRestore = log.filter((entry) => entry.status !== "restored");
  console.log(`Restaurando ${toRestore.length} originales desde ${backupDir}...`);
  for (const entry of toRestore) {
    const original = readFileSync(join(backupDir, ...entry.path.split("/")));
    if (sha256(original) !== entry.originalSha256) fail(`La copia de ${entry.path} no coincide con el original anotado.`);
    await upload(entry.path, original);
    if (sha256(await download(entry.path)) !== entry.originalSha256) fail(`No se pudo verificar la restauración de ${entry.path}.`);
    entry.status = "restored";
    entry.restoredAt = new Date().toISOString();
    writeFileSync(LOG, JSON.stringify(log, null, 2));
    console.log(`  ✓ ${entry.path}`);
  }
  console.log("Listo.");
}

function compress(buffer) {
  return sharp(buffer)
    .rotate() // aplica la orientacion EXIF a los pixeles
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    // Conserva el EXIF (fecha y lugar de la toma) con la orientacion ya aplicada.
    .withMetadata({ orientation: 1 })
    .jpeg({ quality: QUALITY, mozjpeg: true })
    .toBuffer();
}

async function download(path) {
  // El CDN de Supabase cachea tambien las descargas autenticadas: sin esto la
  // verificacion recibe la version anterior al reemplazo.
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodePath(path)}?nocache=${Date.now()}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Cache-Control": "no-cache" },
  });
  if (!response.ok) fail(`No se pudo descargar ${path}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function upload(path, bytes) {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodePath(path)}`, {
    method: "PUT",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "image/jpeg",
      "Cache-Control": "max-age=3600",
      "x-upsert": "true",
    },
    body: bytes,
  });
  if (!response.ok) fail(`No se pudo subir ${path}: HTTP ${response.status} ${await response.text()}`);
}

function latestBackupDir() {
  const folders = existsSync("tmp")
    ? readdirSync("tmp", { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("photo-backup-"))
      .map((entry) => entry.name)
      .sort()
    : [];
  if (!folders.length) fail("No hay copia en tmp/photo-backup-*: corré primero npm run photos:report -- --backup");
  return join("tmp", folders.at(-1));
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
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

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
