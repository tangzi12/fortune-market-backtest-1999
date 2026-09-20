#!/usr/bin/env python3
"""Independently audit the A-share adaptation of the US primary-page model.

Reads the published JSON/gzip artifacts, never imports the builder. The fixed
model, period eligibility, reverse-fit gates, and aggregates are recomputed.
Usage: python3 research/validate_a_share_fortune_results.py OUTPUT_DIRECTORY
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import sys
from collections import Counter, defaultdict
from datetime import datetime, time
from functools import cmp_to_key, lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
SHANGHAI = ZoneInfo("Asia/Shanghai")
STEMS = "甲乙丙丁戊己庚辛壬癸"
BRANCHES = "子丑寅卯辰巳午未申酉戌亥"
STEM_ELEMENTS = dict(zip(STEMS, "木木火火土土金金水水"))
GENERATES = dict(zip("木火土金水", "火土金水木"))
CONTROLS = dict(zip("木土水火金", "土水火金木"))
COMBOS = {frozenset(pair) for pair in ("甲己", "乙庚", "丙辛", "丁壬", "戊癸")}
GROWTH_BRANCHES = (
    "亥子丑寅卯辰巳午未申酉戌", "午巳辰卯寅丑子亥戌酉申未",
    "寅卯辰巳午未申酉戌亥子丑", "酉申未午巳辰卯寅丑子亥戌",
    "寅卯辰巳午未申酉戌亥子丑", "酉申未午巳辰卯寅丑子亥戌",
    "巳午未申酉戌亥子丑寅卯辰", "子亥戌酉申未午巳辰卯寅丑",
    "申酉戌亥子丑寅卯辰巳午未", "卯寅丑子亥戌酉申未午巳辰",
)
GROWTH_SCORES = (3, 0, 3, 4, 5, -1, -2, -3, -4, -5, 1, 2)
GROWTH = {stem: dict(zip(branches, GROWTH_SCORES))
          for stem, branches in zip(STEMS, GROWTH_BRANCHES)}
STATUSES = ("强势偏涨", "偏涨", "中性震荡", "偏跌", "弱势偏跌")
STATUS_DIRECTION = dict(zip(STATUSES, ("up", "up", "neutral", "down", "down")))


def read_json(path):
    opener = gzip.open if str(path).endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as stream:
        return json.load(stream)


def local_datetime(value):
    value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return value.replace(tzinfo=SHANGHAI) if value.tzinfo is None else value.astimezone(SHANGHAI)


def timestamp(value):
    return local_datetime(value).timestamp()


def period_time(period, side):
    for suffix in ("local", "shanghai", "et"):
        key = f"{side}_{suffix}"
        if key in period:
            return period[key]
    raise ValueError(f"Missing {side} local timestamp")


def status_for(score):
    if score >= 3:
        return STATUSES[0]
    if score >= 1:
        return STATUSES[1]
    if score > -1:
        return STATUSES[2]
    return STATUSES[3] if score > -3 else STATUSES[4]


@lru_cache(maxsize=None)
def period_score(main, pillar):
    if not pillar or pillar in ("未上市", "未起运"):
        return 0.0
    action, branch = pillar
    a, m = STEM_ELEMENTS[action], STEM_ELEMENTS[main]
    if a == m:
        stem_score = 3
    elif GENERATES[a] == m:
        stem_score = 5
    elif GENERATES[m] == a:
        stem_score = -3
    elif CONTROLS[a] == m:
        stem_score = -5
    else:
        stem_score = 1
    if frozenset((action, main)) in COMBOS:
        if CONTROLS[a] == m:
            stem_score += 2
        elif CONTROLS[m] == a:
            stem_score -= 2
    return round(0.6 * GROWTH[main][branch] + 0.4 * stem_score, 6)


def annual_pillar(year):
    position = (year - 1984) % 60
    return STEMS[position % 10] + BRANCHES[position % 12]


def recompute_score(main, row, kind):
    luck = sum(segment[1] * period_score(main, segment[0])
               for segment in row["calculation"]["segments"])
    annual = period_score(main, annual_pillar(row["year"]))
    value = (0.6 * luck + 0.4 * annual if kind == "annual" else
             0.36 * luck + 0.24 * annual + 0.4 * period_score(main, row["pillar"]))
    return round(value, 12)


def divide(a, b):
    return None if not b else a / b


class Audit:
    def __init__(self):
        self.check_count = 0
        self.errors = []
        self.error_count = 0
        self.counts = Counter()

    def check(self, valid, message):
        self.check_count += 1
        if not valid:
            self.error_count += 1
            if len(self.errors) < 100:
                self.errors.append(message)

    def equal(self, actual, expected, message, tolerance=1.1e-6):
        if expected is None:
            valid = actual is None
        elif isinstance(expected, bool):
            valid = actual is expected
        elif isinstance(expected, (int, float)):
            valid = (isinstance(actual, (int, float)) and math.isfinite(actual)
                     and abs(actual - expected) <= tolerance)
        else:
            valid = actual == expected
        self.check(valid, f"{message}: actual={actual!r}, expected={expected!r}")


class Metric:
    def __init__(self):
        self.counts = Counter()
        self.status = defaultdict(Counter)

    def add(self, row):
        c = self.counts
        c["total_periods"] += 1
        if not row["complete"] or not row.get("period_kline"):
            return
        kline = row["period_kline"]
        c["complete_periods"] += 1
        c["return_sum"] += kline[4]
        c["actual_up_periods"] += kline[5] == "up"
        s = self.status[row["status"]]
        s["samples"] += 1
        s["actual_up"] += kline[5] == "up"
        s["return_sum"] += kline[4]
        pred = row["predicted_direction"]
        if pred == "neutral":
            c["neutral_periods"] += 1
            return
        c["directional_samples"] += 1
        c[f"predicted_{pred}"] += 1
        c["hits"] += pred == kline[5]
        c["actual_up_directional"] += kline[5] == "up"
        c[f"pred_{pred}_actual_{kline[5]}"] += 1

    def audit(self, audit, actual, label):
        c = self.counts
        for key in ("total_periods", "complete_periods", "directional_samples",
                    "hits", "predicted_up", "predicted_down", "neutral_periods",
                    "actual_up_periods"):
            audit.equal(actual.get(key), c[key], f"{label}.{key}", tolerance=0)
        for key, numerator, denominator in (
            ("hit_rate", "hits", "directional_samples"),
            ("neutral_coverage", "neutral_periods", "complete_periods"),
            ("actual_up_rate", "actual_up_periods", "complete_periods"),
            ("average_return_pct", "return_sum", "complete_periods"),
        ):
            audit.equal(actual.get(key), divide(c[numerator], c[denominator]), f"{label}.{key}")
        precision_up = divide(c["pred_up_actual_up"], c["pred_up_actual_up"] + c["pred_up_actual_down"])
        precision_down = divide(c["pred_down_actual_down"], c["pred_down_actual_down"] + c["pred_down_actual_up"])
        recall_up = divide(c["pred_up_actual_up"], c["pred_up_actual_up"] + c["pred_down_actual_up"])
        recall_down = divide(c["pred_down_actual_down"], c["pred_down_actual_down"] + c["pred_up_actual_down"])
        for key, expected in (("bullish_hit_rate", precision_up), ("bearish_hit_rate", precision_down),
                              ("up_recall", recall_up), ("down_recall", recall_down),
                              ("macro_precision", None if precision_up is None or precision_down is None else (precision_up + precision_down) / 2),
                              ("balanced_accuracy", None if recall_up is None or recall_down is None else (recall_up + recall_down) / 2)):
            audit.equal(actual.get(key), expected, f"{label}.{key}")
        for key in ("pred_up_actual_up", "pred_up_actual_down", "pred_down_actual_down", "pred_down_actual_up"):
            audit.equal(actual.get("directional_confusion", {}).get(key), c[key], f"{label}.confusion.{key}")
        audit.equal(actual.get("directional_confusion", {}).get("actual_neutral"),
                    c["pred_up_actual_neutral"] + c["pred_down_actual_neutral"], f"{label}.confusion.actual_neutral")
        for status in STATUSES:
            observed, expected = actual.get("by_status", {}).get(status, {}), self.status[status]
            audit.equal(observed.get("samples"), expected["samples"], f"{label}.{status}.samples")
            audit.equal(observed.get("actual_up_rate"), divide(expected["actual_up"], expected["samples"]), f"{label}.{status}.actual_up_rate")
            audit.equal(observed.get("average_return_pct"), divide(expected["return_sum"], expected["samples"]), f"{label}.{status}.average_return")


def audit_calendar(audit, summary, data_dir):
    audit.equal(summary.get("timezone"), "Asia/Shanghai", "summary.timezone")
    calendar = summary["calendar"]
    audit.equal([year["year"] for year in calendar], list(range(1990, 2036)), "calendar year coverage")
    lookup = {}
    for year in calendar:
        audit.equal(year["pillar"], annual_pillar(year["year"]), f"calendar {year['year']} annual pillar")
        audit.equal(len(year["months"]), 12, f"calendar {year['year']} months")
        intervals = [("annual", year)] + [("monthly", month) for month in year["months"]]
        for kind, period in intervals:
            key = (kind, year["year"], period.get("month_index", period.get("index", 0)))
            start, end = timestamp(period_time(period, "start")), timestamp(period_time(period, "end"))
            audit.check(end > start, f"calendar {key}: nonpositive duration")
            for side, seconds in (("start", start), ("end", end)):
                if f"{side}_ms" in period:
                    audit.equal(period[f"{side}_ms"], seconds * 1000, f"calendar {key}.{side}_ms", tolerance=0.001)
                if f"{side}_utc" in period:
                    audit.equal(timestamp(period[f"{side}_utc"]), seconds, f"calendar {key}.{side}_utc", tolerance=0.001)
            lookup[key] = (period, start, end)
        months = year["months"]
        audit.equal(period_time(months[0], "start"), period_time(year, "start"), "first month boundary")
        audit.equal(period_time(months[-1], "end"), period_time(year, "end"), "last month boundary")
        for previous, next_month in zip(months, months[1:]):
            audit.equal(period_time(previous, "end"), period_time(next_month, "start"), "adjacent month boundaries")
    external = data_dir / "calendar.json"
    if external.exists():
        data = read_json(external)
        audit.equal(data.get("timezone"), "Asia/Shanghai", "calendar.json timezone")
        audit.equal(len(data.get("years", [])), 46, "calendar.json year count")
    return lookup


def audit_kline(audit, kline, label, effective, last_date, start=None, end=None):
    if kline is None:
        return
    audit.equal(len(kline), 9, f"{label} compact kline fields")
    if len(kline) != 9:
        return
    o, h, low, close, ret, direction, sessions, first, last = kline
    audit.check(all(isinstance(x, (float, int)) and math.isfinite(x) and x > 0 for x in (o, h, low, close)), f"{label} positive finite OHLC")
    audit.check(low <= min(o, close) <= max(o, close) <= h, f"{label} OHLC order")
    audit.check(effective <= first <= last <= last_date, f"{label} price dates {first}..{last} outside {effective}..{last_date}")
    audit.check(isinstance(sessions, int) and sessions > 0, f"{label} session count")
    if o > 0:
        audit.equal(ret, (close / o - 1) * 100, f"{label} candle return")
        audit.equal(direction, "up" if close > o else "down" if close < o else "neutral", f"{label} candle direction")
    if start is not None:
        audit.check(start <= timestamp(first + "T09:30:00") < end, f"{label} first session outside solar period")
        audit.check(start <= timestamp(last + "T09:30:00") < end, f"{label} last session outside solar period")


def audit_row(audit, stock, row, kind, lookup, forecast=False):
    key = (kind, row["year"], row.get("month_index", 0))
    label = f"{stock['ticker']} {'forecast ' if forecast else ''}{key}"
    period, start, end = lookup[key]
    audit.equal(row["pillar"], period["pillar"], f"{label} pillar")
    cal = row["calculation"]
    segments = cal["segments"]
    audit.equal(sum(segment[1] for segment in segments), 1, f"{label} segment weights", tolerance=1e-9)
    for segment in segments:
        audit.check(0 < segment[1] <= 1, f"{label} invalid segment weight")
        audit.equal(segment[2], period_score(stock["main_god"], segment[0]), f"{label} frozen segment score", tolerance=1e-9)
    weighted = sum(segment[1] * segment[2] for segment in segments)
    audit.equal(cal["big_luck"], weighted, f"{label} weighted luck", tolerance=1e-9)
    audit.equal(cal["annual"], period_score(stock["main_god"], annual_pillar(row["year"])), f"{label} annual score", tolerance=1e-9)
    if kind == "monthly":
        audit.equal(cal["month"], period_score(stock["main_god"], row["pillar"]), f"{label} month score", tolerance=1e-9)
    score = recompute_score(stock["main_god"], row, kind)
    audit.equal(row["total_score"], score, f"{label} frozen total formula", tolerance=1e-9)
    # Stored scores are rounded before classifying, just as in the US builder.
    audit.equal(row["status"], status_for(row["total_score"]), f"{label} status")
    audit.equal(row["predicted_direction"], STATUS_DIRECTION[row["status"]], f"{label} direction")
    if forecast:
        audit.equal(row.get("complete"), False, f"{label} forecast must be incomplete")
        for field in ("period_kline", "calendar_kline", "sync", "calendar_sync", "actual_direction", "return_pct", "hit"):
            audit.equal(row.get(field), None, f"{label} must contain no realized {field}")
        audit.counts[f"forecast_{kind}"] += 1
        return
    effective, last_date = stock["effective_price_start_date"], stock["last_price_date"]
    listing_time = stock.get("listing_time_local", stock.get("time_et", "09:30:00"))
    listing = timestamp(stock["listing_date"] + "T" + listing_time)
    first_open, last_close = timestamp(effective + "T09:30:00"), timestamp(last_date + "T15:00:00")
    kline = row.get("period_kline")
    complete = bool(kline) and start >= max(listing, first_open) and end <= last_close
    audit.equal(row["complete"], complete, f"{label} complete sample rule")
    predicted = row["predicted_direction"]
    expected_sync = (predicted == kline[5]) if complete and predicted != "neutral" else None
    audit.equal(row.get("sync"), expected_sync, f"{label} sync")
    audit_kline(audit, kline, label, effective, last_date, start, end)
    audit_kline(audit, row.get("calendar_kline"), label + " calendar", effective, last_date)
    audit.check(end > listing and start < last_close, f"{label} history period lies outside observation")
    audit.counts[f"history_{kind}"] += 1


def reverse_stats(main, rows):
    c = Counter()
    for row in rows:
        if not row["complete"] or not row.get("period_kline") or row["period_kline"][5] == "neutral":
            continue
        actual = row["period_kline"][5]
        predicted = STATUS_DIRECTION[status_for(recompute_score(main, row, "annual"))]
        c["n"] += 1
        c[actual] += 1
        c["hits"] += predicted == actual
        c["neutral"] += predicted == "neutral"
        c[f"{actual}_hits"] += predicted == actual
    c["explicit"] = c["n"] - c["neutral"]
    return c


def audit_reverse(audit, stock, annual):
    label = stock["ticker"] + " reverse"
    candidates = stock["reverse_candidate_ranking"]
    audit.equal(len(candidates), 10, f"{label} candidate count")
    audit.equal(sorted(candidate["main_god"] for candidate in candidates), sorted(STEMS), f"{label} candidate stems")
    stats = {stem: reverse_stats(stem, annual) for stem in STEMS}
    baseline = stats[stock["main_god"]]
    sufficient = baseline["n"] >= 8 and baseline["up"] >= 3 and baseline["down"] >= 3
    qualified = []
    for candidate in candidates:
        stem = candidate["main_god"]
        c = stats[stem]
        for field, value in (("annual_directional_samples", c["n"]), ("annual_actual_up", c["up"]),
                             ("annual_actual_down", c["down"]), ("annual_neutral_predictions", c["neutral"]),
                             ("annual_explicit_predictions", c["explicit"]),
                             ("annual_hit_rate_excluding_neutral", divide(c["hits"], c["explicit"])),
                             ("annual_full_accuracy", divide(c["hits"], c["n"])),
                             ("annual_direction_coverage", divide(c["explicit"], c["n"])),
                             ("annual_eligible", sufficient), ("monthly_eligible", False),
                             ("selection_mode", "annual_only")):
            audit.equal(candidate.get(field), value, f"{label} {stem}.{field}")
        ordinary = bool(sufficient and c["explicit"] and baseline["explicit"] and
                        c["hits"] * baseline["explicit"] > baseline["hits"] * c["explicit"])
        full = sufficient and c["hits"] >= baseline["hits"]
        coverage = sufficient and c["explicit"] >= baseline["explicit"]
        qualifies = ordinary and full and coverage and stem != stock["main_god"]
        for field, value in (("passes_ordinary_hit_rate_gate", ordinary), ("passes_full_accuracy_gate", full),
                             ("passes_direction_coverage_gate", coverage), ("passes_improvement_gate", qualifies),
                             ("is_algorithm_main_god", stem == stock["main_god"]),
                             ("is_selected", stem == stock["reverse_main_god"])):
            audit.equal(candidate.get(field), value, f"{label} {stem}.{field}")
        if qualifies:
            qualified.append(stem)
    def ranking_values(stem):
        c = stats[stem]
        up_recall, down_recall = divide(c["up_hits"], c["up"]), divide(c["down_hits"], c["down"])
        values = (divide(c["hits"], c["explicit"]), divide(c["hits"], c["n"]),
                  divide(c["explicit"], c["n"]),
                  None if up_recall is None or down_recall is None else (up_recall + down_recall) / 2,
                  None if up_recall is None or down_recall is None else min(up_recall, down_recall))
        return values
    def compare_candidates(left, right):
        # The US model deliberately treats differences <= 1e-12 as ties.
        # Example: (.8 + .4) / 2 is .6000000000000001 in binary floats,
        # whereas (.6 + .6) / 2 is .6. Their equal BA must defer to the
        # minimum-class recall, not let floating-point noise select a stem.
        for left_value, right_value in zip(ranking_values(left), ranking_values(right)):
            if left_value is None:
                if right_value is not None:
                    return 1
            elif right_value is None:
                return -1
            elif abs(left_value - right_value) > 1e-12:
                return -1 if left_value > right_value else 1
        return STEMS.index(left) - STEMS.index(right)
    ranking_key = cmp_to_key(compare_candidates)
    audit.equal([candidate["main_god"] for candidate in candidates],
                sorted(STEMS, key=ranking_key), f"{label} all candidate ranking")
    selected = sorted(qualified, key=ranking_key)[0] if qualified else stock["main_god"]
    sample_status = "no_data" if not baseline["n"] else "sufficient" if sufficient else "insufficient"
    audit.equal(stock["reverse_main_god"], selected, f"{label} selected stem")
    audit.equal(stock["reverse_replacement_applied"], bool(qualified), f"{label} replacement")
    audit.equal(stock["reverse_qualified_candidate_count"], len(qualified), f"{label} qualified count")
    audit.equal(stock["reverse_sample_status"], sample_status, f"{label} sample status")
    audit.equal(stock["reverse_selection_mode"], "annual_only", f"{label} selection mode")
    expected_status = "replaced" if qualified else {"no_data": "retained_no_data", "insufficient": "retained_insufficient_samples", "sufficient": "retained_no_qualified_candidate"}[sample_status]
    audit.equal(stock["reverse_selection_status"], expected_status, f"{label} selection status")
    for prefix, c in (("reverse", stats[selected]), ("algorithm", baseline)):
        for suffix, value in (("annual_hits", c["hits"]), ("annual_explicit_predictions", c["explicit"]),
                              ("annual_neutral_predictions", c["neutral"]),
                              ("annual_hit_rate_excluding_neutral", divide(c["hits"], c["explicit"])),
                              ("annual_full_accuracy", divide(c["hits"], c["n"])),
                              ("annual_direction_coverage", divide(c["explicit"], c["n"]))):
            audit.equal(stock.get(f"{prefix}_{suffix}"), value, f"{label} {prefix}_{suffix}")
    audit.counts["reverse_replacements"] += bool(qualified)
    audit.counts["reverse_candidates_checked"] += len(candidates)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_directory", type=Path)
    parser.add_argument("--expected-stocks", type=int, default=5221)
    parser.add_argument("--origins", type=Path, default=ROOT / "artifacts/a_share_daily/metadata/listing_origins.json")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    data_dir = args.output_directory.resolve()
    audit = Audit()
    index, summary = read_json(data_dir / "index.json"), read_json(data_dir / "summary.json")
    origins = {stock["ticker"]: stock for stock in read_json(args.origins)["stocks"]}
    stocks = index["stocks"]
    tickers = [stock["ticker"] for stock in stocks]
    audit.equal(index["stock_count"], args.expected_stocks, "index stock count")
    audit.equal(len(stocks), args.expected_stocks, "index rows")
    audit.equal(len(set(tickers)), len(tickers), "unique index tickers")
    audit.equal(set(tickers), set(origins), "current listed universe membership")
    audit.equal(summary["coverage"]["stock_count_with_prices"], args.expected_stocks, "summary stock count")
    lookup = audit_calendar(audit, summary, data_dir)
    cutoff = timestamp(index["data_cutoff"] + "T15:00:00")
    audit.equal(summary["coverage"]["data_cutoff"], index["data_cutoff"], "summary cutoff")
    expected_forecast_months = {(year, month) for (kind, year, month), (_, _, end) in lookup.items()
                                if kind == "monthly" and year >= 2026 and end > cutoff}
    metrics = {kind: Metric() for kind in ("annual", "monthly")}
    by_year, by_sector, by_basis = defaultdict(Metric), defaultdict(Metric), defaultdict(Metric)
    actual_paths = {str(path.relative_to(data_dir)) for path in (data_dir / "stocks").glob("*.json.gz")}
    expected_paths = {stock["data_path"] for stock in stocks}
    audit.equal(actual_paths, expected_paths, "gzip shard set")
    for position, index_stock in enumerate(stocks, 1):
        ticker = index_stock["ticker"]
        path = (data_dir / index_stock["data_path"]).resolve()
        audit.check(path.is_relative_to(data_dir), f"{ticker} shard path escapes data directory")
        if not path.is_relative_to(data_dir) or not path.exists():
            audit.check(False, f"{ticker} missing shard")
            continue
        payload = read_json(path)
        stock = payload["stock"]
        origin = origins[ticker]
        audit.equal(stock["ticker"], ticker, f"{ticker} payload ticker")
        for key in ("name", "listing_date", "bazi", "main_god", "effective_price_start_date"):
            audit.equal(stock[key], origin[key], f"{ticker} original input {key}")
        audit.check(stock["last_price_date"] <= index["data_cutoff"], f"{ticker} no prices after cutoff")
        if "timezone" in stock:
            audit.equal(stock["timezone"], "Asia/Shanghai", f"{ticker} timezone")
        for kind in ("annual", "monthly"):
            rows = payload[kind]
            identities = [(row["year"], row.get("month_index", 0)) for row in rows]
            audit.equal(len(set(identities)), len(identities), f"{ticker} unique {kind} periods")
            individual = Metric()
            for row in rows:
                audit_row(audit, stock, row, kind, lookup)
                for metric in (individual, metrics[kind], by_year[(row["year"], kind)],
                               by_sector[(stock["sector"], kind)], by_basis[(stock["listing_time_basis"], kind)]):
                    metric.add(row)
            c = individual.counts
            for suffix, value in (("samples", c["directional_samples"]), ("hits", c["hits"]),
                                  ("hit_rate", divide(c["hits"], c["directional_samples"])),
                                  ("complete_periods", c["complete_periods"]), ("neutral_periods", c["neutral_periods"])):
                audit.equal(index_stock.get(f"{kind}_{suffix}"), value, f"{ticker} index.{kind}_{suffix}")
        audit_reverse(audit, stock, payload["annual"])
        forecasts = payload.get("forecasts", {})
        annual_forecast, monthly_forecast = forecasts.get("annual", []), forecasts.get("monthly", [])
        audit.equal([row["year"] for row in annual_forecast], list(range(2026, 2036)), f"{ticker} annual forecast horizon")
        audit.equal({(row["year"], row["month_index"]) for row in monthly_forecast}, expected_forecast_months, f"{ticker} monthly forecast horizon")
        audit.equal(len(monthly_forecast), len(expected_forecast_months), f"{ticker} forecast monthly uniqueness")
        for kind in ("annual", "monthly"):
            for row in forecasts.get(kind, []):
                audit_row(audit, stock, row, kind, lookup, forecast=True)
                if kind == "monthly":
                    audit.check(lookup[(kind, row["year"], row["month_index"])][2] > cutoff, f"{ticker} completed month labeled forecast")
        audit.counts["stocks"] += 1
        if position % 500 == 0 or position == len(stocks):
            print(json.dumps({"progress": position, "stocks": len(stocks), "errors": audit.error_count}), flush=True)
    for kind, metric in metrics.items():
        metric.audit(audit, summary[f"{kind}_metrics"], f"summary.{kind}_metrics")
        for suffix, count in (("rows", metric.counts["total_periods"]), ("complete_periods", metric.counts["complete_periods"])):
            audit.equal(summary["coverage"].get(f"{kind}_{suffix}"), count, f"coverage.{kind}_{suffix}")
        baseline = summary["baselines"][f"{kind}_always_up"]
        for field, value in (("same_evaluable_samples", metric.counts["directional_samples"]),
                             ("same_evaluable_hits", metric.counts["actual_up_directional"]),
                             ("same_evaluable_hit_rate", divide(metric.counts["actual_up_directional"], metric.counts["directional_samples"])),
                             ("all_complete_samples", metric.counts["complete_periods"]),
                             ("all_complete_hits", metric.counts["actual_up_periods"]),
                             ("all_complete_hit_rate", divide(metric.counts["actual_up_periods"], metric.counts["complete_periods"]))):
            audit.equal(baseline[field], value, f"baseline {kind}.{field}")
    for group, source, field in (("by_year", by_year, "year"), ("by_sector", by_sector, "sector"), ("basis_breakdown", by_basis, "listing_time_basis")):
        for entry in summary[group]:
            for kind in ("annual", "monthly"):
                source[(entry[field], kind)].audit(audit, entry[kind], f"{group}.{entry[field]}.{kind}")
    report = {
        "status": "passed" if not audit.error_count else "failed",
        "generated_at": datetime.now(SHANGHAI).isoformat(timespec="seconds"),
        "data_directory": (f"public/data/{data_dir.name}" if data_dir.parent.name == "data"
                           else data_dir.name), "timezone": "Asia/Shanghai",
        "data_cutoff": index["data_cutoff"], "check_count": audit.check_count,
        "counts": dict(audit.counts), "error_count": audit.error_count,
        "errors_first_100": audit.errors,
        "coverage": ["universe and gzip completeness", "Shanghai calendar and epoch consistency",
                     "frozen input and scoring formula", "no prelisting or postcutoff prices",
                     "complete-period and sync rules", "independent reverse candidate gates and selection",
                     "original-model forecast horizon and no realized-price leakage",
                     "index/global/year/sector/basis metrics and always-up baselines"],
    }
    report_path = args.report or data_dir / "validation.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not audit.error_count else 1


if __name__ == "__main__":
    sys.exit(main())
