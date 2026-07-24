#!/usr/bin/env python3
"""Build the 191-stock main-god comparison and event-year replay dataset."""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from fractions import Fraction
from functools import cmp_to_key
from pathlib import Path
from typing import Any


WEB_ROOT = Path(__file__).resolve().parents[1]
RESEARCH_ROOT = WEB_ROOT.parents[1]
DEFAULT_BACKTEST = RESEARCH_ROOT / "tmp/tenbagger_main_god/web-data"
DEFAULT_EVENTS = WEB_ROOT / "public/data/tenbagger-m0/index.json"
DEFAULT_IDENTITY = RESEARCH_ROOT / "artifacts/tenbagger_listing_identity_audit.csv"
DEFAULT_OUTPUT = WEB_ROOT / "public/data/tenbagger-main-god/index.json"

sys.path.insert(0, str(RESEARCH_ROOT / "tmp/annual_fortune"))
from build_annual_fortune_data import GANS, score_period  # noqa: E402


MIN_SAMPLES = 8
MIN_PER_CLASS = 3
NEAR_TIE_MARGIN = Fraction(2, 100)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backtest", type=Path, default=DEFAULT_BACKTEST)
    parser.add_argument("--events", type=Path, default=DEFAULT_EVENTS)
    parser.add_argument("--identity", type=Path, default=DEFAULT_IDENTITY)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def load_gzip_json(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def classify(value: float) -> tuple[str, str]:
    if value >= 3:
        return "强势偏涨", "up"
    if value >= 1:
        return "偏涨", "up"
    if value > -1:
        return "中性震荡", "neutral"
    if value > -3:
        return "偏跌", "down"
    return "弱势偏跌", "down"


def project(main_god: str, row: dict[str, Any]) -> dict[str, Any]:
    segments = row["calculation"]["segments"]
    luck_score = sum(
        float(segment[1])
        * (
            0.0
            if segment[0] == "未上市"
            else float(score_period(main_god, str(segment[0]))["period_score"])
        )
        for segment in segments
    )
    annual_score = float(score_period(main_god, str(row["pillar"]))["period_score"])
    total_score = round(0.60 * luck_score + 0.40 * annual_score, 12)
    status, direction = classify(total_score)
    return {
        "main_god": main_god,
        "luck_score": round(luck_score, 12),
        "annual_score": annual_score,
        "score": total_score,
        "status": status,
        "direction": direction,
    }


def evaluate(main_god: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    actual_up = 0
    actual_down = 0
    hits = 0
    neutral_predictions = 0
    for row in rows:
        kline = row.get("period_kline")
        if row.get("complete") is not True or not kline:
            continue
        actual = str(kline[5])
        if actual not in {"up", "down"}:
            continue
        prediction = project(main_god, row)["direction"]
        actual_up += actual == "up"
        actual_down += actual == "down"
        hits += prediction == actual
        neutral_predictions += prediction == "neutral"

    samples = actual_up + actual_down
    explicit = samples - neutral_predictions
    up_hits = 0
    down_hits = 0
    if samples:
        for row in rows:
            kline = row.get("period_kline")
            if row.get("complete") is not True or not kline:
                continue
            actual = str(kline[5])
            if actual not in {"up", "down"}:
                continue
            prediction = project(main_god, row)["direction"]
            up_hits += actual == "up" and prediction == "up"
            down_hits += actual == "down" and prediction == "down"

    ordinary = Fraction(hits, explicit) if explicit else None
    full_accuracy = Fraction(hits, samples) if samples else None
    coverage = Fraction(explicit, samples) if samples else None
    up_recall = Fraction(up_hits, actual_up) if actual_up else None
    down_recall = Fraction(down_hits, actual_down) if actual_down else None
    full_ba = (
        (up_recall + down_recall) / 2
        if up_recall is not None and down_recall is not None
        else None
    )
    min_recall = (
        min(up_recall, down_recall)
        if up_recall is not None and down_recall is not None
        else None
    )
    return {
        "main_god": main_god,
        "samples": samples,
        "actual_up": actual_up,
        "actual_down": actual_down,
        "hits": hits,
        "neutral_predictions": neutral_predictions,
        "explicit_predictions": explicit,
        "ordinary_raw": ordinary,
        "full_accuracy_raw": full_accuracy,
        "coverage_raw": coverage,
        "full_ba_raw": full_ba,
        "min_recall_raw": min_recall,
        "ordinary_hit_rate": float(ordinary) if ordinary is not None else None,
        "full_accuracy": float(full_accuracy) if full_accuracy is not None else None,
        "direction_coverage": float(coverage) if coverage is not None else None,
        "full_ba": float(full_ba) if full_ba is not None else None,
    }


def compare_candidates(left: dict[str, Any], right: dict[str, Any]) -> int:
    for field in (
        "ordinary_raw",
        "full_accuracy_raw",
        "coverage_raw",
        "full_ba_raw",
        "min_recall_raw",
    ):
        left_value = left[field]
        right_value = right[field]
        if left_value is None and right_value is None:
            continue
        if left_value is None:
            return 1
        if right_value is None:
            return -1
        if left_value != right_value:
            return -1 if left_value > right_value else 1
    return GANS.index(left["main_god"]) - GANS.index(right["main_god"])


def fit_main_god(
    algorithm_main_god: str,
    rows: list[dict[str, Any]],
) -> dict[str, Any]:
    candidates = [evaluate(main_god, rows) for main_god in GANS]
    algorithm = next(
        candidate
        for candidate in candidates
        if candidate["main_god"] == algorithm_main_god
    )
    sufficient = (
        algorithm["samples"] >= MIN_SAMPLES
        and algorithm["actual_up"] >= MIN_PER_CLASS
        and algorithm["actual_down"] >= MIN_PER_CLASS
    )
    for candidate in candidates:
        ordinary_gate = (
            sufficient
            and candidate["ordinary_raw"] is not None
            and algorithm["ordinary_raw"] is not None
            and candidate["ordinary_raw"] > algorithm["ordinary_raw"]
        )
        full_gate = sufficient and candidate["hits"] >= algorithm["hits"]
        coverage_gate = (
            sufficient
            and candidate["explicit_predictions"]
            >= algorithm["explicit_predictions"]
        )
        candidate["passes_ordinary_gate"] = ordinary_gate
        candidate["passes_full_accuracy_gate"] = full_gate
        candidate["passes_coverage_gate"] = coverage_gate
        candidate["qualified"] = (
            candidate["main_god"] != algorithm_main_god
            and ordinary_gate
            and full_gate
            and coverage_gate
        )
    qualified = sorted(
        (candidate for candidate in candidates if candidate["qualified"]),
        key=cmp_to_key(compare_candidates),
    )
    selected = qualified[0] if qualified else algorithm
    second = qualified[1] if len(qualified) > 1 else None
    margin = (
        selected["ordinary_raw"] - second["ordinary_raw"]
        if second is not None
        and selected["ordinary_raw"] is not None
        and second["ordinary_raw"] is not None
        else None
    )
    status = (
        "replaced"
        if qualified
        else "retained_insufficient_samples"
        if algorithm["samples"] > 0 and not sufficient
        else "retained_no_data"
        if algorithm["samples"] == 0
        else "retained_no_qualified_candidate"
    )
    return {
        "sample_status": (
            "sufficient"
            if sufficient
            else "no_data"
            if algorithm["samples"] == 0
            else "insufficient"
        ),
        "replacement_applied": bool(qualified),
        "selection_status": status,
        "selected_main_god": selected["main_god"],
        "second_main_god": second["main_god"] if second else None,
        "qualified_candidate_count": len(qualified),
        "near_tie": margin is not None and margin < NEAR_TIE_MARGIN,
        "margin": float(margin) if margin is not None else None,
        "algorithm": algorithm,
        "selected": selected,
        "candidates": candidates,
    }


def public_metric(metric: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in metric.items()
        if not key.endswith("_raw")
        and key
        not in {
            "passes_ordinary_gate",
            "passes_full_accuracy_gate",
            "passes_coverage_gate",
            "qualified",
        }
    }


def compact_fit(fit: dict[str, Any]) -> dict[str, Any]:
    return {
        "sample_status": fit["sample_status"],
        "replacement_applied": fit["replacement_applied"],
        "selection_status": fit["selection_status"],
        "selected_main_god": fit["selected_main_god"],
        "second_main_god": fit["second_main_god"],
        "qualified_candidate_count": fit["qualified_candidate_count"],
        "near_tie": fit["near_tie"],
        "margin": fit["margin"],
        "algorithm": public_metric(fit["algorithm"]),
        "selected": public_metric(fit["selected"]),
    }


def event_cycle_year(
    event: dict[str, Any],
    calendar: list[dict[str, Any]],
) -> int:
    stored = event.get("attribution_cycle_year")
    if stored is not None:
        return int(stored)
    event_date = str(event["window_start"])
    for cycle in calendar:
        if str(cycle["start_et"])[:10] <= event_date < str(cycle["end_et"])[:10]:
            return int(cycle["year"])
    raise ValueError(f"cannot attribute event cycle for {event['symbol']} {event_date}")


def compact_history_row(
    row: dict[str, Any],
    algorithm_projection: dict[str, Any],
    selected_projection: dict[str, Any],
) -> dict[str, Any]:
    kline = row.get("period_kline")
    return {
        "year": row["year"],
        "pillar": row["pillar"],
        "complete": row.get("complete") is True,
        "actual_direction": str(kline[5]) if kline else None,
        "actual_return_pct": float(kline[4]) if kline else None,
        "algorithm_score": algorithm_projection["score"],
        "algorithm_prediction": algorithm_projection["direction"],
        "selected_score": selected_projection["score"],
        "selected_prediction": selected_projection["direction"],
    }


def combine_metrics(metrics: list[dict[str, Any]]) -> dict[str, Any]:
    totals = {
        "stocks": len(metrics),
        "samples": sum(int(metric["samples"]) for metric in metrics),
        "hits": sum(int(metric["hits"]) for metric in metrics),
        "neutral_predictions": sum(
            int(metric["neutral_predictions"]) for metric in metrics
        ),
        "explicit_predictions": sum(
            int(metric["explicit_predictions"]) for metric in metrics
        ),
    }
    totals["ordinary_hit_rate"] = (
        totals["hits"] / totals["explicit_predictions"]
        if totals["explicit_predictions"]
        else None
    )
    totals["full_accuracy"] = (
        totals["hits"] / totals["samples"] if totals["samples"] else None
    )
    totals["direction_coverage"] = (
        totals["explicit_predictions"] / totals["samples"]
        if totals["samples"]
        else None
    )
    return totals


def summarize_event_predictions(
    rows: list[dict[str, Any]],
    field: str,
) -> dict[str, Any]:
    direction_counts = Counter(row[field]["direction"] for row in rows)
    complete = [
        row
        for row in rows
        if row["event_actual_complete"]
        and row["event_actual_direction"] in {"up", "down"}
    ]
    explicit = [
        row for row in complete if row[field]["direction"] in {"up", "down"}
    ]
    hits = sum(
        row[field]["direction"] == row["event_actual_direction"] for row in explicit
    )
    return {
        "direction_counts": {
            direction: direction_counts.get(direction, 0)
            for direction in ("up", "neutral", "down")
        },
        "bullish_capture_count": direction_counts.get("up", 0),
        "bullish_capture_rate_all_191": direction_counts.get("up", 0) / len(rows),
        "actual_complete_direction_rows": len(complete),
        "explicit_direction_rows": len(explicit),
        "direction_hits": hits,
        "direction_hit_rate_excluding_neutral": hits / len(explicit)
        if explicit
        else None,
        "direction_coverage_on_complete_rows": len(explicit) / len(complete)
        if complete
        else None,
        "full_accuracy_including_neutral": hits / len(complete)
        if complete
        else None,
    }


def main() -> None:
    args = parse_args()
    index = json.loads((args.backtest / "index.json").read_text(encoding="utf-8"))
    summary = json.loads((args.backtest / "summary.json").read_text(encoding="utf-8"))
    event_payload = json.loads(args.events.read_text(encoding="utf-8"))
    events = event_payload["events"]
    identities = {row["symbol"]: row for row in read_csv(args.identity)}
    index_by_ticker = {row["ticker"]: row for row in index["stocks"]}
    if len(events) != 191 or len(index_by_ticker) != 191 or len(identities) != 191:
        raise ValueError(
            f"expected 191/191/191, got "
            f"{len(events)}/{len(index_by_ticker)}/{len(identities)}"
        )

    rows: list[dict[str, Any]] = []
    full_fits: list[dict[str, Any]] = []
    prefix_fits: list[dict[str, Any]] = []
    for event in events:
        ticker = str(event["symbol"])
        payload = load_gzip_json(args.backtest / "stocks" / f"{ticker}.json.gz")
        stock = payload["stock"]
        annual_rows = payload["annual"]
        cycle_year = event_cycle_year(event, summary["calendar"])
        cycle_row = next(
            (row for row in annual_rows if int(row["year"]) == cycle_year),
            None,
        )
        if cycle_row is None:
            raise ValueError(f"missing event cycle row for {ticker}/{cycle_year}")

        full_fit = fit_main_god(str(stock["main_god"]), annual_rows)
        if (
            full_fit["selected_main_god"] != stock["reverse_main_god"]
            or full_fit["replacement_applied"]
            is not bool(stock["reverse_replacement_applied"])
        ):
            raise ValueError(
                f"reverse fit mismatch for {ticker}: "
                f"{full_fit['selected_main_god']}/{stock['reverse_main_god']}"
            )
        prefix_rows = [
            row for row in annual_rows if int(row["year"]) < cycle_year
        ]
        prefix_fit = fit_main_god(str(stock["main_god"]), prefix_rows)
        algorithm_event = project(str(stock["main_god"]), cycle_row)
        full_event = project(full_fit["selected_main_god"], cycle_row)
        causal_event = project(prefix_fit["selected_main_god"], cycle_row)
        kline = cycle_row.get("period_kline")
        identity = identities[ticker]
        audited_candidate_used = bool(identity["candidate_primary_date"]) and (
            identity["candidate_primary_date"] <= str(event["window_start"])
        )
        history = []
        for annual_row in annual_rows:
            history.append(
                compact_history_row(
                    annual_row,
                    project(str(stock["main_god"]), annual_row),
                    project(full_fit["selected_main_god"], annual_row),
                )
            )
        row = {
            "ticker": ticker,
            "name": stock["name"],
            "market_category": event.get("market_category") or stock["sector"],
            "industry_element": event.get("industry_element"),
            "event_date": event["window_start"],
            "window_end": event["window_end"],
            "first_10x_date": event.get("first_10x_date_derived"),
            "days_to_10x": event.get("days_to_10x"),
            "strict_high_multiple": event.get("strict_high_multiple"),
            "event_cycle_year": cycle_year,
            "event_cycle_pillar": cycle_row["pillar"],
            "event_actual_complete": cycle_row.get("complete") is True,
            "event_actual_direction": str(kline[5]) if kline else None,
            "event_actual_return_pct": float(kline[4]) if kline else None,
            "listing_date": stock["listing_date"],
            "listing_time_et": stock["time_et"],
            "first_luck_start_et": stock["first_luck_start_et"],
            "bazi": stock["bazi"],
            "listing_time_basis": stock["listing_time_basis"],
            "basis_confidence": stock["basis_confidence"],
            "identity_method": (
                "audited_candidate"
                if audited_candidate_used
                else "stored_or_panel_proxy"
            ),
            "identity_audit_status": identity["audit_status"],
            "identity_risk_tier": identity["risk_tier"],
            "identity_note": identity["audit_note"],
            "identity_primary_source": identity["primary_source"],
            "algorithm_main_god": stock["main_god"],
            "full_history_fit": compact_fit(full_fit),
            "event_prefix_fit": compact_fit(prefix_fit),
            "algorithm_event": algorithm_event,
            "full_history_event": full_event,
            "causal_event": causal_event,
            "history": history,
        }
        rows.append(row)
        if full_fit["sample_status"] == "sufficient":
            full_fits.append(full_fit)
        if prefix_fit["sample_status"] == "sufficient":
            prefix_fits.append(prefix_fit)

    rows.sort(key=lambda row: (row["event_date"], row["ticker"]), reverse=True)
    full_algorithm_metrics = [fit["algorithm"] for fit in full_fits]
    full_selected_metrics = [fit["selected"] for fit in full_fits]
    prefix_algorithm_metrics = [fit["algorithm"] for fit in prefix_fits]
    prefix_selected_metrics = [fit["selected"] for fit in prefix_fits]
    public_summary = {
        "stock_count": len(rows),
        "price_payload_count": len(rows),
        "full_history": {
            "eligible_stocks": len(full_fits),
            "replacement_count": sum(
                fit["replacement_applied"] for fit in full_fits
            ),
            "sample_status_counts": dict(
                Counter(
                    fit_main_god(
                        row["algorithm_main_god"],
                        load_gzip_json(
                            args.backtest / "stocks" / f"{row['ticker']}.json.gz"
                        )["annual"],
                    )["sample_status"]
                    for row in rows
                )
            ),
            "algorithm": combine_metrics(full_algorithm_metrics),
            "selected": combine_metrics(full_selected_metrics),
        },
        "event_prefix": {
            "eligible_stocks": len(prefix_fits),
            "replacement_count": sum(
                fit["replacement_applied"] for fit in prefix_fits
            ),
            "algorithm": combine_metrics(prefix_algorithm_metrics),
            "selected": combine_metrics(prefix_selected_metrics),
        },
        "event_year": {
            "actual_complete_rows": sum(
                row["event_actual_complete"] for row in rows
            ),
            "algorithm": summarize_event_predictions(rows, "algorithm_event"),
            "full_history_in_sample": summarize_event_predictions(
                rows, "full_history_event"
            ),
            "event_prefix_causal": summarize_event_predictions(rows, "causal_event"),
        },
        "identity": {
            "audited_candidate_used": sum(
                row["identity_method"] == "audited_candidate" for row in rows
            ),
            "proxy_used": sum(
                row["identity_method"] == "stored_or_panel_proxy" for row in rows
            ),
        },
    }
    output = {
        "schema_version": "tenbagger-main-god-191-v1.0.0",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_cutoff": index["data_cutoff"],
        "source_event_freeze": event_payload["source_freeze"],
        "rules": {
            "algorithm_main_god": "日干×月令查询120格用神表",
            "annual_formula": "60%×行运背景 + 40%×流年",
            "selection_candidates": list(GANS),
            "minimum_samples": MIN_SAMPLES,
            "minimum_up_years": MIN_PER_CLASS,
            "minimum_down_years": MIN_PER_CLASS,
            "replacement_gate": [
                "排除中性后的普通命中率严格提高",
                "全样本命中数不得下降",
                "明确方向预测数不得下降",
            ],
            "full_history_warning": (
                "S&P格式的全历史逆推使用同一段K线选神并在同段K线上计算命中率，"
                "属于样本内解释，不是独立预测准确率。"
            ),
            "event_prefix_rule": (
                "事件年预测只使用事件所属立春年之前的完整年K选择主用神；"
                "历史不足时保留算法主用神。"
            ),
        },
        "summary": public_summary,
        "rows": rows,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(output, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "output": str(args.output),
                "rows": len(rows),
                "full_history": public_summary["full_history"],
                "event_prefix": public_summary["event_prefix"],
                "event_year": public_summary["event_year"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
