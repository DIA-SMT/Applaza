import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const inputPath = resolve("data/green-space-field-corrections.csv");
const outputPath = resolve("supabase/green_space_field_corrections.sql");

const rows = parseCsv(readFileSync(inputPath, "utf8"))
  .map((row) => ({ sourceKey: row.source_key?.trim(), address: row.address?.trim(), neighborhood: row.neighborhood?.trim() }))
  .filter((row) => row.sourceKey && (row.address || row.neighborhood));

const statements = [
  "-- Direcciones y barrios oficiales del padron municipal (InformacionPlaza.pdf).",
  "-- Generado desde data/green-space-field-corrections.csv con npm run fields:sql.",
  "-- Revisa este archivo antes de ejecutarlo en Supabase.",
  "",
];

for (const row of rows) {
  const sets = [];
  if (row.address) sets.push(`address = ${sql(row.address)}`);
  if (row.neighborhood) sets.push(`neighborhood = ${sql(row.neighborhood)}`);
  statements.push(`update public.green_spaces set ${sets.join(", ")} where source_key = ${sql(row.sourceKey)};`);
}

writeFileSync(outputPath, `${statements.join("\n")}\n`);
console.log(`Generated ${rows.length} corrections in ${outputPath}`);

function parseCsv(value) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];

    if (quoted) {
      if (char === "\"" && next === "\"") {
        field += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  const [headers = [], ...items] = rows;
  return items
    .filter((item) => item.some((cell) => cell.trim()))
    .map((item) => Object.fromEntries(headers.map((header, index) => [header, item[index] ?? ""])));
}

function sql(value) {
  const escaped = value.replace(/'/g, "''");
  if (/^[\x20-\x7e]*$/.test(escaped)) return `'${escaped}'`;
  // Cadenas Unicode (U&'...') para que el SQL sea 100% ASCII y no se rompa
  // si el archivo se abre o pega con la codificación equivocada.
  const unicode = escaped.replace(/\\/g, "\\\\").replace(/[^\x20-\x7e]/g, (char) => `\\${char.codePointAt(0).toString(16).padStart(4, "0")}`);
  return `U&'${unicode}'`;
}
