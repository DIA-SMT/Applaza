import type { ModelPhotoOutput, PhotoAnalysisInput } from "../../lib/migue-vision/contracts.ts";
import { RUBRIC_V1 } from "../../lib/migue-vision/rubric-v1.ts";
import { RUBRIC_V2 } from "../../lib/migue-vision/rubric-v2.ts";

/** Respuesta válida del modelo: todas las dimensiones evaluadas en buen estado. */
export function goodOutput(): ModelPhotoOutput {
  return {
    evidence_quality: { level: "buena", issues: [] },
    scene_summary: "Plaza con césped corto y senderos limpios.",
    season_light_note: null,
    dimensions: RUBRIC_V1.dimensions.map((d) => ({
      dimension: d.key,
      visibility: "clara" as const,
      evaluable: true,
      score: 85,
      confidence: 0.8,
      evidence: `Se ve ${d.label.toLowerCase()} en buen estado.`,
    })),
    findings: [],
    recommendations: [],
    privacy: { people_visible: false, plates_visible: false },
  };
}

// Las claves de la v2 son las mismas que las de la v1: las respuestas de prueba sirven para ambas.
export const SAME_KEYS = RUBRIC_V2.dimensions.map((d) => d.key).join() === RUBRIC_V1.dimensions.map((d) => d.key).join();

export const INPUT: PhotoAnalysisInput = {
  photoId: "00000000-0000-4000-8000-000000000001",
  imageUrl: "https://ejemplo.test/foto.jpg",
  spaceType: "plaza",
  controlDate: "2026-10-29",
};
