# ONNX runtime probe

This is a separate engineering probe, not part of the Edge MVP extension package. It exports the pinned multilingual E5 encoder to one ONNX file, emits an exact token-tensor fixture, checks PyTorch-vs-ONNX CPU output parity, and measures ONNX Runtime CoreML on macOS when the provider is present.

The model file and downloaded Hub cache are not stored in this repository. Keep them in a temporary directory and retain the generated `export-report.json` and provider result JSON only when publishing results.

## Export and probe on macOS

Use a disposable virtual environment and a task-local Hugging Face cache:

```sh
uv venv /private/tmp/x-filtering-model-venv --python 3.12
uv pip install --python /private/tmp/x-filtering-model-venv/bin/python --no-cache -r requirements-model-poc.txt
HF_HOME=/private/tmp/x-filtering-hf-cache /private/tmp/x-filtering-model-venv/bin/python scripts/export_e5_onnx.py --output-dir /private/tmp/x-filtering-model
```

If the installed ONNX Runtime build includes CoreML, run:

```sh
/private/tmp/x-filtering-model-venv/bin/python scripts/run_onnx_provider_probe.py \
  --model /private/tmp/x-filtering-model/multilingual-e5-small.onnx \
  --fixture /private/tmp/x-filtering-model/probe-tensors.json \
  --provider CoreMLExecutionProvider \
  --output /private/tmp/x-filtering-model/coreml-result.json
```

The probe reports the ONNX hash, exact input shape, provider list, first inference latency, warm p50/p95 latency, and numeric stability. It does not claim accuracy; accuracy requires the frozen classifier head and the benchmark's separately licensed cases.

Build and run the browser-only WASM/WebGPU probe with:

```sh
npm run build:model-poc
python3 -m http.server 8765 --directory dist/model-poc
```

Open `http://localhost:8765` in Edge, select the ONNX file and `probe-tensors.json`, then run each provider. The page executes locally and compares the same output tensors with the PyTorch reference stored in the fixture.

Windows WinML is intentionally not run in this checkout. Reuse the same ONNX file and `probe-tensors.json` on a Windows device when available.
