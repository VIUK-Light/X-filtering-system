# Third-party notices

## SafeSearch 4 multilingual E5 classifier

The SafeSearch 4 repository records the bundled encoder as `intfloat/multilingual-e5-small` at revision `8d923955b027282ba975c0a4c825486c9ca4c490`, with MIT license metadata. Its Core ML conversion and bundled tokenizer files have separate notices in SafeSearch 4's `SafeSearch4/Resources/LocalClassifierPayload/THIRD_PARTY_NOTICES.md`. The model is not bundled in this Edge MVP.

The tokenizer runtime used by the macOS app is Hugging Face `swift-transformers`, Apache-2.0, with its transitive notices retained by SafeSearch 4. Any new tokenizer or ONNX runtime dependency added here must keep its own license notice.

The separate model portability probe uses ONNX Runtime Web 1.30.0 and ONNX Runtime 1.20.1, both MIT-licensed. Its pinned Python tooling also uses ONNX 1.17.0 (Apache-2.0), Transformers 4.46.3 (Apache-2.0), PyTorch 2.5.1 (BSD-3-Clause), and NumPy 1.26.4 (BSD-3-Clause). These packages are development dependencies only and are not included in the Edge extension ZIP. Their upstream license files remain in the package distributions.

## Benchmark material

The provider-neutral benchmark tool is MIT-licensed. Its synthetic text and annotations, selected URL metadata, and third-party-derived data have separate terms. This product repository does not copy benchmark datasets; benchmark results must cite the original data/version and preserve its attribution requirements.
