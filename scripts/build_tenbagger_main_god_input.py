#!/usr/bin/env python3
"""Build the frozen 191-stock tenbagger input for the annual-fortune engine.

The event pool is frozen by ``label == 1`` and
``sample_role == "tenbagger"``.  Identity fields prefer the audited
``candidate_*`` origin as a complete tuple; when that tuple is unavailable,
the script falls back to the stored model/panel proxy tuple.  Both source rows
are retained verbatim on each stock so later builders can expose the audit
trail without rejoining mutable files.

This script only prepares natal/luck-chart inputs.  It does not read K-lines,
fit a reverse main god, or overwrite the existing S&P 500 / Nasdaq-100 data.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.util
import json
from collections import Counter
from datetime import date, timedelta
from pathlib import Path
from types import ModuleType
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
DEFAULT_AUDIT = ROOT / "artifacts/tenbagger_listing_identity_audit.csv"
DEFAULT_EVENT_PANEL = ROOT / "artifacts/tenbagger_event_panel.csv"
DEFAULT_YONGSHEN = ROOT / "tmp/annual_fortune/yongshen_lookup.json"
DEFAULT_FORTUNE_ENGINE = (
    ROOT / "tmp/annual_fortune/build_annual_fortune_data.py"
)
DEFAULT_OUTPUT = (
    ROOT / "tmp/tenbagger_main_god/annual_fortune_data.json"
)

EXPECTED_STOCKS = 191
STEMS = set("甲乙丙丁戊己庚辛壬癸")
BRANCHES = set("子丑寅卯辰巳午未申酉戌亥")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audit", type=Path, default=DEFAULT_AUDIT)
    parser.add_argument(
        "--event-panel", type=Path, default=DEFAULT_EVENT_PANEL
    )
    parser.add_argument("--yongshen", type=Path, default=DEFAULT_YONGSHEN)
    parser.add_argument(
        "--fortune-engine", type=Path, default=DEFAULT_FORTUNE_ENGINE
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_fortune_engine(path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "tenbagger_annual_fortune_engine", path
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import fortune engine: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not callable(getattr(module, "build_luck_chart", None)):
        raise RuntimeError(f"build_luck_chart is missing from {path}")
    return module


def require_complete_tuple(
    row: dict[str, str], fields: tuple[str, str, str]
) -> tuple[str, str, str] | None:
    values = tuple(str(row.get(field) or "").strip() for field in fields)
    populated = sum(bool(value) for value in values)
    if populated == 0:
        return None
    if populated != len(values):
        raise ValueError(
            f"{row.get('symbol')}: partial identity tuple "
            f"{dict(zip(fields, values))}"
        )
    return values


def validate_bazi(symbol: str, bazi: str) -> tuple[str, str]:
    pillars = bazi.split()
    if len(pillars) != 4 or any(len(pillar) != 2 for pillar in pillars):
        raise ValueError(f"{symbol}: invalid bazi {bazi!r}")
    if any(pillar[0] not in STEMS for pillar in pillars):
        raise ValueError(f"{symbol}: invalid heavenly stem in {bazi!r}")
    if any(pillar[1] not in BRANCHES for pillar in pillars):
        raise ValueError(f"{symbol}: invalid earthly branch in {bazi!r}")
    return pillars[2][0], pillars[1][1]


def serialize_chart(chart: dict[str, Any]) -> dict[str, Any]:
    return {
        **{
            key: value
            for key, value in chart.items()
            if key
            not in (
                "listing",
                "first_luck_start",
                "pre_luck_periods",
                "periods",
            )
        },
        "pre_luck_periods": [
            {
                key: value
                for key, value in period.items()
                if key not in ("start", "end")
            }
            for period in chart["pre_luck_periods"]
        ],
        "periods": [
            {
                key: value
                for key, value in period.items()
                if key not in ("start", "end")
            }
            for period in chart["periods"]
        ],
    }


def compact_event(row: dict[str, str]) -> dict[str, Any]:
    event_date = date.fromisoformat(row["event_date"])
    days_to_10x = int(row["days_to_10x"])
    observation_days = int(row["future_observation_days"])
    return {
        "event_key": (
            f"{row['group_id']}|{row['symbol']}|{row['event_date']}"
        ),
        "group_id": row["group_id"],
        "event_date": row["event_date"],
        "first_10x_date_derived": (
            event_date + timedelta(days=days_to_10x)
        ).isoformat(),
        "window_end_derived": (
            event_date + timedelta(days=observation_days)
        ).isoformat(),
        "start_year": int(row["start_year"]),
        "days_to_10x": days_to_10x,
        "future_observation_days": observation_days,
        "strict_high_multiple": float(row["strict_high_multiple"]),
        "future_365_high_multiple": float(
            row["future_365_high_multiple"]
        ),
        "market_category": row["market_category"],
        "value_class": row["value_class"],
        "industry_element": row["industry_element"],
        "event_month_to_industry_relation": row[
            "event_month_to_industry_relation"
        ],
        "history_start_date": row["history_start_date"],
    }


def basis_fields(
    audit: dict[str, str], candidate_used: bool
) -> tuple[str, str, str]:
    if candidate_used:
        return (
            "常规开盘",
            "A",
            (
                "采用身份审计候选主体起点；日期有审计来源，但09:30仍为"
                "常规开盘代理，不是已核实首笔撮合时刻。"
            ),
        )
    stored_basis = str(audit.get("stored_basis") or "")
    if stored_basis == "常规开盘":
        return (
            "常规开盘",
            "M",
            "沿用已存常规开盘代理；不是已核实首笔撮合时刻。",
        )
    return (
        "行情起点*",
        "P",
        (
            "未找到完整候选主体起点，退回模型/事件面板代理日期与09:30；"
            "该日期可能只是行情同步或批量回填起点，不等于真实上市日。"
        ),
    )


def main() -> None:
    args = parse_args()
    audit_rows = read_csv(args.audit)
    source_event_rows = read_csv(args.event_panel)
    event_rows = [
        row
        for row in source_event_rows
        if row.get("label") == "1"
        and row.get("sample_role") == "tenbagger"
    ]
    if len(audit_rows) != EXPECTED_STOCKS:
        raise AssertionError(
            f"audit stock count changed: {len(audit_rows)}"
        )
    if len(event_rows) != EXPECTED_STOCKS:
        raise AssertionError(
            f"frozen event count changed: {len(event_rows)}"
        )

    audit_by_symbol = {row["symbol"]: row for row in audit_rows}
    event_by_symbol = {row["symbol"]: row for row in event_rows}
    if len(audit_by_symbol) != EXPECTED_STOCKS:
        raise AssertionError("duplicate symbol in identity audit")
    if len(event_by_symbol) != EXPECTED_STOCKS:
        raise AssertionError("duplicate symbol in frozen event pool")
    if set(audit_by_symbol) != set(event_by_symbol):
        raise AssertionError(
            {
                "audit_only": sorted(
                    set(audit_by_symbol) - set(event_by_symbol)
                ),
                "event_only": sorted(
                    set(event_by_symbol) - set(audit_by_symbol)
                ),
            }
        )

    yongshen_payload = json.loads(
        args.yongshen.read_text(encoding="utf-8")
    )
    lookup_rows = yongshen_payload["records"]
    lookup = {row["key"]: row for row in lookup_rows}
    if len(lookup) != 120:
        raise AssertionError(f"yongshen lookup changed: {len(lookup)}")
    engine = load_fortune_engine(args.fortune_engine)

    stocks: list[dict[str, Any]] = []
    charts: list[dict[str, Any]] = []
    identity_mode_counts: Counter[str] = Counter()
    audit_status_counts: Counter[str] = Counter()
    risk_tier_counts: Counter[str] = Counter()
    main_god_counts: Counter[str] = Counter()

    for symbol in sorted(event_by_symbol):
        audit = audit_by_symbol[symbol]
        event = event_by_symbol[symbol]
        candidate = require_complete_tuple(
            audit,
            (
                "candidate_primary_date",
                "candidate_time_et",
                "candidate_bazi",
            ),
        )
        fallback = require_complete_tuple(
            audit,
            (
                "model_or_panel_proxy_date",
                "model_or_panel_proxy_time_et",
                "model_or_panel_proxy_bazi",
            ),
        )
        candidate_precedes_event = (
            candidate is not None
            and candidate[0] <= event["event_date"]
        )
        if candidate_precedes_event:
            listing_date, time_et, bazi = candidate
            identity_mode = "audited_candidate_primary"
            candidate_used = True
        elif fallback is not None:
            listing_date, time_et, bazi = fallback
            identity_mode = "model_or_panel_proxy_fallback"
            candidate_used = False
        else:
            raise ValueError(f"{symbol}: no usable identity tuple")

        date.fromisoformat(listing_date)
        if len(time_et.split(":")) != 3:
            raise ValueError(f"{symbol}: invalid ET time {time_et!r}")
        day_stem, month_branch = validate_bazi(symbol, bazi)
        lookup_key = f"{month_branch}|{day_stem}"
        role = lookup.get(lookup_key)
        if role is None:
            raise ValueError(f"{symbol}: missing yongshen key {lookup_key}")
        basis, source_code, basis_note = basis_fields(
            audit, candidate_used
        )
        event_meta = compact_event(event)
        audit_note = str(audit.get("audit_note") or "").strip()
        note_parts = [basis_note]
        if audit_note:
            note_parts.append(audit_note)

        stock = {
            "index": "一年十倍股池",
            "ticker": symbol,
            "name": audit["company_name"] or event["company_name"],
            "sector": event["market_category"] or "未分类",
            "listing_date": listing_date,
            "time_et": time_et,
            "basis": basis,
            "source_code": source_code,
            "note": " ".join(note_parts),
            "bazi": bazi,
            "index_membership": "一年十倍股池",
            "theme_membership": ["一年十倍股池"],
            "security_type": "stock",
            "theme_role": "tenbagger_case",
            "day_stem": day_stem,
            "month_branch": month_branch,
            "main_god": role["main_god"],
            "auxiliary_gods": role["auxiliary_gods"],
            "identity_selection_mode": identity_mode,
            "identity_candidate_used": candidate_used,
            "identity_candidate_rejected_after_event": (
                candidate is not None and not candidate_precedes_event
            ),
            "identity_risk_tier": audit["risk_tier"],
            "identity_audit_status": audit["audit_status"],
            "identity_action": audit["identity_action"],
            "identity_primary_source": audit["primary_source"],
            "identity_audit": dict(audit),
            "tenbagger_event": event_meta,
            "tenbagger_event_source_row": dict(event),
        }
        chart = engine.build_luck_chart(stock)
        stocks.append(stock)
        charts.append(serialize_chart(chart))
        identity_mode_counts[identity_mode] += 1
        audit_status_counts[audit["audit_status"]] += 1
        risk_tier_counts[audit["risk_tier"]] += 1
        main_god_counts[role["main_god"]] += 1

    if len(stocks) != EXPECTED_STOCKS or len(charts) != EXPECTED_STOCKS:
        raise AssertionError((len(stocks), len(charts)))
    if {stock["ticker"] for stock in stocks} != {
        chart["ticker"] for chart in charts
    }:
        raise AssertionError("stock/chart ticker mismatch")

    payload = {
        "schema_version": "tenbagger-main-god-input@1.0.0",
        "metadata": {
            "title": "一年十倍股191只 · 独立主用神年运输入",
            "as_of_date": "2026-07-10",
            "holdings_date": "2026-07-10",
            "stock_count": len(stocks),
            "unique_ticker_count": len(stocks),
            "row_count": len(stocks),
            "timezone": "America/New_York (ET)",
            "universe": "冻结的一年十倍股事后事件池",
            "event_filter": (
                "label == 1 and sample_role == tenbagger"
            ),
            "identity_selection_rule": (
                "完整candidate_primary_date/time/bazi优先；否则使用完整"
                "model_or_panel_proxy_date/time/bazi。候选及回退均保留原始审计。"
            ),
            "identity_mode_counts": dict(identity_mode_counts),
            "audit_status_counts": dict(audit_status_counts),
            "risk_tier_counts": dict(risk_tier_counts),
            "main_god_counts": dict(main_god_counts),
            "reference_workbook": yongshen_payload.get(
                "source_workbook"
            ),
            "source_files": [
                {
                    "path": str(args.audit),
                    "sha256": sha256_path(args.audit),
                },
                {
                    "path": str(args.event_panel),
                    "sha256": sha256_path(args.event_panel),
                },
                {
                    "path": str(args.yongshen),
                    "sha256": sha256_path(args.yongshen),
                },
                {
                    "path": str(args.fortune_engine),
                    "sha256": sha256_path(args.fortune_engine),
                },
            ],
            "disclosures": [
                (
                    "28只采用事件发生前已存在的审计候选主体日期，但时刻仍是09:30常规开盘"
                    "代理，不是已核实的首笔撮合秒级时间。"
                ),
                (
                    "其余股票退回模型或事件面板代理；其中一部分仅是"
                    "历史行情起点，不能表述为真实上市日期。"
                ),
                (
                    "十倍标签由事后未来365日最高价构造；本输入不等于"
                    "可实时获得的前瞻股票池。"
                ),
            ],
        },
        "stocks": stocks,
        "charts": charts,
        "yongshen_records": lookup_rows,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "output": str(args.output),
                "stocks": len(stocks),
                "charts": len(charts),
                "identity_mode_counts": dict(identity_mode_counts),
                "audit_status_counts": dict(audit_status_counts),
                "main_god_counts": dict(main_god_counts),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
