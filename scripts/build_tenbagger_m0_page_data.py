#!/usr/bin/env python3
"""Publish the frozen 191-event M0 audit as a browser-safe data file."""

from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


WEB_ROOT = Path(__file__).resolve().parents[1]
RESEARCH_ROOT = WEB_ROOT.parents[1]
DEFAULT_SOURCE = RESEARCH_ROOT / "tmp/tenbagger_m0_v39_backtest.json"
DEFAULT_PANEL = RESEARCH_ROOT / "artifacts/tenbagger_event_panel.csv"
DEFAULT_DIAGNOSIS = RESEARCH_ROOT / "artifacts/destiny_path_target_diagnosis.csv"
DEFAULT_OUTPUT = WEB_ROOT / "public/data/tenbagger-m0/index.json"

ROW_FIELDS = (
    "source_row_index",
    "event_key",
    "group_id",
    "symbol",
    "company_name",
    "window_start",
    "window_end",
    "first_10x_date_derived",
    "source_calendar_start_year",
    "future_observation_days",
    "days_to_10x",
    "future_365_high_multiple",
    "strict_high_multiple",
    "value_class",
    "payload_matched",
    "cycle_attributed",
    "attribution_cycle_year",
    "attribution_cycle_start",
    "attribution_cycle_end",
    "calendar_year_differs_from_cycle_year",
    "cycle_complete",
    "prior_complete_years",
    "prior_up_years",
    "prior_down_years",
    "history_status",
    "m0_eligible",
    "m0_selected_main_god",
    "m0_score",
    "m0_prediction",
    "m0_prediction_label",
    "captured",
    "same_stock_rank",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--panel", type=Path, default=DEFAULT_PANEL)
    parser.add_argument("--diagnosis", type=Path, default=DEFAULT_DIAGNOSIS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def public_freeze(source: dict[str, Any]) -> dict[str, Any]:
    freeze = source["event_pool_freeze"]
    return {
        "source_sha256": freeze["source_sha256"],
        "source_rows": freeze["source_rows"],
        "case_filter": freeze["case_filter"],
        "frozen_event_key": freeze["frozen_event_key"],
        "frozen_event_key_sha256": freeze["frozen_event_key_sha256"],
        "events": freeze["events"],
        "unique_stocks": freeze["unique_stocks"],
        "source_calendar_year_min": freeze["source_calendar_year_min"],
        "source_calendar_year_max": freeze["source_calendar_year_max"],
        "window_end_rule": freeze["window_end_rule"],
        "first_10x_date_rule": freeze["first_10x_date_rule"],
    }


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def parse_bool(value: str) -> bool | None:
    if value == "":
        return None
    return value.strip().lower() in {"1", "true", "yes"}


def parse_number(value: str) -> float | None:
    if value == "":
        return None
    return float(value)


def compact_row(
    row: dict[str, Any],
    panel_row: dict[str, str],
    diagnosis_row: dict[str, str] | None,
) -> dict[str, Any]:
    result = {field: row.get(field) for field in ROW_FIELDS}
    result.update(
        {
            "market_category": panel_row["market_category"],
            "industry_element": panel_row["industry_element"],
            "event_month_to_industry_relation": panel_row[
                "event_month_to_industry_relation"
            ],
            "annual_actual_direction": (
                diagnosis_row["annual_cycle_actual_direction"]
                if diagnosis_row
                else None
            ),
            "annual_actual_return_pct": (
                parse_number(diagnosis_row["annual_cycle_return_pct"])
                if diagnosis_row
                else None
            ),
            "annual_actual_complete": (
                parse_bool(diagnosis_row["annual_cycle_complete"])
                if diagnosis_row
                else None
            ),
            "listing_time_basis": (
                diagnosis_row["listing_time_basis"] if diagnosis_row else None
            ),
            "basis_confidence": (
                diagnosis_row["basis_confidence"] if diagnosis_row else None
            ),
            "hit_crosses_litchun_year": (
                parse_bool(diagnosis_row["hit_crosses_litchun_year"])
                if diagnosis_row
                else None
            ),
        }
    )
    return result


def main() -> None:
    args = parse_args()
    source = json.loads(args.source.read_text(encoding="utf-8"))
    panel_rows = read_csv(args.panel)
    diagnosis_rows = read_csv(args.diagnosis)
    diagnosis_by_key = {
        (row["symbol"], row["event_date"]): row for row in diagnosis_rows
    }
    events = []
    for row in source["event_rows"]:
        panel_row = panel_rows[int(row["source_row_index"])]
        if (
            panel_row["symbol"] != row["symbol"]
            or panel_row["event_date"] != row["window_start"]
        ):
            raise ValueError(f"panel identity mismatch for {row['event_key']}")
        diagnosis_row = diagnosis_by_key.get((row["symbol"], row["window_start"]))
        events.append(compact_row(row, panel_row, diagnosis_row))
    if len(events) != 191:
        raise ValueError(f"expected 191 frozen events, found {len(events)}")

    payload = {
        "schema_version": "tenbagger-m0-web-1.0.0",
        "model_schema": source["schema"],
        "model_status": source["status"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_freeze": public_freeze(source),
        "scope": source["scope"],
        "results": source["m0_event_results"],
        "same_stock_rank_summary": source["same_stock_rank_summary"],
        "protocol": source["protocol"],
        "events": events,
        "disclosures": [
            "十倍标签是事后严格低点至未来365日内盘中最高价达到10倍，不是自然年或立春年收盘涨幅。",
            "预测只使用事件所属立春年之前的完整年K；同年K线和未来K线未参与主用神选择。",
            "缺数据或历史不足不是中性预测，必须单独显示为不可计算。",
            "所有事件都是事后筛出的正样本；本页的捕获率不能替代与普通股票对照后的前瞻识别能力。",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"wrote {len(events)} events to {args.output}")


if __name__ == "__main__":
    main()
