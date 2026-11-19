import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzePhoto } from "../../lib/migue-vision/analyze.ts";
import { getVisionProvider, OpenRouterVisionProvider, TestVisionProvider } from "../../lib/migue-vision/provider.ts";
import { PROMPT_VERSION } from "../../lib/migue-vision/prompt.ts";
import { RUBRIC_V1 } from "../../lib/migue-vision/rubric-v1.ts";
import { goodOutput, INPUT } from "./fixtures.ts";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

/** fetch simulado: la foto y la respuesta de OpenRouter. */
function fakeFetch(completion: () => Response, calls: { url: string; body?: unknown }[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === INPUT.imageUrl) return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
    return completion();
  }) as typeof fetch;
}

const completionWith = (content: string) => () =>
  Response.json({ model: "openai/gpt-4o-mini", choices: [{ message: { content } }], usage: { prompt_tokens: 2100, completion_tokens: 600, cost: 0.00045 } });

describe("getVisionProvider", () => {
  it("usa el modo prueba por defecto, aunque haya clave", () => {
    assert.ok(getVisionProvider({ OPENROUTER_API_KEY: "clave" }) instanceof TestVisionProvider);
    assert.ok(getVisionProvider({}) instanceof TestVisionProvider);
  });
  it("modo real solo con activación explícita y clave", () => {
    assert.ok(getVisionProvider({ OPENROUTER_API_KEY: "clave", MIGUE_VISION_MODE: "real" }) instanceof OpenRouterVisionProvider);
    assert.ok(getVisionProvider({ MIGUE_VISION_MODE: "real" }) instanceof TestVisionProvider);
  });
  it("usa el mismo modelo que el chat salvo que se indique otro", () => {
    assert.equal(getVisionProvider({ OPENROUTER_API_KEY: "k", MIGUE_VISION_MODE: "real", OPENROUTER_MODEL: "openai/gpt-4o-mini" }).model, "openai/gpt-4o-mini");
    assert.equal(getVisionProvider({ OPENROUTER_API_KEY: "k", MIGUE_VISION_MODE: "real", OPENROUTER_MODEL: "a/b", MIGUE_VISION_MODEL: "c/d" }).model, "c/d");
  });
});

describe("analyzePhoto con proveedor de prueba", () => {
  it("devuelve un resultado marcado como prueba y determinístico", async () => {
    const first = await analyzePhoto(INPUT, new TestVisionProvider(), RUBRIC_V1);
    const second = await analyzePhoto(INPUT, new TestVisionProvider(), RUBRIC_V1);
    assert.equal(first.ok, true);
    if (first.ok && second.ok) {
      assert.equal(first.result.mode, "prueba");
      assert.match(first.result.output.scene_summary, /MODO PRUEBA/);
      assert.deepEqual(first.result.output, second.result.output);
      assert.equal(first.result.rubric_version, RUBRIC_V1.version);
    }
  });
});

describe("analyzePhoto con OpenRouter simulado", () => {
  it("envía la foto embebida, pide esquema estricto y sin retención de datos", async () => {
    const calls: { url: string; body?: unknown }[] = [];
    const provider = new OpenRouterVisionProvider({ apiKey: "k", model: "openai/gpt-4o-mini", fetchImpl: fakeFetch(completionWith(JSON.stringify(goodOutput())), calls) });
    const outcome = await analyzePhoto(INPUT, provider, RUBRIC_V1);

    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.result.mode, "real");
      assert.equal(outcome.result.status, "satisfactorio");
      assert.equal(outcome.result.prompt_version, PROMPT_VERSION);
      assert.deepEqual(outcome.result.usage, { input_tokens: 2100, output_tokens: 600, cost_usd: 0.00045 });
    }
    const body = calls[1].body as { provider: unknown; response_format: { type: string; json_schema: { strict: boolean } }; messages: { content: unknown }[] };
    assert.deepEqual(body.provider, { data_collection: "deny", require_parameters: true });
    assert.equal(body.response_format.json_schema.strict, true);
    assert.match(JSON.stringify(body.messages[1].content), /data:image\/jpeg;base64,/);
  });

  it("respuesta fuera de esquema: error reintentable con el texto crudo para auditar", async () => {
    const bad = JSON.stringify({ ...goodOutput(), dimensions: [{ dimension: "piscina", evaluable: true, score: 90, confidence: 1, evidence: "x" }] });
    const provider = new OpenRouterVisionProvider({ apiKey: "k", model: "m", fetchImpl: fakeFetch(completionWith(bad)) });
    const outcome = await analyzePhoto(INPUT, provider, RUBRIC_V1);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.retryable, true);
      assert.equal(outcome.rawContent, bad);
      assert.equal(outcome.call?.usage.cost_usd, 0.00045);
    }
  });

  it("429 y 5xx se reintentan; 400 no", async () => {
    for (const [status, retryable] of [[429, true], [503, true], [400, false]] as const) {
      const provider = new OpenRouterVisionProvider({ apiKey: "k", model: "m", fetchImpl: fakeFetch(() => new Response("x", { status })) });
      const outcome = await analyzePhoto(INPUT, provider, RUBRIC_V1);
      assert.deepEqual(outcome.ok ? null : outcome.retryable, retryable, `HTTP ${status}`);
    }
  });

  it("foto inexistente: error definitivo, sin llamar al modelo", async () => {
    const calls: { url: string }[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      calls.push({ url: String(input) });
      return new Response("no", { status: 404 });
    }) as typeof fetch;
    const outcome = await analyzePhoto(INPUT, new OpenRouterVisionProvider({ apiKey: "k", model: "m", fetchImpl }), RUBRIC_V1);
    assert.deepEqual(outcome.ok ? null : outcome.retryable, false);
    assert.equal(calls.length, 1);
  });
});
