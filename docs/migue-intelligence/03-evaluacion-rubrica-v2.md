# Migue · Evaluación y ajuste del análisis de fotos (rúbrica v2)

Fecha: 20/11/2026 · Modelo: `openai/gpt-4o-mini` (el mismo del chat) · Herramienta: `scripts/migue-evaluar.ts`

## Cómo se evaluó

- 12 fotos reales de producción, repartidas entre plazas, espacios verdes y platabandas y entre 1er, 2do y 3er control.
- Cada foto se analizó **dos veces** para medir cuánto varía el modelo.
- La evaluación **no escribe en la base**: guarda un JSON aparte.
- Cada resultado se comparó contra una revisión visual de la misma foto. Esa revisión no reemplaza un etiquetado por inspectores (ver "Pendiente").
- Costo de cada corrida completa: USD 0,14 (24 análisis).

Para repetirla (en el VPS, con las variables del worker):

```
node --env-file=/srv/applaza/compartido/.env --env-file=/srv/applaza/compartido/migue.env \
  scripts/migue-evaluar.ts salida.json --fotos <id1,id2,...> 2
```

## Problemas encontrados con la rúbrica v1 / prompt foto-v2

1. **Demasiado generoso**: casi todo entre 70 y 90. Una platabanda con pasto cortado sin levantar recibió 90 en los 8 aspectos. Una platabanda rala con arena recibió 70 en césped.
2. **A veces demasiado duro**: 40 en limpieza por 2 o 3 papeles sueltos.
3. **Evaluaba lo que apenas se ve**: iluminación por una columna al fondo, "juegos al fondo".
4. **Confundía la estación con falta de mantenimiento**: bajó el arbolado por árboles sin hojas en agosto.
5. **Aparatos de gimnasia** sin criterio: no estaban contemplados en la rúbrica.
6. **Personas**: detectó personas en 1 de 3 fotos donde aparecían.

## Cambios (rúbrica `espacios-verdes-v2`, prompt `foto-v4`)

- **Escala descrita por aspecto**: qué se ve en 90, 70, 50, 30 y 0. Incluye cantidades concretas, como "hasta 5 papeles" o "tierra a la vista en un cuarto de la superficie".
- **Visibilidad por aspecto** (`clara` / `parcial` / `no_visible`), con ejemplos. Lo `no_visible` no se puntúa (lo valida el servidor).
- **Nota de estación y luz** (`season_light_note`): árboles sin hojas, césped amarillento de invierno, charcos o sombras. Se muestra en el panel como "No cuenta como falta".
- **Aclaraciones de campo**:
  - pasto cortado sin levantar cuenta en limpieza;
  - la arena desbordada en platabandas cuenta en infraestructura;
  - los aparatos de ejercicio van con los juegos;
  - las hojas caídas no son basura.
- **Regla nueva en el estado**: un aspecto bajo que se ve **solo en parte** suma al promedio y queda en los motivos, pero no cambia el estado por sí solo.
- **Imagen con más detalle**: se envía con `detail: "high"`.

## Resultados

| # | Espacio | v1 / foto-v2 | v2 / foto-v4 | Revisión visual |
|---|---|---|---|---|
| 1 | Eva Perón (plaza) | satisfactorio 84 | satisfactorio 75 | ✅ bien cuidada |
| 2 | Av. Colón (platabanda) | requiere atención 57 | requiere atención 63 | ⚠️ límite: algunos residuos y tierra |
| 3 | Salvador Alberti (plaza) | satisfactorio 83 | satisfactorio 79 | ✅ |
| 4 | Estados Árabes (plaza) | requiere atención 78 | satisfactorio 79 | ✅ desgaste de pintura en juegos (70) |
| 5 | San Miguel Arcángel | satisfactorio 83 | satisfactorio 85 | ✅ |
| 6 | Dr. Ángel Pisarello | satisfactorio 83 | satisfactorio 81 | ✅ césped algo largo (70) |
| 7 | Provincial | requiere atención 74 | requiere atención 73 | ✅ zonas peladas |
| 8 | Pedro Miguel Aráoz (platabanda) | satisfactorio 86 | satisfactorio 85 | ✅ ahora evalúa solo 2 aspectos (la platabanda se ve lejos) |
| 9 | Alfredo Guzmán (platabanda) | satisfactorio 90 | satisfactorio 86 | ❌ no ve el pasto cortado sin levantar |
| 10 | 25 de Mayo (plaza) | satisfactorio 85 | satisfactorio 81 | ✅ |
| 11 | Av. Ejército del Norte (platabanda) | satisfactorio 80 | requiere atención 70 | ✅ rala, con arena |
| 12 | García Hamilton (plaza) | satisfactorio 75 | satisfactorio 79 | ✅ ya no castiga los árboles sin hojas |

- **Coincidencia con la revisión visual**: 9 de 12 con la v1 y **11 de 12** con la v2.
- **Estabilidad**: las dos corridas de cada foto dieron el mismo estado en las 12; el puntaje varió como mucho 6 puntos.
- **Personas**: detectadas en 3 fotos. Sigue sin ver motociclistas a lo lejos (#2). No tiene consecuencias por ahora, porque las fotos no se publican ni se difuminan.

## Límites conocidos

- **Detalles finos**: `gpt-4o-mini` no llega a ver detalles como pasto cortado fino sobre la vereda (#9). Mejorarlo requiere un modelo de visión más fuerte. Se decidió mantener el mismo modelo del chat.
- **Muestra chica**: 12 fotos sirven para corregir criterios, no para medir el acierto con precisión.

## Pendiente

- Usar las revisiones del equipo (Confirmar / Corregir / Rechazar) como set de evaluación etiquetado y volver a medir con 50 a 100 fotos.
- Si con más datos la limpieza sigue fallando en platabandas, probar un modelo de visión más fuerte solo para ese caso, con aprobación.
