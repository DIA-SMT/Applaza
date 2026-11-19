# Applaza · Migue Intelligence — Fase 0: auditoría y plan

Fecha: 17/11/2026 · Estado: **auditoría terminada, implementación pendiente de aprobación** (ver §7).
Todo lo de este documento se verificó contra el código de `main` (`bb1bc1f`) y contra la base de
producción del VPS con consultas de solo lectura. Nada se modificó.

---

## 1. Diagnóstico de la arquitectura existente

| Capa | Qué hay hoy (verificado) |
|---|---|
| Frontend | Next.js 15 (App Router), React 19, TypeScript. Una sola pantalla autenticada (`app/page.tsx` → `components/dashboard-view.tsx`) con vistas internas: panel, mapa (`operational-map.tsx`), registro de control (`control-register.tsx`), auditoría/informes (`audit-dashboard.tsx`). PWA con service worker y cola offline de fotos (`lib/photo-outbox.ts`). |
| Backend | Supabase propio en el VPS (Postgres 17.6, GoTrue, PostgREST, Storage) desde el 11/11/2026. Lógica de servidor solo en `app/api/chat/route.ts` (Migue) y en el render de `app/page.tsx`. |
| Autenticación | Supabase Auth con contraseña; sin alta abierta. Rol en `public.profiles.role` (enum `user_role`: admin, supervisor, inspector, provider, auditor) leído con `public.current_user_role()`. |
| Permisos (RLS) | 11 tablas con RLS. **Lectura: cualquier usuario autenticado lee todo.** Escrituras limitadas por rol (p. ej. `maintenance_tasks` solo admin/supervisor/inspector; fotos: el que sube). No hay alcance por cooperativa. |
| Almacenamiento | Bucket público `maintenance-photos`. Fotos JPEG ≤1600 px recomprimidas en el navegador (canvas) → **se pierde el EXIF** (fecha real de captura, orientación, cámara). |
| IA existente | Migue = `POST /api/chat`: arma un JSON con los datos del mes y llama a OpenRouter (`OPENROUTER_MODEL`, hoy `openai/gpt-4o-mini`, temperatura 0,2). Sin herramientas tipadas, sin imágenes, sin persistencia. Telemetría opcional al dashboard de DIA (`lib/migue-report.ts`, apagada: no hay `MIGUE_API_KEY`). Fallback a respuestas locales si OpenRouter falla. |
| Infraestructura | VPS compartido (2 vCPU, 7,8 GB RAM, ~3,9 GB libres; 52 GB de disco libres). PM2 por proyecto, nginx, respaldo diario. No hay colas ni workers; Redis del sistema pertenece a otros proyectos. |
| Tests | No hay framework de tests ni tests en el repo. |

### Modelo de datos real (tablas de `public`)

- `green_spaces` (228): nombre, tipo (plaza 147, espacio_verde 41, platabanda 40), dirección, barrio, lat/long (220 ubicados), `path`, superficie, `section_code` (sección de servicio), `status`.
- `maintenance_tasks` (227, una por espacio casi siempre): fechas, `status` (219 "programado"), `fulfilled`, `observations` (**solo 10 con texto real**), `provider_id`.
- `maintenance_photos` (994): `maintenance_task_id`, `image_url`, `photo_type` (**antes/durante/despues = 1er/2do/3er control**, no antes/después de una obra), `uploaded_by`, lat/long, `created_at`.
- `control_records` (**0 filas**): planilla mensual de 3 controles por espacio (sí/no + fecha).
- `maintenance_checks` (**0 filas**), `audit_observations` (**0 filas**), `provider_ratings` (14), `providers` (24), `service_sections` (26), `profiles` (2).

## 2. Qué historial existe realmente y su calidad

| Dato | Medición | Consecuencia para el diseño |
|---|---|---|
| Fotos | 994 (jul–oct 2026), 210 espacios con fotos, 4,7 fotos por espacio en promedio | Hay base para análisis fotográfico. |
| Fotos en días distintos | 178 espacios con ≥2 días, 159 con ≥3, 121 con ≥5 | **La comparación histórica es viable** a nivel espacio + fecha. |
| GPS de la foto vs. ubicación del espacio | Mediana **6,1 km**, p90 11,7 km | El GPS es del teléfono **al subir**, no de la toma. **No sirve** para ubicar sector ni validar presencia. |
| Sector / punto de inspección | No existe en el modelo | Hay que **crearlo** (captura guiada). Hasta entonces, comparar a nivel espacio con aviso de "posible otro sector". |
| Autoría | Todas las fotos las subieron **2 cuentas** (admin y supervisor) | No se puede atribuir a inspectores individuales; filtros por inspector no tienen datos todavía. |
| Fecha de captura | EXIF perdido; `created_at` = momento de carga (o día elegido en "Fecha del control") | La fecha es confiable a nivel día, no la hora de la toma. |
| Texto de inspección | 10 observaciones reales; 0 registros de control | El copiloto no tiene antecedentes escritos: su valor inicial está en las fotos. |
| Clima/estacionalidad | No hay datos | La comparación debe marcar "posible efecto estacional/iluminación" y no puntuar mejora sin evidencia. |

## 3. Arquitectura propuesta (sobre el stack real)

Reutiliza Next.js + Supabase propio + OpenRouter + PM2 del VPS. Sin servicios nuevos.

```
Carga de foto (sin cambios en el flujo actual)
   └─ trigger en la base → inserta trabajo en migue_jobs (idempotente: 1 por foto y versión)
Worker "applaza-migue" (PM2, usuario applaza)
   ├─ toma trabajos con FOR UPDATE SKIP LOCKED, reintentos con espera, tope por minuto y por mes
   ├─ adaptador de proveedor (OpenRouter; modo prueba explícito si falta la clave)
   ├─ respuesta estructurada (JSON Schema) + validación estricta en el servidor
   └─ guarda photo_analyses / photo_comparisons + uso y costo en migue_usage
App (Next.js)
   ├─ API interna autorizada (route handlers con la sesión del usuario y RLS)
   ├─ tarjeta de análisis + revisión humana (confirmar / corregir / rechazar)
   ├─ comparador antes/después (deslizador) e historial por espacio
   └─ Migue con herramientas tipadas (Etapa 3): nunca SQL generado por el modelo
```

Separación pedida (Módulo 7), mapeada: ingesta y validación → `photo-upload` actual + validación en el worker; almacenamiento → Storage actual (las fotos originales nunca se modifican); orquestación → `migue_jobs` + worker; adaptador → `lib/migue-vision/provider`; esquema → `lib/migue-vision/schema`; persistencia → tablas nuevas; comparación → worker + reglas de comparabilidad; API → route handlers; UI → componentes nuevos; auditoría → `migue_usage` + campos de versión en cada resultado.

**Seguridad y privacidad**
- La clave del proveedor solo vive en el servidor/worker (`compartido/.env`), nunca en el frontend.
- La foto viaja al proveedor por URL o base64 desde el worker. Con OpenRouter se puede exigir proveedores **sin retención ni uso para entrenamiento** (`provider.data_collection: "deny"`). Decisión pendiente (§7).
- Rostros y patentes: el prompt prohíbe identificar personas o vehículos; los hallazgos no describen personas. El difuminado automático queda para una etapa posterior si se requiere.
- Inyección de instrucciones: el texto que aparezca en la imagen o en observaciones se trata como dato; la salida se acepta solo si valida contra el esquema y las categorías de la rúbrica.

## 4. Rúbrica v1 (configurable, versionada y auditable)

Dimensiones (cada una 0–100 **solo si hay evidencia**, si no `no_evaluable`): vegetación y césped,
arbolado, limpieza y residuos, senderos y solados, mobiliario (bancos, cestos), juegos infantiles,
iluminación (solo estado físico visible, nunca "funciona"), canteros e infraestructura general.

- Cada hallazgo indica: categoría, observación literal, tipo (`observado` / `posible_problema` / `no_determinable`), severidad (baja/media/alta), confianza, si requiere revisión humana y, si el modelo lo da de forma confiable, una zona aproximada.
- Estado sugerido: `satisfactorio` / `requiere_atencion` / `critico` / `indeterminado`. Se calcula con reglas de la rúbrica a partir de las dimensiones evaluadas (no lo inventa el modelo sin trazabilidad); con menos de 2 dimensiones evaluables o calidad de evidencia insuficiente → `indeterminado`.
- Las dimensiones no visibles no bajan la nota: el promedio es ponderado solo sobre lo evaluado y se informa la cobertura (cuántas dimensiones se pudieron evaluar).
- Cada resultado guarda `rubric_version`, `model`, `prompt_version` y el JSON crudo validado.

## 5. Modelo de datos nuevo (migración **aditiva**, sin tocar tablas existentes)

Etapa 1 — escrita en `supabase/migue_intelligence_v1.sql` (reversión: `..._rollback.sql`), **probada en una
base descartable con la estructura real, sin ejecutar en producción**:

- `migue_rubrics` (versión, definición JSON, activa; una sola activa a la vez).
- `migue_jobs` (trabajo `analizar_foto`, estado, intentos, espera para reintento, error, clave de idempotencia única por foto + rúbrica).
- `photo_analyses` (foto, modo real/prueba, modelo, versión de prompt y rúbrica, estado sugerido, puntaje, cobertura, motivos, JSON validado). Un reanálisis es otra fila: nunca se pisa.
- `photo_analysis_reviews` (revisión humana: confirmado / corregido / rechazado, con valores corregidos, quién y cuándo; sin ediciones ni borrados).
- `migue_usage` (tokens, costo y modelo por llamada, también las fallidas).
- Disparador en `maintenance_photos` que encola cada foto nueva **solo si hay una rúbrica activa** (sin rúbrica activa, instalar la migración no cambia nada).
- Funciones de cola `migue_claim_jobs` (FOR UPDATE SKIP LOCKED), `migue_finish_job` (reintento con espera 4, 16, 64… min) y `migue_enqueue_backfill` (histórico de a tandas), ejecutables solo por el rol de servicio.

Etapas siguientes: `photo_comparisons` (Etapa 2), `inspection_points` (sectores) y `migue_alerts` (Etapa 4).

RLS: lectura para usuarios autenticados (igual que hoy); revisiones solo admin/supervisor/inspector y en nombre propio; costos solo admin/supervisor; trabajos y resultados los escribe solo el worker (rol de servicio).

## 6. Plan por etapas, dependencias y criterios de aceptación

| Etapa | Entrega | Criterio de aceptación |
|---|---|---|
| 1 | Rúbrica v1, migración aditiva, adaptador de proveedor con modo prueba, worker con cola idempotente, análisis por foto, tarjeta en la ficha del espacio, revisión humana, tests | Una foto nueva se analiza sola en < 2 min sin trabar la carga; el resultado valida contra el esquema; el inspector puede confirmar/corregir/rechazar y queda registrado; con fallas del proveedor reintenta sin duplicar; el modo prueba se ve como tal. |
| 2 | Comparación con el control anterior del mismo espacio, comparador con deslizador, historial y línea de tiempo por espacio, análisis del histórico (994 fotos) | No hay puntaje de mejora cuando no es comparable; cada comparación muestra fechas y evidencia; el historial distingue resultados confirmados de automáticos. |
| 3 | Migue con herramientas tipadas (consultas parametrizadas), panel de supervisión, reportes | Toda respuesta cita registros y fechas; sin datos suficientes, lo dice; ninguna consulta usa SQL generado por el modelo. |
| 4 | Alertas, tendencias, puntos de inspección y captura guiada | Sin duplicados; umbrales configurables; alertas automáticas, validadas y descartadas separadas. |

**Costos de inferencia (estimados con precios de OpenRouter del 17/11/2026, a medir en uso real):** una foto ≈ 2.000–3.000 tokens de entrada y ≈ 800 de salida → entre **USD 0,0007** (`anthropic/claude-haiku-5.5`, `google/gemini-2.5-flash-lite`) y **USD 0,003** (`google/gemini-2.5-flash`) por análisis. Con ~250 fotos y ~200 comparaciones por mes: **< USD 3/mes**. Analizar el histórico completo: USD 1–4. Se registrará el costo real de cada llamada.

**Riesgos principales:** calidad del modelo en fotos de campo (mitigar con un set de evaluación etiquetado por personal municipal antes de confiar en los puntajes); falta de sectores (comparaciones "posiblemente otro encuadre"); cuentas compartidas (sin trazabilidad por inspector); privacidad de imágenes enviadas a un proveedor externo; consumo de RAM del worker en el VPS compartido (tope de memoria en PM2).

## 7. Decisiones que requieren aprobación antes de implementar

1. **Enviar las fotos a un proveedor externo de IA** vía OpenRouter, exigiendo proveedores sin retención ni entrenamiento. Alternativa autoalojada: hoy no es viable en el VPS (2 vCPU, sin GPU).
2. **Aplicar la migración aditiva en producción** (solo tablas nuevas, sin tocar datos ni tablas existentes; se prueba antes en una base de prueba y queda con su script de reversión).
3. **Modelo y tope de gasto:** modelo inicial configurable por variable de entorno (propuesta: el más barato que pase la evaluación) y tope mensual (propuesta: USD 10).
4. **Puntos de inspección/sectores y cuentas individuales para inspectores:** cambian el trabajo de campo; sin ellos, el historial no puede filtrar por inspector ni comparar por sector.
