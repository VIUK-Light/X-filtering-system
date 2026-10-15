#!/usr/bin/env python3
"""Evaluate the exported encoder plus a local SafeSearch 4 head on mock HTML cases.

Dataset and head paths are supplied by the caller. This script does not fetch
URLs or send page text to a service. It reads only mock_site rows from the
selected benchmark cohort and reports URL-only rows as skipped.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import time
from pathlib import Path
from typing import Any

import numpy as np
import onnxruntime as ort
from transformers import AutoTokenizer

TOKENIZER_ID = "tuanda2912/hark-multilingual-e5-small-coreml"
TOKENIZER_REVISION = "0a386d4aea14586b042c6e68a83acb6ff8d87970"
MAX_TOKENS = 512
BENCHMARK_TO_MODEL_CATEGORY = {
    "adult_sexual": "adultContent",
    "violence_crime": "violence",
    "gambling": "gambling",
    "dating_solicitation": "dating",
    "drugs_alcohol_tobacco": "alcoholAndTobacco",
    "alcohol_tobacco": "alcoholAndTobacco",
    "hate_harassment": "inappropriateLanguage",
    "malware_phishing": "knownMalware",
    "social_forum": "forums",
    "sexual_health_education": "sexualEducation",
    "games": "games",
    "shopping": "shopping",
    "advertising": "advertising",
    "tracking": "tracking",
}


def load_jsonl(path: Path) -> tuple[list[dict[str, Any]], int]:
    cases: list[dict[str, Any]] = []
    url_rows_skipped = 0
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        row = json.loads(line)
        if row.get("input_type") == "url":
            url_rows_skipped += 1
            continue
        if row.get("input_type") != "mock_site":
            raise ValueError(f"line {line_number}: unsupported input type {row.get('input_type')!r}")
        if not isinstance(row.get("body"), str) or not row["body"].strip():
            raise ValueError(f"line {line_number}: mock_site body is missing")
        cases.append(row)
    return cases, url_rows_skipped


def sigmoid(value: float) -> float:
    if value >= 0:
        return 1.0 / (1.0 + math.exp(-value))
    exp_value = math.exp(value)
    return exp_value / (1.0 + exp_value)


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * fraction)))
    return ordered[index]


def text_chunks(tokenizer: Any, *, url: str, title: str, body: str) -> list[list[int]]:
    begin = tokenizer.convert_tokens_to_ids("<s>")
    end = tokenizer.convert_tokens_to_ids("</s>")
    if begin is None or end is None:
        raise ValueError("The tokenizer is missing the XLM-RoBERTa boundary tokens.")
    metadata = tokenizer.encode(f"passage: URL: {url}\nTitle: {title}\n", add_special_tokens=False)
    body_tokens = tokenizer.encode(body, add_special_tokens=False)
    max_body = MAX_TOKENS - len(metadata) - 2
    if max_body <= 0:
        return []
    return [
        [begin, *metadata, *body_tokens[start : start + max_body], end]
        for start in range(0, len(body_tokens), max_body)
    ]


def embed(session: ort.InferenceSession, chunks: list[list[int]]) -> tuple[np.ndarray, list[float]]:
    if not chunks:
        raise ValueError("The page has no inspectable body tokens.")
    chunk_embeddings: list[np.ndarray] = []
    timings_ms: list[float] = []
    for tokens in chunks:
        input_ids = np.asarray([tokens], dtype=np.int32)
        attention_mask = np.ones(input_ids.shape, dtype=np.int32)
        started = time.perf_counter()
        hidden = session.run(
            ["last_hidden_state"],
            {"input_ids": input_ids, "attention_mask": attention_mask},
        )[0][0]
        timings_ms.append((time.perf_counter() - started) * 1000)
        pooled = hidden.mean(axis=0)
        norm = np.linalg.norm(pooled)
        if not np.isfinite(norm) or norm <= 0:
            raise ValueError("The encoder returned a non-finite or empty embedding.")
        chunk_embeddings.append(pooled / norm)
    return np.mean(np.stack(chunk_embeddings), axis=0), timings_ms


def score_embedding(embedding: np.ndarray, head: dict[str, Any]) -> tuple[list[str], dict[str, float]]:
    scores: dict[str, float] = {}
    for label, weights in head["weights"].items():
        logit = float(head["biases"][label]) + float(np.dot(np.asarray(weights, dtype=np.float64), embedding))
        scores[label] = sigmoid(logit)
    safe_score = scores["safe"]
    margins = head.get("safeMargins", {})
    blocked = [
        label
        for label in head["weights"]
        if label != "safe"
        and scores[label] >= head["thresholds"][label]
        and scores[label] - safe_score >= margins.get(label, 0.0)
    ]
    return sorted(blocked), scores


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--tokenizer", type=Path, required=True, help="Local tokenizer files downloaded at the pinned tokenizer revision")
    parser.add_argument("--head", type=Path, required=True, help="SafeSearch 4 ClassifierHead.json; not copied into this repository")
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--provider", default="CPUExecutionProvider")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--case-results", type=Path)
    args = parser.parse_args()

    head = json.loads(args.head.read_text(encoding="utf-8"))
    if head.get("formatVersion") != 1 or head.get("embeddingDimensions") != 384:
        raise ValueError("Unsupported classifier head version or embedding dimensions.")
    available = ort.get_available_providers()
    if args.provider not in available:
        raise SystemExit(f"Provider {args.provider!r} is unavailable; available={available}")

    cases, url_rows_skipped = load_jsonl(args.dataset)
    tokenizer = AutoTokenizer.from_pretrained(args.tokenizer, use_fast=True, trust_remote_code=False)
    providers = [args.provider]
    if args.provider != "CPUExecutionProvider":
        providers.append("CPUExecutionProvider")
    session = ort.InferenceSession(str(args.model), providers=providers)
    all_labels = set(head["weights"]) - {"safe"}
    records: list[dict[str, Any]] = []
    latencies: list[float] = []
    first_inference_ms: float | None = None
    unsupported_counts: dict[str, int] = {}

    for index, row in enumerate(cases):
        url = f"http://127.0.0.1/{row['case_id']}"
        chunks = text_chunks(tokenizer, url=url, title=row["title"], body=row["body"])
        started_page = time.perf_counter()
        embedding, chunk_timings = embed(session, chunks)
        if first_inference_ms is None and chunk_timings:
            first_inference_ms = chunk_timings[0]
        latencies.append((time.perf_counter() - started_page) * 1000)
        predicted_categories, scores = score_embedding(embedding, head)
        expected_category = BENCHMARK_TO_MODEL_CATEGORY.get(row["category"])
        if row["expected"] == "block" and expected_category not in all_labels:
            unsupported_counts[row["category"]] = unsupported_counts.get(row["category"], 0) + 1

        if predicted_categories:
            decision = "block"
        elif scores["safe"] >= head["thresholds"]["safe"]:
            decision = "allow"
        else:
            decision = "indeterminate"

        records.append({
            "case_id": row["case_id"],
            "cohort": row["cohort"],
            "category": row["category"],
            "expected": row["expected"],
            "expected_model_category": expected_category,
            "decision": decision,
            "predicted_categories": predicted_categories,
            "correct_category_block": row["expected"] == "block" and expected_category in predicted_categories,
            "false_block": row["expected"] == "allow" and decision == "block",
            "chunk_count": len(chunks),
            "latency_ms": latencies[-1],
        })

    scored = [record for record in records if record["decision"] != "indeterminate"]
    expected_blocks = [record for record in scored if record["expected"] == "block"]
    predicted_blocks = [record for record in scored if record["decision"] == "block"]
    correct_category = sum(record["correct_category_block"] for record in records)
    false_blocks = sum(record["false_block"] for record in records)
    summary = {
        "cohort": cases[0]["cohort"] if cases else None,
        "dataset": args.dataset.name,
        "provider_requested": args.provider,
        "providers_in_session": session.get_providers(),
        "mock_html_cases": len(records),
        "url_cases_skipped": url_rows_skipped,
        "supported_categories": sorted(all_labels),
        "unsupported_block_cases": unsupported_counts,
        "indeterminate_cases": sum(record["decision"] == "indeterminate" for record in records),
        "scored_binary_cases": len(scored),
        "binary_accuracy": sum(record["expected"] == record["decision"] for record in scored) / len(scored) if scored else None,
        "block_recall": sum(record["decision"] == "block" for record in expected_blocks) / len(expected_blocks) if expected_blocks else None,
        "block_precision": sum(record["expected"] == "block" for record in predicted_blocks) / len(predicted_blocks) if predicted_blocks else None,
        "safe_control_false_blocks": false_blocks,
        "correct_category_blocks": correct_category,
        "mean_category_coverage": sum(record["correct_category_block"] for record in records if record["expected"] == "block") / sum(record["expected"] == "block" for record in records) if any(record["expected"] == "block" for record in records) else None,
        "first_chunk_inference_ms": first_inference_ms,
        "page_latency_p50_ms": percentile(latencies, 0.5),
        "page_latency_p95_ms": percentile(latencies, 0.95),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    if args.case_results:
        args.case_results.parent.mkdir(parents=True, exist_ok=True)
        with args.case_results.open("w", encoding="utf-8") as output:
            for record in records:
                output.write(json.dumps(record, ensure_ascii=False) + "\n")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
