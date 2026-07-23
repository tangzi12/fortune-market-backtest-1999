#!/usr/bin/env python3
"""Build an isolated, strictly rolling V2 magnitude backtest.

This builder intentionally writes only below
``outputs/fortune_backtest_web/public/data/v2-magnitude``.  It does not alter
the production V0 payloads.

The full V2.1 ``node_state + typed_event_state`` training matrix has not been
frozen yet.  Consequently this first executable magnitude model is explicitly
registered as a *sequence-proxy fallback*: it uses only information already
known at the beginning of a Li-Chun year (the frozen natal fields, V0 annual
state and the deterministic twelve-month fortune-score path).  Price OHLC is
used only for labels and evaluation.

Every scored year is a genuine expanding-window prediction: its estimators are
fit using rows whose Li-Chun year is strictly earlier.  No same-year or future
K-line is used for feature selection, main-god selection, clipping thresholds
or fitted parameters.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import shutil
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PUBLIC_DATA = PROJECT_ROOT / "public/data"
DEFAULT_OUTPUT = DEFAULT_PUBLIC_DATA / "v2-magnitude"

MODEL_VERSION = "v2-magnitude-sequence-proxy-0.1.0"
FEATURE_VERSION = "v2-magnitude-sequence-proxy-features-0.1.0"
DEFAULT_MIN_TRAIN_YEARS = 5
DEFAULT_MIN_TRAIN_ROWS = 4_000
STEMS = tuple("甲乙丙丁戊己庚辛壬癸")
BRANCHES = tuple("子丑寅卯辰巳午未申酉戌亥")
PREDICTIONS = ("up", "neutral", "down")
STATUS_NAMES = ("强势上涨", "偏涨", "中性震荡", "偏跌", "强势下跌")
MFE_THRESHOLDS = (1.0, 4.0, 9.0)


@dataclass(frozen=True)
class BuildPaths:
    public_data: Path
    stock_dir: Path
    output_dir: Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--public-data", type=Path, default=DEFAULT_PUBLIC_DATA)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--min-train-years", type=int, default=DEFAULT_MIN_TRAIN_YEARS)
    parser.add_argument("--min-train-rows", type=int, default=DEFAULT_MIN_TRAIN_ROWS)
    parser.add_argument(
        "--ridge-alpha",
        type=float,
        default=0.35,
        help="Fixed L2 penalty for the past-only standardized ridge heads.",
    )
    parser.add_argument("--seed", type=int, default=20260723)
    parser.add_argument(
        "--keep-existing-output",
        action="store_true",
        help="Do not clear an existing v2-magnitude directory before writing.",
    )
    return parser.parse_args()


def finite(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def safe_ratio(numerator: float, denominator: float, default: float = 0.0) -> float:
    if not math.isfinite(numerator) or not math.isfinite(denominator) or denominator == 0:
        return default
    return numerator / denominator


def one_hot(
    output: dict[str, float],
    prefix: str,
    value: str | None,
    categories: Iterable[str],
) -> None:
    for category in categories:
        output[f"{prefix}__{category}"] = float(value == category)


def parse_bazi(value: str | None) -> list[str]:
    pillars = str(value or "").split()
    if len(pillars) != 4 or any(len(pillar) < 2 for pillar in pillars):
        return ["", "", "", ""]
    return pillars


def sequence_stats(values: list[float], prefix: str) -> dict[str, float]:
    array = np.asarray(values, dtype=float)
    diffs = np.diff(array)
    signs = np.sign(array)
    sign_changes = int(np.sum((signs[1:] * signs[:-1]) < 0)) if len(array) > 1 else 0
    running_max = np.maximum.accumulate(array)
    running_min = np.minimum.accumulate(array)
    max_fall = float(np.max(running_max - array)) if len(array) else 0.0
    max_rise = float(np.max(array - running_min)) if len(array) else 0.0
    x = np.arange(len(array), dtype=float)
    slope = float(np.polyfit(x, array, 1)[0]) if len(array) > 1 else 0.0
    return {
        f"{prefix}__mean": float(np.mean(array)),
        f"{prefix}__std": float(np.std(array)),
        f"{prefix}__min": float(np.min(array)),
        f"{prefix}__max": float(np.max(array)),
        f"{prefix}__range": float(np.ptp(array)),
        f"{prefix}__first": float(array[0]),
        f"{prefix}__last": float(array[-1]),
        f"{prefix}__slope": slope,
        f"{prefix}__positive_share": float(np.mean(array > 1e-12)),
        f"{prefix}__negative_share": float(np.mean(array < -1e-12)),
        f"{prefix}__sign_changes": float(sign_changes),
        f"{prefix}__max_fall": max_fall,
        f"{prefix}__max_rise": max_rise,
        f"{prefix}__diff_std": float(np.std(diffs)) if len(diffs) else 0.0,
        f"{prefix}__second_half_minus_first": float(
            np.mean(array[len(array) // 2 :]) - np.mean(array[: len(array) // 2])
        ),
    }


def row_features(
    stock: dict[str, Any],
    annual: dict[str, Any],
    months: list[dict[str, Any]],
) -> dict[str, float]:
    year = int(annual["year"])
    listing_year = int(str(stock.get("listing_date") or f"{year}-01-01")[:4])
    first_luck_year = int(str(stock.get("first_luck_start_et") or f"{year}-01-01")[:4])
    annual_calc = annual.get("calculation") or {}
    segments = annual_calc.get("segments") or []
    segment_scores = [finite(segment[2]) for segment in segments if len(segment) >= 3]
    segment_weights = [finite(segment[1]) for segment in segments if len(segment) >= 2]

    ordered_months = sorted(months, key=lambda item: int(item.get("month_index", 0)))
    month_scores = [finite(item.get("total_score")) for item in ordered_months]
    month_components = [
        finite((item.get("calculation") or {}).get("month")) for item in ordered_months
    ]
    month_big_luck = [
        finite((item.get("calculation") or {}).get("big_luck")) for item in ordered_months
    ]
    month_annual = [
        finite((item.get("calculation") or {}).get("annual")) for item in ordered_months
    ]
    if len(month_scores) != 12:
        raise ValueError(
            f"{stock.get('ticker')} {year}: expected 12 deterministic months, "
            f"found {len(month_scores)}"
        )

    features: dict[str, float] = {
        "annual_total_score": finite(annual.get("total_score")),
        "annual_big_luck": finite(annual_calc.get("big_luck")),
        "annual_flow_score": finite(annual_calc.get("annual")),
        "segment_count": float(len(segments)),
        "segment_score_min": min(segment_scores, default=0.0),
        "segment_score_max": max(segment_scores, default=0.0),
        "segment_score_std": float(np.std(segment_scores)) if segment_scores else 0.0,
        "segment_weight_max": max(segment_weights, default=0.0),
        "cycle_age_years": float(max(year - listing_year, 0)),
        "cycle_age_log1p": math.log1p(max(year - listing_year, 0)),
        "official_luck_started": float(year >= first_luck_year),
        "years_from_first_luck": float(year - first_luck_year),
        "luck_direction_forward": float(stock.get("luck_direction") == "顺排"),
    }

    pillar = str(annual.get("pillar") or "")
    year_stem = pillar[0] if len(pillar) >= 1 else ""
    year_branch = pillar[1] if len(pillar) >= 2 else ""
    one_hot(features, "flow_year_stem", year_stem, STEMS)
    one_hot(features, "flow_year_branch", year_branch, BRANCHES)
    one_hot(features, "base_prediction", annual.get("predicted_direction"), PREDICTIONS)
    one_hot(features, "base_status", annual.get("status"), STATUS_NAMES)
    one_hot(features, "main_god", stock.get("main_god"), STEMS)

    auxiliary = set(
        token for token in str(stock.get("auxiliary_gods") or "").replace("，", ",").split(",")
        if token
    )
    for stem in STEMS:
        features[f"auxiliary_god__{stem}"] = float(stem in auxiliary)

    for position, natal_pillar in zip(
        ("natal_year", "natal_month", "natal_day", "natal_hour"),
        parse_bazi(stock.get("bazi")),
        strict=True,
    ):
        one_hot(features, f"{position}_stem", natal_pillar[:1], STEMS)
        one_hot(features, f"{position}_branch", natal_pillar[1:2], BRANCHES)

    for index, value in enumerate(month_scores, start=1):
        features[f"month_total_{index:02d}"] = value
    for index, value in enumerate(month_components, start=1):
        features[f"month_flow_{index:02d}"] = value
    for index, value in enumerate(month_big_luck, start=1):
        features[f"month_big_luck_{index:02d}"] = value
    for index, value in enumerate(month_annual, start=1):
        features[f"month_annual_{index:02d}"] = value

    features.update(sequence_stats(month_scores, "month_total_path"))
    features.update(sequence_stats(month_components, "month_flow_path"))
    features.update(sequence_stats(month_big_luck, "month_big_luck_path"))
    return features


def valid_complete_kline(annual: dict[str, Any]) -> bool:
    kline = annual.get("period_kline")
    if not annual.get("complete") or not isinstance(kline, list) or len(kline) < 9:
        return False
    if not all(math.isfinite(finite(value, math.nan)) for value in kline[:5]):
        return False
    return all(finite(value) > 0 for value in kline[:4])


def load_rows(paths: BuildPaths) -> tuple[pd.DataFrame, list[str], dict[str, Any]]:
    source_index_path = paths.public_data / "index.json"
    source_index = json.loads(source_index_path.read_text(encoding="utf-8"))
    source_hash = hashlib.sha256(source_index_path.read_bytes()).hexdigest()
    stock_metadata = {
        item["ticker"]: item for item in source_index.get("stocks", [])
    }
    records: list[dict[str, Any]] = []
    feature_names: list[str] | None = None

    for ticker in sorted(stock_metadata):
        payload_path = paths.stock_dir / f"{ticker}.json.gz"
        if not payload_path.exists():
            continue
        with gzip.open(payload_path, "rt", encoding="utf-8") as handle:
            payload = json.load(handle)
        stock = payload["stock"]
        months_by_year: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for month in payload.get("monthly", []):
            months_by_year[int(month["year"])].append(month)

        for annual in payload.get("annual", []):
            if not valid_complete_kline(annual):
                continue
            year = int(annual["year"])
            features = row_features(stock, annual, months_by_year[year])
            current_names = sorted(features)
            if feature_names is None:
                feature_names = current_names
            elif current_names != feature_names:
                missing = sorted(set(feature_names) - set(current_names))
                extra = sorted(set(current_names) - set(feature_names))
                raise ValueError(
                    f"Feature schema drift at {ticker} {year}; missing={missing}, extra={extra}"
                )

            kline = annual["period_kline"]
            open_price, high_price, low_price, close_price = map(float, kline[:4])
            mfe = max(high_price / open_price - 1.0, 0.0)
            mae = min(low_price / open_price - 1.0, 0.0)
            terminal_return = close_price / open_price - 1.0
            records.append(
                {
                    "ticker": ticker,
                    "name": stock.get("name"),
                    "sector": stock.get("sector"),
                    "index_membership": stock.get("index_membership"),
                    "theme_membership": stock.get("theme_membership") or [],
                    "security_type": stock.get("security_type"),
                    "listing_date": stock.get("listing_date"),
                    "listing_time_basis": stock.get("listing_time_basis"),
                    "basis_confidence": stock.get("basis_confidence"),
                    "main_god": stock.get("main_god"),
                    "bazi": stock.get("bazi"),
                    "year": year,
                    "period_start": kline[7],
                    "period_end": kline[8],
                    "open": open_price,
                    "high": high_price,
                    "low": low_price,
                    "close": close_price,
                    "mfe": mfe,
                    "mae": mae,
                    "drawdown": -mae,
                    "terminal_return": terminal_return,
                    "actual_up": int(terminal_return > 0),
                    "base_score": finite(annual.get("total_score")),
                    "base_status": annual.get("status"),
                    "base_prediction": annual.get("predicted_direction"),
                    "features": features,
                }
            )

    if not records or feature_names is None:
        raise RuntimeError("No complete annual rows were loaded")

    frame = pd.DataFrame(
        [
            {
                **{key: value for key, value in record.items() if key != "features"},
                **record["features"],
            }
            for record in records
        ]
    ).sort_values(["year", "ticker"], kind="stable", ignore_index=True)
    metadata = {
        "source_index_sha256": source_hash,
        "source_generated_at": source_index.get("generated_at"),
        "source_data_cutoff": source_index.get("data_cutoff"),
        "source_universe": source_index.get("universe"),
        "source_stock_count": source_index.get("stock_count"),
    }
    return frame, feature_names, metadata


def issuer_weights(frame: pd.DataFrame) -> np.ndarray:
    counts = frame.groupby("ticker")["ticker"].transform("size").to_numpy(dtype=float)
    weights = 1.0 / np.maximum(counts, 1.0)
    return weights / np.mean(weights)


def balanced_issuer_weights(frame: pd.DataFrame) -> np.ndarray:
    weights = issuer_weights(frame)
    labels = frame["actual_up"].to_numpy(dtype=int)
    for label in (0, 1):
        mask = labels == label
        if mask.any():
            weights[mask] *= len(labels) / (2.0 * int(mask.sum()))
    return weights / np.mean(weights)


def within_ticker_rank_target(frame: pd.DataFrame) -> np.ndarray:
    ranks = frame.groupby("ticker", sort=False)["mfe"].rank(method="average", pct=True)
    group_size = frame.groupby("ticker", sort=False)["ticker"].transform("size")
    ranks = ranks.where(group_size > 1, 0.5)
    return ranks.to_numpy(dtype=float)


def weighted_ridge_predict(
    x_train: np.ndarray,
    y_train: np.ndarray,
    x_test: np.ndarray,
    sample_weight: np.ndarray,
    alpha: float,
) -> np.ndarray:
    """Fit deterministic weighted ridge heads with a free intercept."""

    targets = np.asarray(y_train, dtype=np.float64)
    one_dimensional = targets.ndim == 1
    if one_dimensional:
        targets = targets[:, None]
    weights = np.asarray(sample_weight, dtype=np.float64)
    weights = weights / np.sum(weights)

    mean_x = np.sum(x_train * weights[:, None], axis=0, dtype=np.float64)
    centered_x = x_train.astype(np.float64, copy=False) - mean_x
    variance_x = np.sum(centered_x * centered_x * weights[:, None], axis=0)
    scale_x = np.sqrt(np.maximum(variance_x, 1e-8))
    scaled_train = centered_x / scale_x
    scaled_test = (x_test.astype(np.float64, copy=False) - mean_x) / scale_x

    mean_y = np.sum(targets * weights[:, None], axis=0)
    centered_y = targets - mean_y
    gram = scaled_train.T @ (scaled_train * weights[:, None])
    gram.flat[:: gram.shape[0] + 1] += alpha
    right_hand_side = scaled_train.T @ (centered_y * weights[:, None])
    coefficients = np.linalg.solve(gram, right_hand_side)
    prediction = scaled_test @ coefficients + mean_y
    return prediction[:, 0] if one_dimensional else prediction


def rolling_backtest(
    frame: pd.DataFrame,
    feature_names: list[str],
    min_train_years: int,
    min_train_rows: int,
    ridge_alpha: float,
    seed: int,
) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
    result = frame.copy()
    for column in (
        "predicted_log_mfe",
        "predicted_mfe",
        "predicted_drawdown",
        "predicted_up_probability",
        "predicted_up",
        "predicted_within_ticker_rank",
        "prediction_fold_year",
        "train_through_year",
        "training_rows",
    ):
        result[column] = np.nan

    years = sorted(int(value) for value in result["year"].unique())
    earliest_test_year = years[0] + min_train_years
    folds: list[dict[str, Any]] = []

    for fold_number, test_year in enumerate(years, start=1):
        if test_year < earliest_test_year:
            continue
        train_mask = result["year"] < test_year
        test_mask = result["year"] == test_year
        train = result.loc[train_mask]
        test = result.loc[test_mask]
        if len(train) < min_train_rows or test.empty:
            continue
        if int(train["year"].max()) >= test_year:
            raise AssertionError("Rolling split leakage: train year is not strictly earlier")

        x_train = train[feature_names].to_numpy(dtype=np.float32)
        x_test = test[feature_names].to_numpy(dtype=np.float32)
        issuer_weight = issuer_weights(train)

        log_mfe = np.log1p(train["mfe"].to_numpy(dtype=float))
        # The cap is recalculated from the past-only training fold.
        log_mfe_cap = float(np.quantile(log_mfe, 0.995))
        log_mfe_train = np.minimum(log_mfe, log_mfe_cap)
        regression_predictions = weighted_ridge_predict(
            x_train=x_train,
            y_train=np.column_stack(
                (
                    log_mfe_train,
                    train["drawdown"].to_numpy(dtype=float),
                    within_ticker_rank_target(train),
                )
            ),
            x_test=x_test,
            sample_weight=issuer_weight,
            alpha=ridge_alpha,
        )
        predicted_log_mfe = np.maximum(regression_predictions[:, 0], 0.0)
        predicted_drawdown = np.clip(regression_predictions[:, 1], 0.0, 1.0)
        predicted_rank = np.clip(regression_predictions[:, 2], 0.0, 1.0)

        predicted_up_probability = np.clip(
            weighted_ridge_predict(
                x_train=x_train,
                y_train=train["actual_up"].to_numpy(dtype=float),
                x_test=x_test,
                sample_weight=issuer_weight,
                alpha=ridge_alpha,
            ),
            0.01,
            0.99,
        )

        result.loc[test_mask, "predicted_log_mfe"] = predicted_log_mfe
        result.loc[test_mask, "predicted_mfe"] = np.expm1(predicted_log_mfe)
        result.loc[test_mask, "predicted_drawdown"] = predicted_drawdown
        result.loc[test_mask, "predicted_up_probability"] = predicted_up_probability
        result.loc[test_mask, "predicted_up"] = (
            predicted_up_probability >= 0.5
        ).astype(int)
        result.loc[test_mask, "predicted_within_ticker_rank"] = predicted_rank
        result.loc[test_mask, "prediction_fold_year"] = test_year
        result.loc[test_mask, "train_through_year"] = int(train["year"].max())
        result.loc[test_mask, "training_rows"] = len(train)

        folds.append(
            {
                "test_year": test_year,
                "train_year_min": int(train["year"].min()),
                "train_year_max": int(train["year"].max()),
                "train_rows": int(len(train)),
                "train_stocks": int(train["ticker"].nunique()),
                "test_rows": int(len(test)),
                "test_stocks": int(test["ticker"].nunique()),
                "past_only_mfe_log_cap": log_mfe_cap,
            }
        )

    scored = result["prediction_fold_year"].notna()
    for _, group in result.loc[scored].groupby("year"):
        indices = group.index
        result.loc[indices, "predicted_year_percentile"] = group[
            "predicted_within_ticker_rank"
        ].rank(method="average", pct=True)
    return result, folds


def metric_float(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return round(result, 8) if math.isfinite(result) else None


def safe_auc(labels: np.ndarray, scores: np.ndarray) -> float | None:
    if len(np.unique(labels)) < 2:
        return None
    order = np.argsort(scores, kind="stable")
    ranks = np.empty(len(scores), dtype=float)
    sorted_scores = scores[order]
    start = 0
    while start < len(scores):
        end = start + 1
        while end < len(scores) and sorted_scores[end] == sorted_scores[start]:
            end += 1
        ranks[order[start:end]] = (start + 1 + end) / 2.0
        start = end
    positives = labels == 1
    positive_count = int(positives.sum())
    negative_count = len(labels) - positive_count
    auc = (
        ranks[positives].sum() - positive_count * (positive_count + 1) / 2
    ) / (positive_count * negative_count)
    return metric_float(auc)


def binary_accuracy(labels: np.ndarray, predictions: np.ndarray) -> float:
    return float(np.mean(labels == predictions))


def binary_balanced_accuracy(labels: np.ndarray, predictions: np.ndarray) -> float:
    recalls = [
        float(np.mean(predictions[labels == label] == label))
        for label in (0, 1)
        if np.any(labels == label)
    ]
    return float(np.mean(recalls)) if recalls else math.nan


def direction_metrics(frame: pd.DataFrame) -> dict[str, Any]:
    labels = frame["actual_up"].to_numpy(dtype=int)
    predictions = frame["predicted_up"].to_numpy(dtype=int)
    probabilities = frame["predicted_up_probability"].to_numpy(dtype=float)
    return {
        "samples": int(len(frame)),
        "actual_up_rate": metric_float(np.mean(labels)),
        "predicted_up_rate": metric_float(np.mean(predictions)),
        "accuracy": metric_float(binary_accuracy(labels, predictions)),
        "balanced_accuracy": metric_float(
            binary_balanced_accuracy(labels, predictions)
        ),
        "roc_auc": safe_auc(labels, probabilities),
        "brier_score": metric_float(np.mean((labels - probabilities) ** 2)),
        "always_up_accuracy": metric_float(np.mean(labels)),
        "always_down_accuracy": metric_float(1.0 - np.mean(labels)),
        "up_recall": metric_float(np.mean(predictions[labels == 1] == 1)),
        "down_recall": metric_float(np.mean(predictions[labels == 0] == 0)),
    }


def base_direction_metrics(frame: pd.DataFrame) -> dict[str, Any]:
    explicit = frame["base_prediction"].isin(["up", "down"])
    explicit_frame = frame.loc[explicit]
    predicted = (explicit_frame["base_prediction"] == "up").to_numpy(dtype=int)
    labels = explicit_frame["actual_up"].to_numpy(dtype=int)
    result = {
        "samples": int(len(frame)),
        "explicit_samples": int(explicit.sum()),
        "neutral_samples": int((~explicit).sum()),
        "direction_coverage": metric_float(explicit.mean()),
        "full_accuracy_neutral_counted_wrong": metric_float(
            np.mean(
                (
                    ((frame["base_prediction"] == "up") & (frame["actual_up"] == 1))
                    | ((frame["base_prediction"] == "down") & (frame["actual_up"] == 0))
                ).to_numpy(dtype=bool)
            )
        ),
    }
    if len(explicit_frame):
        result.update(
            {
                "explicit_accuracy": metric_float(binary_accuracy(labels, predicted)),
                "explicit_balanced_accuracy": metric_float(
                    binary_balanced_accuracy(labels, predicted)
                ),
                "explicit_up_recall": metric_float(np.mean(predicted[labels == 1] == 1)),
                "explicit_down_recall": metric_float(np.mean(predicted[labels == 0] == 0)),
            }
        )
    return result


def spearman(left: pd.Series | np.ndarray, right: pd.Series | np.ndarray) -> float | None:
    left_rank = pd.Series(np.asarray(left, dtype=float)).rank(method="average")
    right_rank = pd.Series(np.asarray(right, dtype=float)).rank(method="average")
    value = left_rank.corr(right_rank)
    return metric_float(value)


def same_ticker_rank_metrics(frame: pd.DataFrame) -> dict[str, Any]:
    correlations: list[float] = []
    concordant = 0
    comparable = 0
    eligible_stocks = 0
    for _, group in frame.groupby("ticker", sort=False):
        if len(group) < 3:
            continue
        correlation = pd.Series(
            group["predicted_within_ticker_rank"].to_numpy(dtype=float)
        ).rank(method="average").corr(
            pd.Series(group["mfe"].to_numpy(dtype=float)).rank(method="average")
        )
        if math.isfinite(float(correlation)):
            correlations.append(float(correlation))
            eligible_stocks += 1
        predicted = group["predicted_within_ticker_rank"].to_numpy(dtype=float)
        actual = group["mfe"].to_numpy(dtype=float)
        for left in range(len(group)):
            delta_actual = actual[left + 1 :] - actual[left]
            delta_predicted = predicted[left + 1 :] - predicted[left]
            valid = (np.abs(delta_actual) > 1e-12) & (np.abs(delta_predicted) > 1e-12)
            comparable += int(valid.sum())
            concordant += int(np.sum((delta_actual[valid] * delta_predicted[valid]) > 0))
    return {
        "eligible_stocks_min_3_oos_years": eligible_stocks,
        "macro_mean_spearman": metric_float(np.mean(correlations))
        if correlations
        else None,
        "macro_median_spearman": metric_float(np.median(correlations))
        if correlations
        else None,
        "pairwise_comparable_pairs": comparable,
        "pairwise_concordance": metric_float(safe_ratio(concordant, comparable, math.nan)),
    }


def ticker_pairwise_concordance(frame: pd.DataFrame) -> float | None:
    if len(frame) < 2:
        return None
    predicted = frame["predicted_within_ticker_rank"].to_numpy(dtype=float)
    actual = frame["mfe"].to_numpy(dtype=float)
    concordant = 0
    comparable = 0
    for left in range(len(frame)):
        delta_actual = actual[left + 1 :] - actual[left]
        delta_predicted = predicted[left + 1 :] - predicted[left]
        valid = (np.abs(delta_actual) > 1e-12) & (np.abs(delta_predicted) > 1e-12)
        comparable += int(valid.sum())
        concordant += int(np.sum((delta_actual[valid] * delta_predicted[valid]) > 0))
    return metric_float(safe_ratio(concordant, comparable, math.nan))


def top_decile_metrics(frame: pd.DataFrame) -> dict[str, Any]:
    yearly_rows: list[dict[str, Any]] = []
    selected_parts: list[pd.DataFrame] = []
    for year, group in frame.groupby("year", sort=True):
        count = max(1, int(math.ceil(len(group) * 0.10)))
        predicted_top = group.nlargest(count, "predicted_within_ticker_rank")
        actual_top_indices = set(group.nlargest(count, "mfe").index)
        capture = sum(index in actual_top_indices for index in predicted_top.index) / count
        selected_parts.append(predicted_top)
        yearly_rows.append(
            {
                "year": int(year),
                "rows": int(len(group)),
                "selected": count,
                "actual_top_decile_capture": metric_float(capture),
                "selected_mean_mfe": metric_float(predicted_top["mfe"].mean()),
                "universe_mean_mfe": metric_float(group["mfe"].mean()),
            }
        )
    selected = pd.concat(selected_parts, ignore_index=True)
    thresholds: dict[str, Any] = {}
    for threshold in MFE_THRESHOLDS:
        base_rate = float(np.mean(frame["mfe"] >= threshold))
        selected_rate = float(np.mean(selected["mfe"] >= threshold))
        total_events = int(np.sum(frame["mfe"] >= threshold))
        selected_events = int(np.sum(selected["mfe"] >= threshold))
        thresholds[f"{int(threshold + 1)}x"] = {
            "threshold_mfe": threshold,
            "events": total_events,
            "base_rate": metric_float(base_rate),
            "top_decile_events": selected_events,
            "top_decile_rate": metric_float(selected_rate),
            "top_decile_lift": metric_float(
                safe_ratio(selected_rate, base_rate, math.nan)
            ),
            "event_recall_in_top_decile": metric_float(
                safe_ratio(selected_events, total_events, math.nan)
            ),
        }
    return {
        "selected_share": 0.10,
        "actual_top_decile_capture_micro": metric_float(
            np.average(
                [item["actual_top_decile_capture"] for item in yearly_rows],
                weights=[item["selected"] for item in yearly_rows],
            )
        ),
        "actual_top_decile_capture_macro_year": metric_float(
            np.mean([item["actual_top_decile_capture"] for item in yearly_rows])
        ),
        "selected_mean_mfe": metric_float(selected["mfe"].mean()),
        "universe_mean_mfe": metric_float(frame["mfe"].mean()),
        "mean_mfe_lift": metric_float(selected["mfe"].mean() / frame["mfe"].mean()),
        "threshold_retrieval": thresholds,
        "by_year": yearly_rows,
    }


def magnitude_metrics(frame: pd.DataFrame) -> dict[str, Any]:
    actual_log_mfe = np.log1p(frame["mfe"].to_numpy(dtype=float))
    predicted_log_mfe = frame["predicted_log_mfe"].to_numpy(dtype=float)
    actual_drawdown = frame["drawdown"].to_numpy(dtype=float)
    predicted_drawdown = frame["predicted_drawdown"].to_numpy(dtype=float)
    return {
        "samples": int(len(frame)),
        "mfe": {
            "mean_actual": metric_float(frame["mfe"].mean()),
            "median_actual": metric_float(frame["mfe"].median()),
            "mean_predicted": metric_float(frame["predicted_mfe"].mean()),
            "median_predicted": metric_float(frame["predicted_mfe"].median()),
            "log_mae": metric_float(np.mean(np.abs(actual_log_mfe - predicted_log_mfe))),
            "log_rmse": metric_float(
                math.sqrt(np.mean((actual_log_mfe - predicted_log_mfe) ** 2))
            ),
            "predicted_vs_actual_spearman": spearman(predicted_log_mfe, actual_log_mfe),
            "base_v0_score_vs_actual_spearman": spearman(
                frame["base_score"], actual_log_mfe
            ),
        },
        "mae_drawdown": {
            "mean_actual": metric_float(np.mean(actual_drawdown)),
            "mean_predicted": metric_float(np.mean(predicted_drawdown)),
            "mae": metric_float(np.mean(np.abs(actual_drawdown - predicted_drawdown))),
            "rmse": metric_float(
                math.sqrt(np.mean((actual_drawdown - predicted_drawdown) ** 2))
            ),
            "predicted_vs_actual_spearman": spearman(
                predicted_drawdown, actual_drawdown
            ),
        },
        "within_ticker_ordering": same_ticker_rank_metrics(frame),
        "top_decile": top_decile_metrics(frame),
    }


def fold_metrics(scored: pd.DataFrame, folds: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    fold_lookup = {int(item["test_year"]): item for item in folds}
    for year, group in scored.groupby("year", sort=True):
        neutral = group[group["base_prediction"] == "neutral"]
        output.append(
            {
                **fold_lookup[int(year)],
                "actual_up_rate": metric_float(group["actual_up"].mean()),
                "direction_accuracy": metric_float(
                    binary_accuracy(
                        group["actual_up"].to_numpy(dtype=int),
                        group["predicted_up"].to_numpy(dtype=int),
                    )
                ),
                "direction_balanced_accuracy": metric_float(
                    binary_balanced_accuracy(
                        group["actual_up"].to_numpy(dtype=int),
                        group["predicted_up"].to_numpy(dtype=int),
                    )
                ),
                "direction_auc": safe_auc(
                    group["actual_up"].to_numpy(dtype=int),
                    group["predicted_up_probability"].to_numpy(dtype=float),
                ),
                "mfe_spearman": spearman(group["predicted_log_mfe"], group["mfe"]),
                "rank_spearman": spearman(
                    group["predicted_within_ticker_rank"], group["mfe"]
                ),
                "neutral_samples": int(len(neutral)),
                "neutral_direction_accuracy": metric_float(
                    binary_accuracy(
                        neutral["actual_up"].to_numpy(dtype=int),
                        neutral["predicted_up"].to_numpy(dtype=int),
                    )
                )
                if len(neutral)
                else None,
            }
        )
    return output


def model_evaluation(
    result: pd.DataFrame, folds: list[dict[str, Any]]
) -> tuple[dict[str, Any], pd.DataFrame]:
    scored = result.loc[result["prediction_fold_year"].notna()].copy()
    if scored.empty:
        raise RuntimeError("No strict rolling out-of-time rows were scored")
    neutral = scored.loc[scored["base_prediction"] == "neutral"].copy()
    evaluation = {
        "scored_year_min": int(scored["year"].min()),
        "scored_year_max": int(scored["year"].max()),
        "scored_rows": int(len(scored)),
        "scored_stocks": int(scored["ticker"].nunique()),
        "direction": direction_metrics(scored),
        "v0_base_same_rows": base_direction_metrics(scored),
        "v0_neutral_resolution": direction_metrics(neutral) if len(neutral) else None,
        "magnitude": magnitude_metrics(scored),
        "folds": fold_metrics(scored, folds),
    }
    evaluation["same_oos_comparison"] = {
        "samples": int(len(scored)),
        "v2_forced_direction": evaluation["direction"],
        "a0_v0_direction": evaluation["v0_base_same_rows"],
        "always_up": {
            "accuracy": metric_float(scored["actual_up"].mean()),
            "balanced_accuracy": 0.5,
        },
        "a0_neutral_rows_resolved_by_v2": evaluation["v0_neutral_resolution"],
    }
    return evaluation, scored


def validation_slice(frame: pd.DataFrame) -> dict[str, Any]:
    if frame.empty:
        return {"samples": 0, "stocks": 0}
    neutral = frame.loc[frame["base_prediction"] == "neutral"]
    return {
        "samples": int(len(frame)),
        "stocks": int(frame["ticker"].nunique()),
        "year_min": int(frame["year"].min()),
        "year_max": int(frame["year"].max()),
        "v2_direction": direction_metrics(frame),
        "a0_v0_direction": base_direction_metrics(frame),
        "always_up_accuracy": metric_float(frame["actual_up"].mean()),
        "neutral_resolution": direction_metrics(neutral) if len(neutral) else None,
        "mfe_predicted_vs_actual_spearman": spearman(
            frame["predicted_log_mfe"], frame["mfe"]
        ),
        "a0_score_vs_mfe_spearman": spearman(frame["base_score"], frame["mfe"]),
        "within_ticker_ordering": same_ticker_rank_metrics(frame),
        "top_decile": {
            key: value
            for key, value in top_decile_metrics(frame).items()
            if key != "by_year"
        },
    }


def magnitude_class(predicted_rank: float) -> str:
    if predicted_rank >= 0.95:
        return "同股高潜力_前5%"
    if predicted_rank >= 0.90:
        return "同股高潜力_前10%"
    if predicted_rank >= 0.75:
        return "同股偏强_前25%"
    if predicted_rank <= 0.25:
        return "同股偏弱_后25%"
    return "同股常态区间"


def write_json(path: Path, payload: Any, pretty: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            payload,
            ensure_ascii=False,
            indent=2 if pretty else None,
            separators=None if pretty else (",", ":"),
            allow_nan=False,
        )
        + "\n",
        encoding="utf-8",
    )


def clean_json_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        return metric_float(value)
    if isinstance(value, np.bool_):
        return bool(value)
    return value


def write_outputs(
    paths: BuildPaths,
    result: pd.DataFrame,
    feature_names: list[str],
    source_metadata: dict[str, Any],
    evaluation: dict[str, Any],
    folds: list[dict[str, Any]],
    elapsed_seconds: float,
) -> dict[str, Any]:
    paths.output_dir.mkdir(parents=True, exist_ok=True)
    stock_output_dir = paths.output_dir / "stocks"
    stock_output_dir.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now(timezone.utc).isoformat()
    scored_mask = result["prediction_fold_year"].notna()
    scored = result.loc[scored_mask]
    source_index = json.loads(
        (paths.public_data / "index.json").read_text(encoding="utf-8")
    )
    schedule_validated_tickers = {
        item["ticker"]
        for item in source_index.get("stocks", [])
        if "S&P 500" in str(item.get("index_membership") or "")
        or "Nasdaq-100" in str(item.get("index_membership") or "")
    }
    schedule_scored = scored.loc[scored["ticker"].isin(schedule_validated_tickers)]
    schedule_available = set(
        result.loc[result["ticker"].isin(schedule_validated_tickers), "ticker"].unique()
    )
    era_definitions = {
        "historical_rolling_diagnostic": (2004, 2018),
        "rolling_development": (2019, 2022),
        "seen_replay": (2023, 2025),
    }
    era_validation = {
        name: {
            "label": name,
            "independent_holdout": False,
            "researcher_exposure": (
                "seen_replay"
                if name == "seen_replay"
                else "rolling_development"
                if name == "rolling_development"
                else "historical_diagnostic"
            ),
            **validation_slice(
                scored.loc[scored["year"].between(start_year, end_year)]
            ),
        }
        for name, (start_year, end_year) in era_definitions.items()
    }

    limitations = [
        "完整V2.1 node_state + typed_event_state训练矩阵尚未冻结；本次是明确标注的V0确定性年/月序列代理，不得称为完整V2。",
        "MFE/MAE由立春年聚合OHLC计算：MFE=High/Open-1，MAE=Low/Open-1；没有日内路径，不能判断低点是否先于高点，也不是事后最低点到最高点倍数。",
        "股票池是2026年当前成分/持仓联合池，存在当前成分与存活者偏差；结果不是历史时点可交易股票池回测。",
        "上市时刻仍含行情起点代理。起盘身份/时刻误差会传导到八字和序列特征。",
        "兼容字段predicted_mfe_q50/predicted_mae_q50当前是log中心/点预测，未用分位数损失校准，页面必须标为点估计而非正式置信区间。",
        "所有指标是历史滚动时间外诊断，不是尚未观察年份的前瞻证明，也不构成投资建议。",
    ]
    coverage = {
        "source_universe_stocks": int(source_index.get("stock_count") or 0),
        "complete_rows": int(len(result)),
        "complete_stocks": int(result["ticker"].nunique()),
        "complete_year_min": int(result["year"].min()),
        "complete_year_max": int(result["year"].max()),
        "strict_oos_rows": int(scored_mask.sum()),
        "strict_oos_stocks": int(scored["ticker"].nunique()),
        "strict_oos_year_min": int(scored["year"].min()),
        "strict_oos_year_max": int(scored["year"].max()),
        "burn_in_rows_not_scored": int((~scored_mask).sum()),
        "feature_count": len(feature_names),
        "fold_count": len(folds),
    }
    validation = {
        "independent_holdout": False,
        "mechanical_past_only_split": True,
        "interpretation": (
            "每个预测折只用更早年份拟合，但研究团队已看过历史区间；"
            "2023–2025明确标为seen_replay，不能称独立holdout。"
        ),
        "time_slices": era_validation,
        "schedule_validated_518": {
            "declared_stocks": len(schedule_validated_tickers),
            "complete_history_available_stocks": len(schedule_available),
            "strict_oos_stocks": int(schedule_scored["ticker"].nunique()),
            "missing_complete_history_tickers": sorted(
                schedule_validated_tickers - schedule_available
            ),
            "schedule_status": (
                "S0/调候/顺逆/起运/运段经v2.1清单复算；本模型仍未使用"
                "未冻结的完整typed/node训练矩阵。"
            ),
            "metrics": validation_slice(schedule_scored),
        },
        "experimental_full_pool_2519": {
            "declared_stocks": int(source_index.get("stock_count") or 0),
            "complete_history_available_stocks": int(result["ticker"].nunique()),
            "strict_oos_stocks": int(scored["ticker"].nunique()),
            "model_status": "experimental_sequence_proxy_fallback",
            "metrics": validation_slice(scored),
        },
    }
    summary = {
        "schema_version": "v2-magnitude-web-1.0.0",
        "generated_at": generated_at,
        "model": {
            "version": MODEL_VERSION,
            "feature_version": FEATURE_VERSION,
            "status": "experimental_sequence_proxy_fallback",
            "full_v2_typed_state_available": False,
            "training_eligible_as_full_v2": False,
        },
        "model_version": MODEL_VERSION,
        "feature_version": FEATURE_VERSION,
        "model_status": "experimental_sequence_proxy_fallback",
        "full_v2_typed_state_available": False,
        "training_eligible_as_full_v2": False,
        "source": source_metadata,
        "coverage": coverage,
        "scope": coverage,
        "validation": validation,
        "overall": evaluation["same_oos_comparison"],
        "neutral": evaluation["v0_neutral_resolution"],
        "magnitude": evaluation["magnitude"],
        "by_year": evaluation["folds"],
        "labels": {
            "anchor": "立春节气年首个可用交易日开盘",
            "horizon": "该立春年截至下一立春前最后一个可用交易日，约12个月",
            "mfe": "max(High/Open - 1, 0)",
            "mae": "min(Low/Open - 1, 0)",
            "terminal_direction": "Close/Open - 1 > 0 为上涨，否则为下跌",
            "within_ticker_rank": "每一训练折只在过去年份内重算同股MFE百分位",
            "flat_prediction_unit": "decimal_return",
            "q50_compatibility_alias": (
                "predicted_*_q50为前端兼容别名；当前是条件log中心/点预测，"
                "不是经quantile loss校准的正式中位数。"
            ),
        },
        "training_protocol": {
            "split": "expanding_year; train.year < test.year",
            "same_year_training_forbidden": True,
            "future_training_forbidden": True,
            "main_god_source": "冻结V0算法主用神；不使用K线逆推主用神",
            "mfe_cap": "每折仅用训练期log1p(MFE)的99.5%分位，防止极端点支配损失",
            "issuer_weighting": "训练期按发行主体等权",
            "direction_class_weighting": "训练期按发行主体等权；保留训练期真实涨跌先验",
            "estimators": {
                "mfe": "past-only standardized weighted ridge(log1p MFE)",
                "mae": "past-only standardized weighted ridge(drawdown magnitude)",
                "direction": "past-only standardized weighted ridge probability",
                "within_ticker_rank": "past-only standardized weighted ridge",
            },
            "price_features_used": False,
            "price_usage": "仅监督标签与评价",
        },
        "evaluation": evaluation,
        "warnings": limitations,
        "limitations": limitations,
        "runtime_seconds": metric_float(elapsed_seconds),
    }
    write_json(paths.output_dir / "summary.json", summary, pretty=True)

    feature_schema = {
        "feature_version": FEATURE_VERSION,
        "feature_count": len(feature_names),
        "features": feature_names,
        "source_tier": "V0 deterministic annual/month path + frozen natal proxy",
        "excludes": [
            "K线与收益历史",
            "逆推主用神",
            "同年及未来标签",
            "未冻结的V2.1 F35-F38",
            "未冻结的完整node_state/typed_event_state",
        ],
    }
    feature_schema_bytes = json.dumps(
        feature_schema, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    feature_schema["sha256"] = hashlib.sha256(feature_schema_bytes).hexdigest()
    write_json(paths.output_dir / "feature-schema.json", feature_schema, pretty=True)

    index_rows: list[dict[str, Any]] = []
    for ticker, group in result.groupby("ticker", sort=True):
        stock_scored = group.loc[group["prediction_fold_year"].notna()]
        first = group.iloc[0]
        if len(stock_scored):
            direction_accuracy = float(
                np.mean(stock_scored["predicted_up"] == stock_scored["actual_up"])
            )
            pairwise_accuracy = ticker_pairwise_concordance(stock_scored)
            rank_correlation = (
                spearman(
                    stock_scored["predicted_within_ticker_rank"], stock_scored["mfe"]
                )
                if len(stock_scored) >= 3
                else None
            )
            latest = stock_scored.iloc[-1]
            latest_prediction = {
                "year": int(latest["year"]),
                "predicted_direction": "up"
                if int(latest["predicted_up"]) == 1
                else "down",
                "up_probability": metric_float(latest["predicted_up_probability"]),
                "predicted_mfe_pct": metric_float(100 * latest["predicted_mfe"]),
                "predicted_mae_pct": metric_float(-100 * latest["predicted_drawdown"]),
                "within_ticker_potential_percentile": metric_float(
                    100 * latest["predicted_within_ticker_rank"]
                ),
                "magnitude_class": magnitude_class(
                    float(latest["predicted_within_ticker_rank"])
                ),
            }
        else:
            direction_accuracy = None
            pairwise_accuracy = None
            rank_correlation = None
            latest_prediction = None
        index_rows.append(
            {
                "ticker": ticker,
                "name": first["name"],
                "sector": first["sector"],
                "index_membership": first["index_membership"],
                "theme_membership": first["theme_membership"],
                "security_type": first["security_type"],
                "listing_date": first["listing_date"],
                "main_god": first["main_god"],
                "complete_years": int(len(group)),
                "oos_years": int(len(stock_scored)),
                "oos_direction_accuracy": metric_float(direction_accuracy),
                "oos_rank_spearman": rank_correlation,
                "direction_accuracy": metric_float(direction_accuracy),
                "pairwise_accuracy": pairwise_accuracy,
                "spearman": rank_correlation,
                "latest_oos_prediction": latest_prediction,
                "payload": f"stocks/{ticker}.json.gz",
                "data_path": f"stocks/{ticker}.json.gz",
            }
        )

        group = group.sort_values("year")
        full_rank = group["mfe"].rank(method="average", pct=True)
        periods: list[dict[str, Any]] = []
        years: list[dict[str, Any]] = []
        for row_index, (_, row) in enumerate(group.iterrows()):
            scored_row = math.isfinite(finite(row["prediction_fold_year"], math.nan))
            actual = {
                "open": metric_float(row["open"]),
                "high": metric_float(row["high"]),
                "low": metric_float(row["low"]),
                "close": metric_float(row["close"]),
                "terminal_return_pct": metric_float(100 * row["terminal_return"]),
                "mfe_pct": metric_float(100 * row["mfe"]),
                "mae_pct": metric_float(100 * row["mae"]),
                "direction": "up" if int(row["actual_up"]) == 1 else "down",
                "full_history_within_ticker_mfe_percentile": metric_float(
                    100 * full_rank.iloc[row_index]
                ),
            }
            prediction = None
            if scored_row:
                prediction = {
                    "fold_year": int(row["prediction_fold_year"]),
                    "trained_through_year": int(row["train_through_year"]),
                    "training_rows": int(row["training_rows"]),
                    "direction": "up" if int(row["predicted_up"]) == 1 else "down",
                    "up_probability": metric_float(row["predicted_up_probability"]),
                    "predicted_mfe_pct": metric_float(100 * row["predicted_mfe"]),
                    "predicted_mae_pct": metric_float(-100 * row["predicted_drawdown"]),
                    "within_ticker_potential_percentile": metric_float(
                        100 * row["predicted_within_ticker_rank"]
                    ),
                    "cross_section_potential_percentile": metric_float(
                        100 * row["predicted_year_percentile"]
                    ),
                    "magnitude_class": magnitude_class(
                        float(row["predicted_within_ticker_rank"])
                    ),
                    "direction_hit": bool(int(row["predicted_up"]) == int(row["actual_up"])),
                }
            periods.append(
                {
                    "year": int(row["year"]),
                    "period_start": row["period_start"],
                    "period_end": row["period_end"],
                    "base_v0": {
                        "score": metric_float(row["base_score"]),
                        "status": row["base_status"],
                        "prediction": row["base_prediction"],
                    },
                    "actual": actual,
                    "v2_magnitude": prediction,
                    "not_scored_reason": None
                    if scored_row
                    else "burn_in_insufficient_past_years",
                }
            )
            up_probability = (
                metric_float(row["predicted_up_probability"]) if scored_row else None
            )
            year_value = int(row["year"])
            research_stage = (
                "seen_replay"
                if year_value >= 2023
                else "rolling_development"
                if year_value >= 2019
                else "historical_rolling_diagnostic"
            )
            years.append(
                {
                    "anchor_year": year_value,
                    "anchor_date": row["period_start"],
                    "horizon_end": row["period_end"],
                    "train_cutoff": int(row["train_through_year"])
                    if scored_row
                    else None,
                    "generated_without_future": bool(scored_row),
                    "independent_holdout": False,
                    "research_stage": research_stage,
                    "a0_score": metric_float(row["base_score"]),
                    "a0_direction": row["base_prediction"],
                    "a0_is_neutral": bool(row["base_prediction"] == "neutral"),
                    "v2_p_up": up_probability,
                    "v2_direction": (
                        "up" if int(row["predicted_up"]) == 1 else "down"
                    )
                    if scored_row
                    else None,
                    "v2_confidence": metric_float(
                        abs(float(row["predicted_up_probability"]) - 0.5) * 2.0
                    )
                    if scored_row
                    else None,
                    "predicted_mfe_q50": metric_float(row["predicted_mfe"])
                    if scored_row
                    else None,
                    "predicted_mae_q50": metric_float(-row["predicted_drawdown"])
                    if scored_row
                    else None,
                    "predicted_within_stock_percentile": metric_float(
                        row["predicted_within_ticker_rank"]
                    )
                    if scored_row
                    else None,
                    "actual_close_return_12m": metric_float(row["terminal_return"]),
                    "actual_mfe_12m": metric_float(row["mfe"]),
                    "actual_mae_12m": metric_float(row["mae"]),
                    "direction_hit": bool(
                        int(row["predicted_up"]) == int(row["actual_up"])
                    )
                    if scored_row
                    else None,
                    "eligible": bool(scored_row),
                }
            )

        stock_payload = {
            "model_version": MODEL_VERSION,
            "stock": {
                "ticker": ticker,
                "name": first["name"],
                "sector": first["sector"],
                "index_membership": first["index_membership"],
                "theme_membership": first["theme_membership"],
                "security_type": first["security_type"],
                "listing_date": first["listing_date"],
                "listing_time_basis": first["listing_time_basis"],
                "basis_confidence": first["basis_confidence"],
                "main_god": first["main_god"],
                "bazi": first["bazi"],
            },
            "periods": periods,
            "years": years,
            "flat_year_contract": {
                "return_unit": "decimal_return",
                "predicted_q50_note": (
                    "兼容字段名；当前值为exp(滚动ridge预测的条件log中心)-1，"
                    "不是经过分位数损失校准的中位数。"
                ),
                "independent_holdout": False,
            },
        }
        target = stock_output_dir / f"{ticker}.json.gz"
        with gzip.open(target, "wt", encoding="utf-8", compresslevel=6) as handle:
            json.dump(
                stock_payload,
                handle,
                ensure_ascii=False,
                separators=(",", ":"),
                allow_nan=False,
            )

    index_payload = {
        "schema_version": "v2-magnitude-index-1.0.0",
        "generated_at": generated_at,
        "model_version": MODEL_VERSION,
        "model_status": "experimental_sequence_proxy_fallback",
        "full_v2_typed_state_available": False,
        "stock_count": len(index_rows),
        "strict_oos_year_range": [
            int(scored["year"].min()),
            int(scored["year"].max()),
        ],
        "evaluation": evaluation,
        "stocks": index_rows,
    }
    write_json(paths.output_dir / "index.json", index_payload)
    with gzip.open(
        paths.output_dir / "index.json.gz", "wt", encoding="utf-8", compresslevel=6
    ) as handle:
        json.dump(
            index_payload,
            handle,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        )
    return summary


def main() -> None:
    args = parse_args()
    started = time.perf_counter()
    public_data = args.public_data.resolve()
    output_dir = args.output.resolve()
    paths = BuildPaths(
        public_data=public_data,
        stock_dir=public_data / "stocks",
        output_dir=output_dir,
    )
    if output_dir == public_data or output_dir == paths.stock_dir:
        raise ValueError("Refusing to overwrite the V0 public data directories")
    if output_dir.exists() and not args.keep_existing_output:
        shutil.rmtree(output_dir)

    frame, feature_names, source_metadata = load_rows(paths)
    result, folds = rolling_backtest(
        frame=frame,
        feature_names=feature_names,
        min_train_years=args.min_train_years,
        min_train_rows=args.min_train_rows,
        ridge_alpha=args.ridge_alpha,
        seed=args.seed,
    )
    evaluation, _ = model_evaluation(result, folds)
    elapsed = time.perf_counter() - started
    summary = write_outputs(
        paths=paths,
        result=result,
        feature_names=feature_names,
        source_metadata=source_metadata,
        evaluation=evaluation,
        folds=folds,
        elapsed_seconds=elapsed,
    )
    sys.stdout.write(
        json.dumps(
            {
                "output": str(output_dir),
                "model_version": MODEL_VERSION,
                "scope": summary["scope"],
                "direction": summary["evaluation"]["direction"],
                "neutral_resolution": summary["evaluation"]["v0_neutral_resolution"],
                "mfe": summary["evaluation"]["magnitude"]["mfe"],
                "within_ticker_ordering": summary["evaluation"]["magnitude"][
                    "within_ticker_ordering"
                ],
                "top_decile": {
                    key: value
                    for key, value in summary["evaluation"]["magnitude"][
                        "top_decile"
                    ].items()
                    if key != "by_year"
                },
                "runtime_seconds": summary["runtime_seconds"],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )


if __name__ == "__main__":
    main()
