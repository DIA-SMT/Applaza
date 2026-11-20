import type { Rubric } from "./contracts.ts";

// Rúbrica v2 (20/11/2026). Cambios respecto de la v1, a partir de revisar 12 fotos reales:
// - Cada aspecto describe cómo se ve cada nivel de puntaje: la v1 daba 70-90 a casi todo y,
//   a la vez, 40 por dos papelitos sueltos.
// - Aclaraciones de campo: pasto cortado sin levantar cuenta como limpieza; arena o tierra en
//   platabandas; aparatos de gimnasia van con juegos; árboles sin hojas en invierno no es falta.
// Las versiones no se editan: un cambio de criterio es una versión nueva.
export const RUBRIC_V2: Rubric = {
  version: "espacios-verdes-v2",
  name: "Estado general de espacios verdes",
  thresholds: { critical: 40, attention: 70 },
  minEvaluatedDimensions: 2,
  minConfidence: 0.5,
  dimensions: [
    {
      key: "cesped_vegetacion",
      label: "Césped y vegetación",
      weight: 3,
      guidance: "Altura, cobertura y uniformidad del césped; malezas; zonas peladas; bordes. En Tucumán el invierno es seco: césped amarillento o pardo de junio a septiembre es estacional (anotalo en season_light_note), pero tierra o arena a la vista donde debería haber césped sí cuenta. Bajo juegos y en zonas de mucho paso es normal algo de desgaste.",
      levels: [
        { from: 90, text: "corto, parejo, cubre todo, bordes prolijos" },
        { from: 70, text: "cortado y cubriendo casi todo; algunas manchas o malezas aisladas" },
        { from: 50, text: "desparejo o alto en partes, manchones pelados, malezas visibles, o tierra/arena a la vista en más o menos un cuarto de la superficie" },
        { from: 30, text: "alto o muy ralo en buena parte: tierra o arena a la vista en la mitad o más de la superficie" },
        { from: 0, text: "abandonado: pastizal o casi sin cobertura" },
      ],
    },
    {
      key: "arbolado",
      label: "Arbolado",
      weight: 2,
      guidance: "Ramas caídas o quebradas, árboles inclinados o con riesgo, poda pendiente que tapa paso o luminarias. Árboles sin hojas en otoño o invierno, o con hojas caídas en el piso, NO es falta de mantenimiento. No diagnostiques enfermedades.",
      levels: [
        { from: 90, text: "sin ramas caídas ni riesgos visibles" },
        { from: 70, text: "alguna rama seca o poda menor pendiente" },
        { from: 50, text: "ramas caídas sin retirar o ramas que obstruyen paso" },
        { from: 30, text: "árbol o rama grande caída, o árbol con riesgo evidente" },
        { from: 0, text: "riesgo inmediato para las personas" },
      ],
    },
    {
      key: "limpieza_residuos",
      label: "Limpieza y residuos",
      weight: 3,
      guidance: "Basura dispersa, bolsas, escombros, restos de poda o de pasto cortado sin levantar (sobre veredas, senderos o césped), arena barrida a medias, microbasurales. Hojas caídas de los árboles no cuentan como basura.",
      levels: [
        { from: 90, text: "limpio, sin residuos a la vista" },
        { from: 70, text: "pocos residuos chicos sueltos: hasta 5 papeles o envases en toda la foto" },
        { from: 50, text: "más de 5 residuos repartidos en varias zonas, o pasto cortado sin levantar sobre veredas, senderos o césped (líneas o manchas de pasto suelto)" },
        { from: 30, text: "acumulaciones, bolsas o restos de poda amontonados" },
        { from: 0, text: "microbasural o escombros" },
      ],
    },
    {
      key: "senderos_solados",
      label: "Senderos y solados",
      weight: 2,
      guidance: "Roturas, baldosas levantadas, pozos, desniveles, pasto o malezas creciendo en las juntas, barro o agua estancada en caminos.",
      levels: [
        { from: 90, text: "sanos y despejados" },
        { from: 70, text: "desgaste o fisuras menores, algo de pasto en juntas" },
        { from: 50, text: "roturas o desniveles puntuales, malezas en juntas en buena parte" },
        { from: 30, text: "roturas que dificultan el paso o pozos" },
        { from: 0, text: "intransitable o peligroso" },
      ],
    },
    {
      key: "mobiliario",
      label: "Mobiliario",
      weight: 1,
      guidance: "Bancos, mesas, cestos, bebederos, bolardos, maceteros: roto, faltante, vandalizado, despintado o en buen estado.",
      levels: [
        { from: 90, text: "completo y en buen estado" },
        { from: 70, text: "pintura gastada o desgaste leve" },
        { from: 50, text: "piezas rotas o faltantes en algún elemento" },
        { from: 30, text: "varios elementos rotos o vandalizados" },
        { from: 0, text: "inutilizable o peligroso" },
      ],
    },
    {
      key: "juegos_infantiles",
      label: "Juegos y aparatos de ejercicio",
      weight: 2,
      guidance: "Juegos infantiles y aparatos de gimnasia al aire libre: piezas rotas, oxidadas, faltantes (asientos, cadenas, peldaños) o con riesgo aparente.",
      levels: [
        { from: 90, text: "completos, firmes y con pintura en buen estado" },
        { from: 70, text: "pintura gastada u óxido superficial" },
        { from: 50, text: "alguna pieza faltante o dañada sin riesgo inmediato" },
        { from: 30, text: "piezas rotas que implican riesgo" },
        { from: 0, text: "juego peligroso, debería clausurarse" },
      ],
    },
    {
      key: "iluminacion",
      label: "Iluminación (estado físico)",
      weight: 1,
      guidance: "Solo daño físico visible en columnas o artefactos que se ven de cerca (columna inclinada, artefacto roto o faltante, cables expuestos). Nunca afirmes si funcionan: no se ve en una foto de día. Una columna a lo lejos no alcanza para evaluar.",
      levels: [
        { from: 90, text: "columnas y artefactos enteros" },
        { from: 70, text: "pintura gastada u óxido" },
        { from: 50, text: "artefacto dañado o faltante" },
        { from: 30, text: "columna inclinada o cables expuestos" },
        { from: 0, text: "riesgo eléctrico o de caída" },
      ],
    },
    {
      key: "infraestructura",
      label: "Canteros e infraestructura",
      weight: 1,
      guidance: "Cordones, canteros, rejas, cercos, carteles, monumentos y estructuras en general. En platabandas: cordones rotos o arena/tierra desbordada sobre la calzada.",
      levels: [
        { from: 90, text: "sano y prolijo" },
        { from: 70, text: "pintura gastada o desgaste leve" },
        { from: 50, text: "roturas puntuales" },
        { from: 30, text: "roturas importantes o estructuras caídas" },
        { from: 0, text: "riesgo para las personas" },
      ],
    },
  ],
};
