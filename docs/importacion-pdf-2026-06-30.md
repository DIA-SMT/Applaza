# Importación del padrón municipal del 30/06/2026

Fuente: `CamScanner 30-6-26 12.33.pdf` (8 páginas escaneadas).

## Resultado

- 26 secciones contractuales.
- 218 espacios detallados.
- Cooperativa, sección, tipo original, nombre, dirección, barrio y superficie conservados.
- Los tipos no contemplados por el MVP (plazoleta, parque, acceso, boulevard, terraplén, rotonda, vera de autopista, etc.) se normalizan a `plaza` o `espacio_verde`, pero también se conservan literalmente en `source_type`.
- No se asignan coordenadas: el documento no contiene latitud ni longitud.

## Ejecución

En Supabase, abrir **SQL Editor** y ejecutar en este orden:

1. `supabase/pdf_import_schema.sql`
2. `supabase/pdf_import_data.sql`

La importación de espacios es idempotente mediante `source_key`: ejecutar nuevamente el segundo archivo actualiza las filas importadas y no las duplica.

## Control de calidad

Los conteos extraídos coinciden con la tabla resumen para las 26 secciones. Se resolvieron por contexto tres inconsistencias de numeración en el escaneo: dos filas del bloque 9 fueron reconocidas como sección 6 y una fila ubicada en el bloque 21 figura como sección 12.

El archivo `data/pdf-green-spaces.csv` conserva página y confianza OCR para revisión humana. Antes de uso contractual conviene cotejar nombres y direcciones con la planilla digital original, ya que la fuente es una fotografía escaneada y algunas tildes o abreviaturas pueden no ser exactas.
