import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const inputPath = resolve("data/green-space-name-corrections.csv");
const outputPath = resolve("supabase/green_space_name_corrections.sql");

const rows = parseCsv(readFileSync(inputPath, "utf8"));
const corrections = rows
  .map((row) => ({
    sourceKey: row.source_key?.trim(),
    currentName: row.current_name?.trim(),
    officialName: row.official_name?.trim(),
    notes: row.notes?.trim(),
  }))
  .filter((row) => row.sourceKey && row.officialName);

const statements = [
  "-- Correcciones validadas de nombres del padron municipal.",
  "-- Generado desde data/green-space-name-corrections.csv.",
  "-- Revisa este archivo antes de ejecutarlo en Supabase.",
  "",
];

if (!corrections.length) {
  statements.push("-- Sin correcciones cargadas.");
} else {
  corrections.forEach((row) => {
    const guard = row.currentName ? ` and name = ${sql(row.currentName)}` : "";
    const note = row.notes ? ` -- ${row.notes.replace(/\r?\n/g, " ")}` : "";
    statements.push(
      `update public.green_spaces set name = ${sql(row.officialName)} where source_key = ${sql(row.sourceKey)}${guard};${note}`,
    );
  });
}

writeFileSync(outputPath, `${statements.join("\n")}\n`);
console.log(`Generated ${corrections.length} corrections in ${outputPath}`);

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
  // Emitir cadenas Unicode (U&'...') para que el SQL sea 100% ASCII y no se
  // rompa si el archivo se abre o pega con la codificación equivocada.
  const unicode = escaped.replace(/\\/g, "\\\\").replace(/[^\x20-\x7e]/g, (char) => `\\${char.codePointAt(0).toString(16).padStart(4, "0")}`);
  return `U&'${unicode}'`;
}
