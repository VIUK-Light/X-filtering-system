# SafeSearch 4 model runtime evaluation

## Pinned source and current Core ML artifact

SafeSearch 4 bundles the `intfloat/multilingual-e5-small` encoder at revision `8d923955b027282ba975c0a4c825486c9ca4c490`. Its Core ML conversion is `tuanda2912/hark-multilingual-e5-small-coreml` at revision `0a386d4aea14586b042c6e68a83acb6ff8d87970`. SafeSearch 4's `LocalClassifierPayload/THIRD_PARTY_NOTICES.md` records the model and conversion license metadata as MIT and retains the upstream hashes. The Swift tokenizer dependency is separately licensed Apache-2.0.

The bundled encoder is a Core ML ML Program with mixed Float16/Int8 storage. It accepts Int32 `input_ids` and `attention_mask`, batch size 1, and sequence lengths up to 512; it returns Float32 `last_hidden_state` with 384 hidden dimensions per token. Core ML resources are split into model data and weight parts and assembled into a cached `.mlmodelc` before inference.

## Input preprocessing and classifier head

- Tokenizer: the pinned XLM-RoBERTa tokenizer JSON and SentencePiece model; boundary tokens are `<s>` and `</s>`.
- Text: prefix `passage: `, then the absolute URL and title as `URL: …\nTitle: …\n`, followed by visible page text.
- Length: at most 512 tokens per input. Metadata is repeated for each page-text chunk; each chunk receives beginning and ending tokens.
- Embedding: mean-pool the `last_hidden_state` token vectors, then L2-normalize the resulting 384-dimensional vector.
- Classification: the separate JSON head contains one-vs-rest weights, biases, and thresholds for 13 page categories plus `safe`. A category is emitted only when its calibrated score reaches threshold and clears its calibrated safe-score margin.
- Uncertainty: truncated, media-only, empty, low-confidence, and unavailable-model states are represented separately from a category match. SafeSearch 4's browser displays these as explicit blocked reasons in Kids Mode.

## ONNX parity experiment

The ONNX file must be exported from the pinned upstream E5 weights, not round-tripped from the compiled Core ML package. The existing tokenizer JSON, page prefix/chunking rules, pooling, normalization, classifier head, and threshold decisions remain fixed across runtime candidates.

First freeze raw-text cases and their `input_ids` / `attention_mask` tensors. Run the same ONNX file and tensors through ONNX Runtime Web WASM and WebGPU in Mac Edge, and ONNX Runtime CoreML EP in a native macOS harness. Record model file SHA-256, provider assignment/fallbacks, embedding cosine similarity, maximum absolute tensor error, category/decision agreement, warm and cold latency, p50/p95 latency, peak memory, and package size.

Windows WinML uses the same ONNX file and tensor fixtures when a Windows device is available. Until then, Windows results remain pending; macOS and Edge browser measurements do not stand in for Windows performance.

## Measured results (2026-10-14)

The pinned E5 weights were exported as ONNX opset 17. The artifact SHA-256 is `d4c80ffe9ea4c62217836b8cb2acf1387c404099d070ecbd4c19dcce6f38f752` (470,288,317 bytes). The browser and native probes used the same `[1, 39]` `input_ids` and `attention_mask`, producing `[1, 39, 384]` output tensors.

| Runtime | Session creation | First inference | Warm p50 | Warm p95 | Max absolute error vs reference |
| --- | ---: | ---: | ---: | ---: | ---: |
| Edge ONNX Runtime Web WASM | 7,703.5 ms | 1,636.5 ms | 1,635.0 ms | 1,758.4 ms | 2.09e-6 vs PyTorch |
| Edge ONNX Runtime Web WebGPU | 8,052.7 ms | 1,515.3 ms | 88.0 ms | 92.9 ms | 1.62e-6 vs PyTorch |
| Native ONNX Runtime CPU | — | 11.9 ms | 11.4 ms | 18.9 ms | 0 vs CPU reference |
| Native ONNX Runtime CoreML EP | — | 128.8 ms | 23.4 ms | 30.2 ms | 1.30e-6 vs CPU |

Browser results came from the loaded Mac Edge UI and the local file picker. The page reported that the files stayed in the tab and were not uploaded. Native rows were measured on the same Mac with ONNX Runtime 1.20.1; they are useful directional comparisons, not a cross-device benchmark. Warm browser timings used 10 measured inferences after two warmups; native provider timings used 30 measured inferences after three warmups.

WebGPU substantially improves repeated inference over WASM for this short input, but still takes about 88 ms per warmed call after an approximately 8-second session setup. The ONNX file is about 470 MB. This is too large and too slow to silently include in the small Edge MVP package; a model download, update, storage, and first-use UX would need a separate product decision. The browser probe only measures the encoder and does not establish classification quality.

The CoreML EP session used both `CoreMLExecutionProvider` and `CPUExecutionProvider`, indicating fallback. In this run CoreML was slower than native CPU after warmup (23.4 ms vs 11.4 ms) and much slower on first inference (128.8 ms vs 11.9 ms). The native profile showed work on both providers. This pinned graph and execution path therefore do not support choosing CoreML EP for the initial Edge product.

Using SafeSearch 4's `unknown-v4` mock-HTML cohort and its pinned classifier head, CPU and CoreML produced identical decisions and category outputs across 62 synthetic pages: 62/62 binary decisions matched labels, zero safe-control false blocks, and 29/30 expected block cases received the correct category (96.7%). One page in the `games` category was blocked as `adultContent`. There were no URL rows in this cohort; this small synthetic result is not evidence of real-site accuracy or saved-HTML performance. The benchmark corpus and classifier head stayed outside this repository.

For this MVP, the local TypeScript rule core remains the selected implementation. Revisit the model only after a cohort-separated evaluation on recognized URLs, saved real-site HTML, and unknown HTML, and after a model distribution plan exists. Windows WinML remains unmeasured pending a Windows device.

## References

- [Pinned `intfloat/multilingual-e5-small` revision](https://huggingface.co/intfloat/multilingual-e5-small/tree/8d923955b027282ba975c0a4c825486c9ca4c490) (model card declares MIT).
- [Pinned Core ML conversion and tokenizer files](https://huggingface.co/tuanda2912/hark-multilingual-e5-small-coreml/tree/0a386d4aea14586b042c6e68a83acb6ff8d87970); SafeSearch 4's third-party notice records the conversion license and tokenizer dependency separately.
- [ONNX Runtime Web](https://onnxruntime.ai/docs/get-started/with-javascript/web.html), [CoreML Execution Provider](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html), and [Windows/WinML guidance](https://onnxruntime.ai/docs/get-started/with-windows.html).

## Release handling

Do not bundle the model into the initial rule-based extension. Keep model files and tokenizer dependencies out of the MIT code license unless they are deliberately redistributed with their separate notices. No page text or URL is sent to a remote classification API in this local experiment.
