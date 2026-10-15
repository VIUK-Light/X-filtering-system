#!/usr/bin/env python3
"""Measure the same ONNX model/tensor fixture with one native ORT provider."""

from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import time
from collections import Counter
from pathlib import Path

import numpy as np
import onnxruntime as ort


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * fraction)))
    return ordered[index]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--provider", default="CoreMLExecutionProvider")
    parser.add_argument("--warmup", type=int, default=3)
    parser.add_argument("--repeats", type=int, default=30)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--profile-prefix", type=Path)
    args = parser.parse_args()

    available = ort.get_available_providers()
    if args.provider not in available:
        raise SystemExit(
            f"Provider {args.provider!r} is unavailable. Available: {', '.join(available)}"
        )

    fixture = json.loads(args.fixture.read_text())
    inputs = {
        "input_ids": np.asarray(fixture["input_ids"], dtype=np.int32),
        "attention_mask": np.asarray(fixture["attention_mask"], dtype=np.int32),
    }
    options = ort.SessionOptions()
    options.enable_profiling = True
    if args.profile_prefix:
        args.profile_prefix.parent.mkdir(parents=True, exist_ok=True)
        options.profile_file_prefix = str(args.profile_prefix)
    providers = [args.provider]
    if args.provider != "CPUExecutionProvider":
        providers.append("CPUExecutionProvider")
    session = ort.InferenceSession(
        str(args.model),
        sess_options=options,
        providers=providers,
    )
    started = time.perf_counter()
    first = session.run(["last_hidden_state"], inputs)[0]
    first_latency_ms = (time.perf_counter() - started) * 1000

    for _ in range(max(0, args.warmup - 1)):
        session.run(["last_hidden_state"], inputs)

    timings: list[float] = []
    for _ in range(args.repeats):
        started = time.perf_counter()
        output = session.run(["last_hidden_state"], inputs)[0]
        timings.append((time.perf_counter() - started) * 1000)

    profile_path = Path(session.end_profiling())
    profile_events = json.loads(profile_path.read_text())
    provider_counts = Counter(
        event.get("args", {}).get("provider", "unknown")
        for event in profile_events
        if event.get("cat") == "Node"
    )
    cpu_session = ort.InferenceSession(str(args.model), providers=["CPUExecutionProvider"])
    cpu_output = cpu_session.run(["last_hidden_state"], inputs)[0]
    provider_difference = output - cpu_output
    cosine = float(
        np.dot(output.ravel(), cpu_output.ravel())
        / (np.linalg.norm(output.ravel()) * np.linalg.norm(cpu_output.ravel()))
    )

    result = {
        "provider_requested": args.provider,
        "providers_in_session": session.get_providers(),
        "profile_node_counts_by_provider": dict(provider_counts),
        "model_sha256": sha256(args.model),
        "fixture_model_revision": fixture.get("model_revision"),
        "fixture_input_shape": list(inputs["input_ids"].shape),
        "output_shape": list(output.shape),
        "first_inference_ms": round(first_latency_ms, 4),
        "warmup_runs": args.warmup,
        "measured_runs": args.repeats,
        "p50_ms": round(statistics.median(timings), 4),
        "p95_ms": round(percentile(timings, 0.95), 4),
        "mean_ms": round(statistics.mean(timings), 4),
        "max_absolute_change_from_first": float(np.max(np.abs(first - output))),
        "max_absolute_error_vs_cpu": float(np.max(np.abs(provider_difference))),
        "mean_absolute_error_vs_cpu": float(np.mean(np.abs(provider_difference))),
        "rmse_vs_cpu": float(np.sqrt(np.mean(provider_difference**2))),
        "cosine_similarity_vs_cpu": cosine,
        "available_providers": available,
    }
    rendered = json.dumps(result, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n")
    print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
