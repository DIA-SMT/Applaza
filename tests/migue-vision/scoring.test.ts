import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RUBRIC_V1 } from "../../lib/migue-vision/rubric-v1.ts";
import { deriveStatus } from "../../lib/migue-vision/scoring.ts";
import { goodOutput } from "./fixtures.ts";

describe("deriveStatus", () => {
  it("satisfactorio cuando todo lo evaluado está bien", () => {
    const result = deriveStatus(goodOutput(), RUBRIC_V1);
    assert.equal(result.status, "satisfactorio");
    assert.equal(result.overall_score, 85);
    assert.deepEqual(result.coverage, { evaluated: 8, total: 8 });
  });

  it("indeterminado con evidencia insuficiente, aunque haya puntajes", () => {
    const output = goodOutput();
    output.evidence_quality = { level: "insuficiente", issues: ["borrosa"] };
    const result = deriveStatus(output, RUBRIC_V1);
    assert.equal(result.status, "indeterminado");
    assert.match(result.reasons[0], /borrosa/);
  });

  it("indeterminado si se evalúan menos dimensiones que el mínimo", () => {
    const output = goodOutput();
    output.dimensions = output.dimensions.map((d, i) => (i === 0 ? d : { ...d, evaluable: false, score: null }));
    assert.equal(deriveStatus(output, RUBRIC_V1).status, "indeterminado");
  });

  it("las dimensiones con poca confianza no cuentan", () => {
    const output = goodOutput();
    output.dimensions = output.dimensions.map((d) => ({ ...d, confidence: 0.3 }));
    assert.equal(deriveStatus(output, RUBRIC_V1).status, "indeterminado");
  });

  it("requiere atención si una dimensión cae bajo el umbral de atención", () => {
    const output = goodOutput();
    output.dimensions[0] = { ...output.dimensions[0], score: 60 };
    const result = deriveStatus(output, RUBRIC_V1);
    assert.equal(result.status, "requiere_atencion");
    assert.match(result.reasons[0], /Césped y vegetación: 60\/100/);
  });

  it("crítico si una dimensión cae bajo el umbral crítico", () => {
    const output = goodOutput();
    output.dimensions[2] = { ...output.dimensions[2], score: 20 };
    assert.equal(deriveStatus(output, RUBRIC_V1).status, "critico");
  });

  it("crítico por un hallazgo observado grave; un posible problema no cambia el estado", () => {
    const possible = goodOutput();
    possible.findings = [{ dimension: "arbolado", observation: "Rama que podría estar quebrada", kind: "posible_problema", severity: "alta", confidence: 0.9, requires_review: true, area: null }];
    assert.equal(deriveStatus(possible, RUBRIC_V1).status, "satisfactorio");

    const observed = goodOutput();
    observed.findings = [{ dimension: "arbolado", observation: "Rama grande caída sobre el sendero", kind: "observado", severity: "alta", confidence: 0.9, requires_review: true, area: "centro" }];
    const result = deriveStatus(observed, RUBRIC_V1);
    assert.equal(result.status, "critico");
    assert.ok(result.reasons.some((r) => r.includes("Rama grande caída")));
  });

  it("las dimensiones no evaluables no bajan el promedio", () => {
    const output = goodOutput();
    output.dimensions = output.dimensions.map((d) => (d.dimension === "juegos_infantiles" ? { ...d, evaluable: false, score: null } : d));
    const result = deriveStatus(output, RUBRIC_V1);
    assert.equal(result.overall_score, 85);
    assert.deepEqual(result.coverage, { evaluated: 7, total: 8 });
  });

  it("promedio ponderado por los pesos de la rúbrica", () => {
    const output = goodOutput();
    // césped (peso 3) en 100, resto (pesos 12) en 80 → (300 + 960) / 15 = 84
    output.dimensions = output.dimensions.map((d) => ({ ...d, score: d.dimension === "cesped_vegetacion" ? 100 : 80 }));
    assert.equal(deriveStatus(output, RUBRIC_V1).overall_score, 84);
  });
});

describe("deriveStatus con visibilidad parcial", () => {
  it("un aspecto bajo que se ve solo en parte no cambia el estado, pero queda en los motivos", () => {
    const output = goodOutput();
    output.dimensions[2] = { ...output.dimensions[2], score: 50, visibility: "parcial" };
    const result = deriveStatus(output, RUBRIC_V1);
    assert.equal(result.status, "satisfactorio");
    assert.ok(result.reasons.some((r) => r.includes("se ve solo en parte")));
  });

  it("el mismo puntaje visto con claridad sí pide atención", () => {
    const output = goodOutput();
    output.dimensions[2] = { ...output.dimensions[2], score: 50, visibility: "clara" };
    assert.equal(deriveStatus(output, RUBRIC_V1).status, "requiere_atencion");
  });
});

describe("deriveStatus con pocos aspectos claros", () => {
  it("si casi nada se ve con claridad, un aspecto parcial bajo sí pide atención", () => {
    const output = goodOutput();
    output.dimensions = output.dimensions.map((d, i) => {
      if (i === 0) return { ...d, score: 50, visibility: "parcial" as const };
      if (i === 1) return d;
      if (i === 2) return { ...d, score: 70, visibility: "parcial" as const };
      return { ...d, visibility: "no_visible" as const, evaluable: false, score: null };
    });
    assert.equal(deriveStatus(output, RUBRIC_V1).status, "requiere_atencion");
  });
});
