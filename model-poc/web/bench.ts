import * as ort from "onnxruntime-web/webgpu";

interface TensorFixture {
  model_revision: string;
  input_ids: number[][];
  attention_mask: number[][];
  expected_last_hidden_state?: number[][][];
}

type Provider = "wasm" | "webgpu";

const modelInput = document.getElementById("model-file") as HTMLInputElement;
const fixtureInput = document.getElementById("fixture-file") as HTMLInputElement;
const statusNode = document.getElementById("status") as HTMLDivElement;
const outputNode = document.getElementById("output") as HTMLPreElement;
const wasmButton = document.getElementById("run-wasm") as HTMLButtonElement;
const webgpuButton = document.getElementById("run-webgpu") as HTMLButtonElement;

ort.env.logLevel = "warning";
ort.env.wasm.wasmPaths = new URL("./ort/", document.baseURI).toString();
ort.env.wasm.numThreads = 1;

function flatten3D(values: number[][][]): Float32Array {
  return Float32Array.from(values.flat(2));
}

function compare(actual: Float32Array, expected?: Float32Array) {
  if (!expected || expected.length !== actual.length) return null;
  let maxAbs = 0;
  let sumAbs = 0;
  let sumSquare = 0;
  let dot = 0;
  let actualNorm = 0;
  let expectedNorm = 0;
  for (let i = 0; i < actual.length; i++) {
    const delta = actual[i] - expected[i];
    const absolute = Math.abs(delta);
    maxAbs = Math.max(maxAbs, absolute);
    sumAbs += absolute;
    sumSquare += delta * delta;
    dot += actual[i] * expected[i];
    actualNorm += actual[i] * actual[i];
    expectedNorm += expected[i] * expected[i];
  }
  return {
    maxAbsoluteError: maxAbs,
    meanAbsoluteError: sumAbs / actual.length,
    rootMeanSquareError: Math.sqrt(sumSquare / actual.length),
    cosineSimilarity: dot / Math.sqrt(actualNorm * expectedNorm),
  };
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)));
  return sorted[index];
}

async function readFixture(): Promise<TensorFixture> {
  const file = fixtureInput.files?.[0];
  if (!file) throw new Error("Choose probe-tensors.json first.");
  return JSON.parse(await file.text()) as TensorFixture;
}

async function run(provider: Provider): Promise<void> {
  const modelFile = modelInput.files?.[0];
  if (!modelFile) {
    statusNode.textContent = "Choose the ONNX model file first.";
    return;
  }

  const buttons = [wasmButton, webgpuButton];
  buttons.forEach((button) => { button.disabled = true; });
  statusNode.textContent = `Loading ONNX model for ${provider}…`;
  outputNode.textContent = "";
  const startedCreate = performance.now();

  try {
    const fixture = await readFixture();
    const modelBytes = await modelFile.arrayBuffer();
    const session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: [provider],
      graphOptimizationLevel: "all",
    });
    const sessionCreateMs = performance.now() - startedCreate;
    const sequenceLength = fixture.input_ids[0]?.length ?? 0;
    if (sequenceLength === 0 || fixture.attention_mask[0]?.length !== sequenceLength) {
      throw new Error("The fixture tensors are empty or do not match in length.");
    }
    const feeds = {
      input_ids: new ort.Tensor("int32", Int32Array.from(fixture.input_ids[0]), [1, sequenceLength]),
      attention_mask: new ort.Tensor("int32", Int32Array.from(fixture.attention_mask[0]), [1, sequenceLength]),
    };
    const firstStart = performance.now();
    const first = await session.run(feeds);
    const firstInferenceMs = performance.now() - firstStart;
    const outputName = session.outputNames[0];
    const firstData = first[outputName].data as Float32Array;

    for (let i = 0; i < 2; i++) await session.run(feeds);
    const timings: number[] = [];
    let latest = firstData;
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      const result = await session.run(feeds);
      timings.push(performance.now() - start);
      latest = result[outputName].data as Float32Array;
    }

    const expected = fixture.expected_last_hidden_state
      ? flatten3D(fixture.expected_last_hidden_state)
      : undefined;
    const result = {
      providerRequested: provider,
      modelFile: modelFile.name,
      modelBytes: modelFile.size,
      fixtureModelRevision: fixture.model_revision,
      fixtureInputShape: [1, sequenceLength],
      outputShape: first[outputName].dims,
      sessionCreateMs,
      firstInferenceMs,
      warmupRuns: 2,
      measuredRuns: timings.length,
      p50Ms: percentile(timings, 0.5),
      p95Ms: percentile(timings, 0.95),
      referenceComparison: compare(latest, expected),
    };
    outputNode.textContent = JSON.stringify(result, null, 2);
    statusNode.textContent = "Probe complete. Results stay in this tab; nothing was uploaded.";
    await session.release();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    statusNode.textContent = `Probe failed: ${message}`;
    console.error(error);
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

wasmButton.addEventListener("click", () => void run("wasm"));
webgpuButton.addEventListener("click", () => void run("webgpu"));
