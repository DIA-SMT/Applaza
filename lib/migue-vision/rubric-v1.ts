import type { Rubric } from "./contracts.ts";

// Rúbrica v1 de estado de espacios verdes. Para cambiarla se crea una versión nueva (v2): los
// análisis guardan la versión con la que se hicieron y no se recalculan en silencio.
// Los umbrales son una propuesta inicial: se ajustan con el set de evaluación etiquetado.
export const RUBRIC_V1: Rubric = {
  version: "espacios-verdes-v1",
  name: "Estado general de espacios verdes",
  thresholds: { critical: 40, attention: 70 },
  minEvaluatedDimensions: 2,
  minConfidence: 0.5,
  dimensions: [
    {
      key: "cesped_vegetacion",
      label: "Césped y vegetación",
      weight: 3,
      guidance: "Altura y uniformidad del césped, malezas, zonas peladas o secas, bordes sin perfilar. No confundir césped seco por estación con falta de mantenimiento: si parece estacional, decirlo.",
    },
    {
      key: "arbolado",
      label: "Arbolado",
      weight: 2,
      guidance: "Ramas caídas o quebradas, árboles inclinados, poda pendiente que obstruye paso o luminarias. No diagnosticar enfermedades.",
    },
    {
      key: "limpieza_residuos",
      label: "Limpieza y residuos",
      weight: 3,
      guidance: "Basura dispersa, bolsas, escombros, restos de poda acumulados, microbasurales.",
    },
    {
      key: "senderos_solados",
      label: "Senderos y solados",
      weight: 2,
      guidance: "Roturas, baldosas levantadas, pozos, desniveles, barro o agua estancada en caminos.",
    },
    {
      key: "mobiliario",
      label: "Mobiliario",
      weight: 1,
      guidance: "Bancos, cestos, bebederos: roto, faltante, vandalizado o en buen estado.",
    },
    {
      key: "juegos_infantiles",
      label: "Juegos infantiles",
      weight: 2,
      guidance: "Estado visible de juegos: piezas rotas, oxidadas, faltantes o con riesgo aparente. Solo si hay juegos en la foto.",
    },
    {
      key: "iluminacion",
      label: "Iluminación (estado físico)",
      weight: 1,
      guidance: "Solo daño físico visible en columnas o artefactos. Nunca afirmar si funcionan o no: eso no se ve en una foto diurna.",
    },
    {
      key: "infraestructura",
      label: "Canteros e infraestructura",
      weight: 1,
      guidance: "Cordones, canteros, rejas, cercos, pintura y estructuras en general.",
    },
  ],
};
