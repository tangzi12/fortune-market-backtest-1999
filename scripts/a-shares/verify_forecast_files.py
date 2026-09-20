#!/usr/bin/env python3
"""Independently compare each yearly forecast download to all stock shards."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read_json(path: Path):
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8") as stream:
            return json.load(stream)
    return json.loads(path.read_text(encoding="utf-8"))


def digest(value) -> str:
    body = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=ROOT / ".work/a-share-pages/public/data/a-shares")
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts/a_share_fortune_inputs/validation/forecast_files.json")
    args = parser.parse_args()
    index = read_json(args.data_dir / "index.json")
    summary = read_json(args.data_dir / "summary.json")
    errors = []
    checks = 0
    years = list(range(2026, 2036))

    def check(condition, detail):
        nonlocal checks
        checks += 1
        if not condition:
            errors.append(detail)

    ids = [row["ticker"] for row in index["stocks"]]
    universe = set(ids)
    check(len(ids) == len(universe) == 5221, {"error": "index_universe", "rows": len(ids), "unique": len(universe)})
    check(len(list((args.data_dir / "forecasts").glob("*.json.gz"))) == 10, {"error": "year_file_count"})
    expected_hashes = {year: {} for year in years}
    source_annual_count = 0
    source_monthly_count = 0
    by_year = {year: {"annual": 0, "monthly": 0, "up": 0, "down": 0, "neutral": 0} for year in years}

    for item in index["stocks"]:
        ticker = item["ticker"]
        shard = read_json(args.data_dir / item["data_path"])
        stock = shard["stock"]
        forecasts = shard["forecasts"]
        check(stock["ticker"] == ticker, {"error": "shard_id", "ticker": ticker})
        annual = {row["year"]: row for row in forecasts["annual"]}
        check(len(annual) == len(forecasts["annual"]) == 10 and set(annual) == set(years), {"error": "annual_years", "ticker": ticker})
        source_annual_count += len(forecasts["annual"])
        source_monthly_count += len(forecasts["monthly"])
        for row in forecasts["annual"] + forecasts["monthly"]:
            check(row["model"] == "frozen_original_main_god" and row["complete"] is False and row["sync"] is None and row["period_kline"] is None and row["calendar_kline"] is None,
                  {"error": "forecast_not_unverified", "ticker": ticker, "year": row["year"], "month": row.get("month_index")})
            check(row["forecast_as_of"] == "2026-09-18", {"error": "forecast_as_of", "ticker": ticker})
        for year in years:
            months = [row for row in forecasts["monthly"] if row["year"] == year]
            expected_months = list(range(8, 13)) if year == 2026 else list(range(1, 13))
            check([row["month_index"] for row in months] == expected_months, {"error": "monthly_indices", "ticker": ticker, "year": year})
            expected = {"ticker": ticker, "name": stock["name"], "board": stock["index_membership"],
                        "main_god": stock["main_god"], "annual": annual.get(year), "monthly": months}
            expected_hashes[year][ticker] = digest(expected)
            by_year[year]["annual"] += 1
            by_year[year]["monthly"] += len(months)
            by_year[year][annual[year]["predicted_direction"]] += 1

    yearly_results = []
    for year in years:
        path = args.data_dir / "forecasts" / f"{year}.json.gz"
        payload = read_json(path)
        rows = payload["stocks"]
        actual_ids = [row["ticker"] for row in rows]
        counts = Counter(actual_ids)
        check(payload["year"] == year and payload["as_of"] == "2026-09-18" and payload["model"] == "frozen_original_main_god", {"error": "year_metadata", "year": year})
        check(set(actual_ids) == universe and len(actual_ids) == 5221, {"error": "year_universe", "year": year, "rows": len(rows), "missing": sorted(universe - set(actual_ids)), "extra": sorted(set(actual_ids) - universe)})
        check(all(count == 1 for count in counts.values()), {"error": "duplicate_ids", "year": year})
        matching = 0
        for row in rows:
            ticker = row["ticker"]
            matches = digest(row) == expected_hashes[year].get(ticker)
            check(matches, {"error": "stock_forecast_mismatch", "year": year, "ticker": ticker})
            matching += int(matches)
        summary_year = next((row for row in summary["forecast"]["by_year"] if row["year"] == year), {})
        check(all(summary_year.get(key) == by_year[year][key] for key in ("up", "down", "neutral")), {"error": "summary_direction_counts", "year": year})
        yearly_results.append({"year": year, "stock_rows": len(rows), "unique_tickers": len(counts), "matching_stock_forecasts": matching,
                               "monthly_rows": sum(len(row["monthly"]) for row in rows), "directions": {key: by_year[year][key] for key in ("up", "down", "neutral")},
                               "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    check(summary["forecast"]["annual_rows"] == source_annual_count, {"error": "annual_summary_total"})
    check(summary["forecast"]["monthly_rows"] == source_monthly_count, {"error": "monthly_summary_total"})
    result = {
        "status": "passed" if not errors else "failed", "checked_at": datetime.now(timezone.utc).isoformat(),
        "stock_count": len(ids), "year_file_count": len(yearly_results), "checks": checks,
        "annual_forecasts": source_annual_count, "monthly_forecasts": source_monthly_count,
        "comparison": "Canonical SHA256 of complete ticker/name/board/main_god/annual/monthly object; dictionary key order ignored, all values and monthly order preserved.",
        "yearly_files": yearly_results, "mismatch_count": len(errors), "mismatches": errors,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in result.items() if key not in ("yearly_files", "mismatches")}, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
