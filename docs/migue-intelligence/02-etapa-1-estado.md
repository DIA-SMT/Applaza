# Migue Intelligence · Etapa 1: qué está hecho y qué falta

Actualizado: 17/11/2026 · Rama `feat/migue-intelligence`.

## Decisiones tomadas (17/11/2026)

- Migración aplicada en producción (respaldo previo `base-20261117-1204.dump`).
- Se usa la **misma cuenta y modelo de OpenRouter que el chat** (`OPENROUTER_MODEL`, hoy `openai/gpt-4o-mini`); el tope de gasto es el que ya tiene esa clave en OpenRouter, así que el worker no agrega otro (`MIGUE_MONTHLY_BUDGET_USD` queda disponible, sin usar).
- Costo real medido: **USD 0,0079 por foto** (gpt-4o-mini cobra caras las imágenes). Analizar las 994 fotos existentes: ~USD 8.

## Hecho y verificado

| Pieza | Dónde | Verificación |
|---|---|---|
| Contratos TypeScript | `lib/migue-vision/contracts.ts` | `tsc` sin errores |
| Rúbrica v1 versionada (8 dimensiones, pesos, umbrales) | `lib/migue-vision/rubric-v1.ts` | tests |
| Validación estricta de la respuesta del modelo | `lib/migue-vision/validate.ts` | tests: dimensiones inventadas o repetidas, puntajes fuera de rango, puntaje sin evidencia, catálogos, textos largos |
| Estado sugerido por reglas trazables | `lib/migue-vision/scoring.ts` | tests: indeterminado por evidencia o cobertura, umbrales, hallazgos observados vs. posibles, promedio ponderado solo sobre lo evaluado |
| Prompt versionado (`foto-v2`) y esquema JSON estricto | `lib/migue-vision/prompt.ts` | test de la llamada |
| Adaptador OpenRouter + proveedor de PRUEBA | `lib/migue-vision/provider.ts` | tests con red simulada: foto embebida, sin retención de datos, reintentos 429/5xx, foto inexistente, modelo del chat |
| Orquestación foto → modelo → validación → estado | `lib/migue-vision/analyze.ts` | tests |
| Migración aditiva + reversión | `supabase/migue_intelligence_v1.sql`, `..._rollback.sql` | `supabase/tests/` en base descartable; **aplicada en producción** |
| Worker de la cola | `scripts/migue-worker.ts` | corrido en el VPS contra producción: 5 fotos reales analizadas con gpt-4o-mini (prompt `foto-v1`) |
| Panel "Análisis de Migue" en el visor de fotos + punto de color en miniaturas + revisión Confirmar / Corregir / Rechazar | `components/migue-photo-analysis.tsx`, `components/space-detail.tsx` | build OK |

Correr los tests: `npm test` (28 tests, sin dependencias nuevas; usa `node:test`).

### Garantías de diseño ya implementadas
- **El modo real exige activación explícita** (`MIGUE_VISION_MODE=real`). Tener la clave de OpenRouter (que ya usa el chat) no alcanza: sin esa variable, todo corre en modo prueba.
- El modo prueba devuelve resultados marcados `mode: "prueba"` y el texto `[MODO PRUEBA]`; nunca se presentan como análisis real.
- El modelo no decide el estado: lo derivan reglas fijas de la rúbrica, con motivos legibles.
- Una dimensión no visible queda "no evaluable" y no baja el puntaje.
- Las fotos originales no se modifican; la foto se descarga y se envía embebida desde el servidor.
- Se pide a OpenRouter solo proveedores sin retención ni entrenamiento (`data_collection: "deny"`).

## Variables de entorno (servidor/worker; nunca `NEXT_PUBLIC_`)

| Variable | Valor | Para qué |
|---|---|---|
| `MIGUE_VISION_MODE` | `prueba` (por defecto) o `real` | Activa el envío de fotos al proveedor |
| `MIGUE_VISION_MODEL` | opcional; si no está, usa `OPENROUTER_MODEL` (el mismo del chat, hoy `openai/gpt-4o-mini`) | Modelo multimodal de OpenRouter |
| `OPENROUTER_API_KEY` | ya existe en el VPS | Clave del proveedor |
| `SUPABASE_SERVICE_ROLE_KEY`, `MIGUE_SUPABASE_URL` | en `/srv/applaza/compartido/migue.env` (solo lo lee el worker, no la web) | El worker escribe resultados y usa la cola |

## En producción (20/11/2026)

- **Rúbrica activa: `espacios-verdes-v2`** con el prompt `foto-v4`. La evaluación está en `03-evaluacion-rubrica-v2.md`. Cada foto nueva se encola sola y se analiza en uno o dos minutos.
- **Worker:** proceso PM2 `applaza-migue` del usuario applaza, con tope de 250 MB. Registro en `/srv/applaza/registros/migue-*.log`. `desplegar.sh` lo reinicia en cada publicación.
- **Prueba de punta a punta:** las 5 fotos analizadas con la v1 se volvieron a analizar con la v2, en unos 6 s y USD 0,008 cada una.

## Falta

1. **Histórico:** `select migue_enqueue_backfill(100)` por tandas, unos USD 0,80 cada 100 fotos (~USD 8 las 994). Requiere decisión.
2. **Set de evaluación:** usar las revisiones del equipo (Confirmar / Corregir / Rechazar) para medir con 50 a 100 fotos y ajustar umbrales.
3. **Etapa 2:** comparación entre controles del mismo espacio e historial.
