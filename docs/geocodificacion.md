# Geocodificación del padrón importado

El proceso consulta primero la API oficial Georef Argentina en lote. Para filas sin coordenadas utiliza Nominatim en serie, con una consulta por segundo, identificación de la aplicación y caché local.

## Criterio automático

Una coordenada sólo se incluye en el SQL cuando:

- está dentro del área amplia de San Miguel de Tucumán;
- comparte términos relevantes con la dirección consultada;
- si la dirección tiene altura, el resultado conserva exactamente esa altura;
- no corresponde a una referencia interna sin dirección, como `PU` o `sección`.

## Archivos

- `data/geocoding-results.csv`: resultado de las 218 filas.
- `data/geocoding-review.csv`: filas que requieren ubicación manual.
- `supabase/geocoding-update.sql`: actualizaciones automáticas aceptadas.
- `tmp/geocoding/nominatim-cache.json`: caché para no repetir consultas.

## Aplicación

Ejecutar `supabase/geocoding-update.sql` en el SQL Editor de Supabase. El script agrega metadatos de fuente y fecha, y sólo actualiza filas cuya latitud sigue vacía.

Las coordenadas rechazadas no deben cargarse automáticamente. En particular, un resultado que identifica una calle pero ignora la altura puede ubicar varios espacios distintos en el mismo punto.
