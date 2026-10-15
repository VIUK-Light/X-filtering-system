#!/usr/bin/env python3
"""Export the pinned multilingual E5 encoder to a reusable ONNX graph.

The exported model returns last_hidden_state. Page tokenization, chunking,
mean-pooling, normalization, and the SafeSearch 4 classifier head remain
outside the graph so every runtime can share the same implementation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from transformers import AutoModel, AutoTokenizer

MODEL_ID = "intfloat/multilingual-e5-small"
MODEL_REVISION = "8d923955b027282ba975c0a4c825486c9ca4c490"
TOKENIZER_ID = "tuanda2912/hark-multilingual-e5-small-coreml"
TOKENIZER_REVISION = "0a386d4aea14586b042c6e68a83acb6ff8d87970"
MAX_TOKENS = 512
PROBE_TEXT = (
    "passage: URL: https://example.invalid/guide\n"
    "Title: Local classification smoke test\n"
    "Visible page text for verifying the shared ONNX model input."
)


class Encoder(torch.nn.Module):
    def __init__(self, model: torch.nn.Module) -> None:
        super().__init__()
        self.model = model

    def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
        return self.model(
            input_ids=input_ids,
            attention_mask=attention_mask,
            return_dict=False,
        )[0]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    tokenizer = AutoTokenizer.from_pretrained(
        TOKENIZER_ID,
        revision=TOKENIZER_REVISION,
        use_fast=True,
        trust_remote_code=False,
    )
    tokenizer_dir = args.output_dir / "tokenizer"
    tokenizer_dir.mkdir(parents=True, exist_ok=True)
    tokenizer.save_pretrained(tokenizer_dir)
    model = AutoModel.from_pretrained(
        MODEL_ID,
        revision=MODEL_REVISION,
        use_safetensors=True,
        trust_remote_code=False,
    ).eval()

    encoded = tokenizer(
        PROBE_TEXT,
        add_special_tokens=True,
        max_length=MAX_TOKENS,
        truncation=True,
        return_tensors="pt",
    )
    input_ids = encoded["input_ids"].to(dtype=torch.int32)
    attention_mask = encoded["attention_mask"].to(dtype=torch.int32)

    onnx_path = args.output_dir / "multilingual-e5-small.onnx"
    with torch.inference_mode():
        # Capture the framework reference before export. The legacy exporter
        # may alter transient module state while tracing the encoder.
        expected = Encoder(model)(input_ids, attention_mask).cpu().numpy()
        torch.onnx.export(
            Encoder(model),
            (input_ids, attention_mask),
            onnx_path,
            input_names=["input_ids", "attention_mask"],
            output_names=["last_hidden_state"],
            dynamic_axes={
                "input_ids": {0: "batch", 1: "sequence"},
                "attention_mask": {0: "batch", 1: "sequence"},
                "last_hidden_state": {0: "batch", 1: "sequence"},
            },
            opset_version=17,
            do_constant_folding=True,
            dynamo=False,
        )

    graph = onnx.load(str(onnx_path))
    onnx.checker.check_model(graph)
    cpu_session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    inputs = {
        "input_ids": input_ids.cpu().numpy(),
        "attention_mask": attention_mask.cpu().numpy(),
    }
    actual = cpu_session.run(["last_hidden_state"], inputs)[0]
    max_abs_error = float(np.max(np.abs(expected - actual)))

    tensor_fixture = {
        "model_id": MODEL_ID,
        "model_revision": MODEL_REVISION,
        "tokenizer_id": TOKENIZER_ID,
        "tokenizer_revision": TOKENIZER_REVISION,
        "text": PROBE_TEXT,
        "input_ids": inputs["input_ids"].tolist(),
        "attention_mask": inputs["attention_mask"].tolist(),
        "expected_embedding_shape": list(expected.shape),
    }
    fixture_path = args.output_dir / "probe-tensors.json"
    tensor_fixture["expected_last_hidden_state"] = expected.tolist()
    fixture_path.write_text(json.dumps(tensor_fixture, ensure_ascii=False) + "\n")

    difference = expected - actual
    cosine = float(
        np.dot(expected.ravel(), actual.ravel())
        / (np.linalg.norm(expected.ravel()) * np.linalg.norm(actual.ravel()))
    )

    report = {
        "model_id": MODEL_ID,
        "model_revision": MODEL_REVISION,
        "tokenizer_id": TOKENIZER_ID,
        "tokenizer_revision": TOKENIZER_REVISION,
        "onnx_opset": 17,
        "onnx_sha256": sha256(onnx_path),
        "onnx_bytes": onnx_path.stat().st_size,
        "input_shape": list(inputs["input_ids"].shape),
        "output_shape": list(actual.shape),
        "cpu_max_absolute_error_vs_pytorch": max_abs_error,
        "cpu_mean_absolute_error_vs_pytorch": float(np.mean(np.abs(difference))),
        "cpu_rmse_vs_pytorch": float(np.sqrt(np.mean(difference**2))),
        "cpu_cosine_similarity_vs_pytorch": cosine,
        "available_onnxruntime_providers": ort.get_available_providers(),
        "coreml_provider_available": "CoreMLExecutionProvider" in ort.get_available_providers(),
    }
    report_path = args.output_dir / "export-report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
