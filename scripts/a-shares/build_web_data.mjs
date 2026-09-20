#!/usr/bin/env node

/**
 * Build sharded, browser-ready historical validation data for the listing-BaZi
 * model.  This is a fixed-rule backtest: it does not fit or tune any parameter.
 */

import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const config = {
  source: "tdx_a_share_daily",
  queryStart: "1990-01-01", cutoffDate: "2026-09-18",
  startYear: 1990, endYear: 2035, timezone: "Asia/Shanghai",
  inputDir: resolve(process.env.ASHARE_INPUT_DIR || join(root, "artifacts/a_share_fortune_inputs")),
  outputDir: resolve(process.env.ASHARE_OUTPUT_DIR || join(root, "public/data/a-shares")),
};
config.inputPath = join(config.inputDir, "model_input.json");
config.stockOutputDir = join(config.outputDir, "stocks");

const nyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: config.timezone,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hourCycle: "h23",
});

const GANS = "甲乙丙丁戊己庚辛壬癸";
const REVERSE_MAIN_GOD_LABEL = "K线逆推（样本内）";
const REVERSE_SELECTION_MODE = "annual_only";
const REVERSE_ANNUAL_MIN_SAMPLES = 8;
const REVERSE_ANNUAL_MIN_PER_CLASS = 3;
const REVERSE_NEAR_TIE_MARGIN = 0.02;
const REVERSE_TIE_EPSILON = 1e-12;
const ZHIS = "子丑寅卯辰巳午未申酉戌亥";
const JIAZI = Array.from({ length: 60 }, (_, index) => (
  GANS[index % GANS.length] + ZHIS[index % ZHIS.length]
));
const STEM_INFO = {
  甲: ["木", "阳"], 乙: ["木", "阴"], 丙: ["火", "阳"], 丁: ["火", "阴"], 戊: ["土", "阳"],
  己: ["土", "阴"], 庚: ["金", "阳"], 辛: ["金", "阴"], 壬: ["水", "阳"], 癸: ["水", "阴"],
};
const GENERATES = { 木: "火", 火: "土", 土: "金", 金: "水", 水: "木" };
const CONTROLS = { 木: "土", 土: "水", 水: "火", 火: "金", 金: "木" };
const FIVE_COMBOS = new Map([
  ["甲己", ["甲己合土", "土"]], ["乙庚", ["乙庚合金", "金"]], ["丙辛", ["丙辛合水", "水"]],
  ["丁壬", ["丁壬合木", "木"]], ["戊癸", ["戊癸合火", "火"]],
]);
const LONGSHENG = {
  甲: zip("亥子丑寅卯辰巳午未申酉戌", "长生 沐浴 冠带 临官 帝旺 衰 病 死 墓 绝 胎 养"),
  乙: zip("午巳辰卯寅丑子亥戌酉申未", "长生 沐浴 冠带 临官 帝旺 衰 病 死 墓 绝 胎 养"),
  丙: zip("寅卯辰巳午未申酉戌亥子丑", "长生 沐浴 冠带 临官 帝旺 衰 病 死 墓 绝 胎 养"),
  丁: zip("酉申未午巳辰卯寅丑子亥戌", "长生 沐浴 冠带 临官 帝旺 衰 病 死 墓 绝 胎 养"),
  戊: zip("寅卯辰巳午未申酉戌亥子丑", "长生 沐浴 冠带 临官 帝旺 衰 病 死 墓 绝 胎 养"),
  己: zip("酉申未午巳辰卯寅丑子亥戌", "长生 沐浴 冠带 临官 帝旺 衰 病 死 墓 绝 胎 养"),
  庚: zip("巳午未申酉戌亥子丑寅卯辰", "长生 沐浴 冠带 临官 帝旺 衰 病 死 墓 绝 胎 养"),
  辛: zip("子亥戌酉申未午巳辰卯寅丑", "长生 沐浴 冠带 临官 帝旺 衰 病 死 墓 绝 胎 养"),
  壬: zip("申酉戌亥子丑寅卯辰巳午未", "长生 沐浴 冠带 临官 帝旺 衰 病 死 墓 绝 胎 养"),
  癸: zip("卯寅丑子亥戌酉申未午巳辰", "长生 沐浴 冠带 临官 帝旺 衰 病 死 墓 绝 胎 养"),
};
const STATE_SCORES = {
  帝旺: 5, 临官: 4, 长生: 3, 冠带: 3, 养: 2, 胎: 1,
  沐浴: 0, 衰: -1, 病: -2, 死: -3, 墓: -4, 绝: -5,
};
const STATUS_ORDER = ["强势偏涨", "偏涨", "中性震荡", "偏跌", "弱势偏跌"];
const BASIS_CONFIDENCE = {
  "常规开盘代理": { group: "常规开盘代理", confidence: "medium" },
  "精确首笔": { group: "精确首笔", confidence: "high" },
  "股类开盘": { group: "股类开盘", confidence: "medium_high" },
  "常规开盘": { group: "常规开盘", confidence: "medium" },
  "行情起点*": { group: "行情起点代理", confidence: "low_proxy" },
};

const input = JSON.parse(await readFile(config.inputPath, "utf8"));
const calendar = JSON.parse(await readFile(join(config.inputDir, "calendar.json"), "utf8"));
const coverageInput = JSON.parse(await readFile(join(config.inputDir, "coverage.json"), "utf8"));
const inputManifest = JSON.parse(await readFile(join(config.inputDir, "summary.json"), "utf8"));
const forecastCounts = { annual: 0, monthly: 0 };
const forecastByYear = new Map();
const forecastYearRows = new Map();
const annualPillarByYear = new Map(
  calendar.years.map((flowYear) => [flowYear.year, flowYear.pillar]),
);

const stocks = input.stocks.toSorted((left, right) => left.ticker.localeCompare(right.ticker));
const chartByTicker = new Map(input.charts.map((chart) => [chart.ticker, hydrateChart(chart)]));
const expectedStockCount = Number(input.metadata?.stock_count || stocks.length);
if (stocks.length !== expectedStockCount || chartByTicker.size !== expectedStockCount) {
  throw new Error(`Unexpected stock/chart count: ${stocks.length}/${chartByTicker.size}`);
}
for (const stock of stocks) validateLuckChart(stock, chartByTicker.get(stock.ticker));

await mkdir(config.stockOutputDir, { recursive: true });
await removeStaleStockPayloads(
  config.stockOutputDir,
  new Set(stocks.map((stock) => `${stock.ticker}.json.gz`)),
);
const globalAnnual = createMetric();
const globalMonthly = createMetric();
const annualByYear = new Map();
const monthlyByYear = new Map();
const annualBySector = new Map();
const monthlyBySector = new Map();
const annualByBasis = new Map();
const monthlyByBasis = new Map();
const basisStockCounts = new Map();
const indexStocks = [];
const qaSamples = {};
const dataQuality = {
  raw_rows: 0,
  valid_rows: 0,
  invalid_ohlc_rows: 0,
  adjustment_fallback_rows: 0,
  adjustment_fallback_tickers: [],
  duplicate_trading_dates: 0,
  stocks_without_prices: [],
  price_quality_censored_tickers: [],
  price_quality_censored_annual_periods: 0,
  price_quality_censored_monthly_periods: 0,
};

{
  const coverage = new Map(Object.entries(coverageInput));
  console.log(JSON.stringify({
    event: "fortune_backtest_started",
    stocks: stocks.length,
    calendarYears: calendar.years.length,
    outputDir: config.outputDir,
  }));

  for (let stockIndex = 0; stockIndex < stocks.length; stockIndex += 1) {
    const stock = stocks[stockIndex];
    const basis = basisInfo(stock.basis);
    basisStockCounts.set(basis.group, (basisStockCounts.get(basis.group) || 0) + 1);
    const coverageRow = coverage.get(stock.ticker);
    if (!coverageRow) {
      throw new Error(`Missing local price coverage for ${stock.ticker}`);
    }
    dataQuality.raw_rows += number(coverageRow.raw_rows);
    dataQuality.valid_rows += number(coverageRow.valid_rows);
    dataQuality.invalid_ohlc_rows += number(coverageRow.invalid_ohlc_rows);
    dataQuality.adjustment_fallback_rows += number(coverageRow.adjustment_fallback_rows);
    if (number(coverageRow.adjustment_fallback_rows) > 0) {
      dataQuality.adjustment_fallback_tickers.push({
        ticker: stock.ticker,
        rows: number(coverageRow.adjustment_fallback_rows),
      });
    }

    const prices = await loadPrices(stock.ticker);
    const duplicateDates = countDuplicateDates(prices);
    dataQuality.duplicate_trading_dates += duplicateDates;
    const result = buildStockPayload(stock, chartByTicker.get(stock.ticker), prices, basis);
    if (result.payload.stock.price_quality_valid_from) {
      dataQuality.price_quality_censored_tickers.push({
        ticker: stock.ticker,
        valid_from: result.payload.stock.price_quality_valid_from,
        raw_first_price_date: result.payload.stock.raw_first_price_date,
        effective_price_start_date: result.payload.stock.effective_price_start_date,
      });
      dataQuality.price_quality_censored_annual_periods += result.payload.annual.filter(
        (row) => row.exclusion_reason === "left_censored_by_price_quality_policy",
      ).length;
      dataQuality.price_quality_censored_monthly_periods += result.payload.monthly.filter(
        (row) => row.exclusion_reason === "left_censored_by_price_quality_policy",
      ).length;
    }
    result.payload.forecasts = buildForecasts(stock, chartByTicker.get(stock.ticker));
    forecastCounts.annual += result.payload.forecasts.annual.length;
    forecastCounts.monthly += result.payload.forecasts.monthly.length;
    for (const row of result.payload.forecasts.annual) {
      if (!forecastByYear.has(row.year)) forecastByYear.set(row.year, { year: row.year, up: 0, down: 0, neutral: 0 });
      forecastByYear.get(row.year)[row.predicted_direction] += 1;
      if (!forecastYearRows.has(row.year)) forecastYearRows.set(row.year, []);
      forecastYearRows.get(row.year).push({ ticker: stock.ticker, name: stock.name, board: stock.index_membership,
        main_god: stock.main_god, annual: row,
        monthly: result.payload.forecasts.monthly.filter(m => m.year === row.year),
      });
    }
    Object.assign(result.payload.stock, {
      timezone: config.timezone, listing_time_local: stock.time_et,
      origin_audit: stock.origin_audit || null,
      listing_date_alignment_status: stock.date_alignment_status || stock.origin_audit?.date_alignment_status || null,
      exact_first_trade_time_available: false,
    });
    validateReverseSelection(result.payload.stock);
    await writeGzipJson(
      join(config.stockOutputDir, `${stock.ticker}.json.gz`),
      result.payload,
    );
    const annualFinal = finalizeMetric(result.annualMetric);
    const monthlyFinal = finalizeMetric(result.monthlyMetric);

    mergeMetric(globalAnnual, result.annualMetric);
    mergeMetric(globalMonthly, result.monthlyMetric);
    mergeMetric(metricAt(annualByBasis, basis.group), result.annualMetric);
    mergeMetric(metricAt(monthlyByBasis, basis.group), result.monthlyMetric);
    mergeMetric(metricAt(annualBySector, stock.sector), result.annualMetric);
    mergeMetric(metricAt(monthlyBySector, stock.sector), result.monthlyMetric);
    for (const row of result.payload.annual) {
      updateMetric(metricAt(annualByYear, String(row.year)), row);
    }
    for (const row of result.payload.monthly) {
      updateMetric(metricAt(monthlyByYear, String(row.year)), row);
    }

    indexStocks.push({
      ticker: stock.ticker,
      timezone: config.timezone,
      forecast_2026_score: result.payload.forecasts.annual.find(row => row.year === 2026)?.total_score ?? null,
      forecast_2026_direction: result.payload.forecasts.annual.find(row => row.year === 2026)?.predicted_direction ?? null,
      forecast_2027_score: result.payload.forecasts.annual.find(row => row.year === 2027)?.total_score ?? null,
      forecast_2027_direction: result.payload.forecasts.annual.find(row => row.year === 2027)?.predicted_direction ?? null,
      name: stock.name,
      sector: stock.sector,
      index_membership: stock.index_membership,
      theme_membership: stock.theme_membership || [],
      security_type: stock.security_type || "stock",
      theme_role: stock.theme_role || null,
      listing_market: stock.listing_market || null,
      listing_date_basis_detail: stock.listing_date_basis_detail || null,
      listing_date_source: stock.listing_date_source || null,
      yahoo_first_trade_date: stock.yahoo_first_trade_date || null,
      current_venue_first_trade_date:
        result.payload.stock.current_venue_first_trade_date,
      first_us_exchange_trade_date:
        result.payload.stock.first_us_exchange_trade_date,
      predecessor_symbols: result.payload.stock.predecessor_symbols,
      price_quality_status: stock.price_quality_status || null,
      price_quality_event_date: stock.price_quality_event_date || null,
      price_quality_valid_from: result.payload.stock.price_quality_valid_from,
      price_quality_note: stock.price_quality_note || null,
      price_quality_source: stock.price_quality_source || null,
      raw_first_price_date: result.payload.stock.raw_first_price_date,
      effective_price_start_date:
        result.payload.stock.effective_price_start_date,
      listing_date: stock.listing_date,
      time_et: stock.time_et,
      first_luck_start_et: result.payload.stock.first_luck_start_et,
      bazi: stock.bazi,
      main_god: stock.main_god,
      reverse_main_god: result.payload.stock.reverse_main_god,
      reverse_second_main_god: result.payload.stock.reverse_second_main_god,
      reverse_main_god_label: result.payload.stock.reverse_main_god_label,
      reverse_selection_mode: result.payload.stock.reverse_selection_mode,
      reverse_fit_score: result.payload.stock.reverse_fit_score,
      reverse_fit_margin: result.payload.stock.reverse_fit_margin,
      reverse_fit_stability: result.payload.stock.reverse_fit_stability,
      reverse_replacement_applied:
        result.payload.stock.reverse_replacement_applied,
      reverse_selection_status: result.payload.stock.reverse_selection_status,
      reverse_qualified_candidate_count:
        result.payload.stock.reverse_qualified_candidate_count,
      reverse_annual_full_balanced_accuracy:
        result.payload.stock.reverse_annual_full_balanced_accuracy,
      reverse_monthly_full_balanced_accuracy:
        result.payload.stock.reverse_monthly_full_balanced_accuracy,
      reverse_directional_hit_rate: result.payload.stock.reverse_directional_hit_rate,
      reverse_min_class_recall: result.payload.stock.reverse_min_class_recall,
      reverse_neutral_rate: result.payload.stock.reverse_neutral_rate,
      reverse_full_accuracy: result.payload.stock.reverse_full_accuracy,
      reverse_annual_hits: result.payload.stock.reverse_annual_hits,
      reverse_annual_neutral_predictions:
        result.payload.stock.reverse_annual_neutral_predictions,
      reverse_annual_explicit_predictions:
        result.payload.stock.reverse_annual_explicit_predictions,
      reverse_annual_hit_rate_excluding_neutral:
        result.payload.stock.reverse_annual_hit_rate_excluding_neutral,
      reverse_annual_full_accuracy:
        result.payload.stock.reverse_annual_full_accuracy,
      reverse_annual_direction_coverage:
        result.payload.stock.reverse_annual_direction_coverage,
      reverse_annual_complete_periods:
        result.payload.stock.reverse_annual_complete_periods,
      reverse_monthly_complete_periods:
        result.payload.stock.reverse_monthly_complete_periods,
      reverse_annual_directional_samples:
        result.payload.stock.reverse_annual_directional_samples,
      reverse_monthly_directional_samples:
        result.payload.stock.reverse_monthly_directional_samples,
      reverse_annual_eligible: result.payload.stock.reverse_annual_eligible,
      reverse_monthly_eligible: result.payload.stock.reverse_monthly_eligible,
      reverse_sample_status: result.payload.stock.reverse_sample_status,
      reverse_matches_algorithm: result.payload.stock.reverse_matches_algorithm,
      reverse_main_god_matches_algorithm:
        result.payload.stock.reverse_main_god_matches_algorithm,
      algorithm_fit_score: result.payload.stock.algorithm_fit_score,
      algorithm_annual_full_balanced_accuracy:
        result.payload.stock.algorithm_annual_full_balanced_accuracy,
      algorithm_monthly_full_balanced_accuracy:
        result.payload.stock.algorithm_monthly_full_balanced_accuracy,
      algorithm_annual_hits: result.payload.stock.algorithm_annual_hits,
      algorithm_annual_neutral_predictions:
        result.payload.stock.algorithm_annual_neutral_predictions,
      algorithm_annual_explicit_predictions:
        result.payload.stock.algorithm_annual_explicit_predictions,
      algorithm_annual_hit_rate_excluding_neutral:
        result.payload.stock.algorithm_annual_hit_rate_excluding_neutral,
      algorithm_annual_full_accuracy:
        result.payload.stock.algorithm_annual_full_accuracy,
      algorithm_annual_direction_coverage:
        result.payload.stock.algorithm_annual_direction_coverage,
      listing_time_basis: basis.group,
      basis_confidence: basis.confidence,
      annual_hit_rate: annualFinal.hit_rate,
      monthly_hit_rate: monthlyFinal.hit_rate,
      annual_samples: result.annualMetric.directional_samples,
      monthly_samples: result.monthlyMetric.directional_samples,
      annual_complete_periods: annualFinal.complete_periods,
      annual_neutral_periods: annualFinal.neutral_periods,
      annual_hits: annualFinal.hits,
      monthly_complete_periods: monthlyFinal.complete_periods,
      monthly_neutral_periods: monthlyFinal.neutral_periods,
      monthly_hits: monthlyFinal.hits,
      data_path: `stocks/${stock.ticker}.json.gz`,
    });

    if (["AAPL", "COST", "META", "MU", "HONA"].includes(stock.ticker)) {
      qaSamples[stock.ticker] = result.payload;
    }
    if ((stockIndex + 1) % 25 === 0 || stockIndex + 1 === stocks.length) {
      console.log(JSON.stringify({
        event: "fortune_backtest_progress",
        completed: stockIndex + 1,
        stocks: stocks.length,
        annualRows: globalAnnual.total_periods,
        monthlyRows: globalMonthly.total_periods,
      }));
    }
  }
}

const annualMetrics = finalizeMetric(globalAnnual);
const monthlyMetrics = finalizeMetric(globalMonthly);
const universeCounts = Object.fromEntries(
  ["沪市主板", "深市主板", "创业板", "科创板"].map((indexName) => [
    indexName,
    indexStocks.filter((stock) => stock.index_membership.includes(indexName)).length,
  ]),
);
const themeCounts = Object.fromEntries(
  [...new Set(indexStocks.flatMap((stock) => stock.theme_membership || []))]
    .toSorted()
    .map((themeName) => [
      themeName,
      indexStocks.filter((stock) => stock.theme_membership?.includes(themeName)).length,
    ]),
);
const universeMetadata = input.metadata?.universe || {};
const summary = {
  generated_at: new Date().toISOString(),
  coverage: {
    source: config.source,
    requested_start: config.queryStart,
    data_cutoff: config.cutoffDate,
    start_year: config.startYear,
    end_year: 2026,
    stock_count_requested: stocks.length,
    stock_count_with_prices: indexStocks.length,
    price_rows: dataQuality.valid_rows,
    effective_price_rows: inputManifest.effective_rows,
    annual_rows: globalAnnual.total_periods,
    monthly_rows: globalMonthly.total_periods,
    annual_complete_periods: globalAnnual.complete_periods,
    monthly_complete_periods: globalMonthly.complete_periods,
    index_counts: universeCounts,
    theme_counts: themeCounts,
  },
  universe: {
    definition: (
      "S&P 500与Nasdaq-100当前成分股，加IWM当前可交易股票持仓代理，" +
      "再加当前大麻板块联合池"
    ),
    holdings_date: universeMetadata.russell_proxy_holdings_date ||
      universeMetadata.holdings_date || input.metadata?.holdings_date,
    union_stock_count: indexStocks.length,
    index_counts: universeCounts,
    theme_counts: themeCounts,
    russell2000_proxy_count: universeCounts["Russell 2000"],
    russell2000_source: input.metadata?.universe_sources?.find?.(
      (source) => source.id === "R1",
    ) || null,
    russell2000_proxy_definition: universeMetadata.russell_proxy_definition || null,
    russell2000_source_url: universeMetadata.russell_source_url || null,
    russell2000_source_sha256: universeMetadata.russell_source_sha256 || null,
    russell2000_raw_holding_rows: Number(
      universeMetadata.russell_raw_holding_rows || 0,
    ),
    russell2000_equity_rows: Number(universeMetadata.russell_equity_rows || 0),
    russell2000_tradable_unique_tickers: Number(
      universeMetadata.russell_tradable_unique_tickers || 0,
    ),
    russell2000_unavailable_count: Number(
      universeMetadata.russell_unavailable_count || 0,
    ),
    russell2000_unavailable: input.metadata?.unavailable_russell_holdings || [],
    russell2000_exchange_listing_snapshots:
      universeMetadata.russell_exchange_listing_snapshots || [],
    russell2000_price_quality_exclusions:
      universeMetadata.russell_price_quality_exclusions || {},
    cannabis_theme: universeMetadata.cannabis_theme || null,
    cannabis_as_of: universeMetadata.cannabis_as_of || null,
    cannabis_count: Number(universeMetadata.cannabis_count || 0),
    cannabis_added_count: Number(universeMetadata.cannabis_added_count || 0),
    cannabis_overlap_count: Number(universeMetadata.cannabis_overlap_count || 0),
    cannabis_etf_count: Number(universeMetadata.cannabis_etf_count || 0),
    cannabis_otc_count: Number(universeMetadata.cannabis_otc_count || 0),
    cannabis_definition: universeMetadata.cannabis_definition || null,
    cannabis_normalization: universeMetadata.cannabis_normalization || null,
    cannabis_exclusion_rule: universeMetadata.cannabis_exclusion_rule || null,
    cannabis_listing_date_rule:
      universeMetadata.cannabis_listing_date_rule || null,
    cannabis_price_integrity_rule:
      universeMetadata.cannabis_price_integrity_rule || null,
    cannabis_price_quality_policy:
      universeMetadata.cannabis_price_quality_policy || null,
    cannabis_price_audits:
      universeMetadata.cannabis_price_audits || [],
    cannabis_source_snapshots:
      universeMetadata.cannabis_source_snapshots || [],
    cannabis_excluded:
      input.metadata?.unavailable_cannabis_securities ||
      universeMetadata.cannabis_excluded || [],
  },
  annual_metrics: annualMetrics,
  monthly_metrics: monthlyMetrics,
  baselines: {
    annual_always_up: alwaysUpBaseline(globalAnnual),
    monthly_always_up: alwaysUpBaseline(globalMonthly),
  },
  reverse_main_god_fit: summarizeReverseFit(indexStocks),
  by_year: [...new Set([...annualByYear.keys(), ...monthlyByYear.keys()])]
    .toSorted((left, right) => Number(left) - Number(right))
    .map((year) => ({
      year: Number(year),
      annual: finalizeMetric(annualByYear.get(year) || createMetric()),
      monthly: finalizeMetric(monthlyByYear.get(year) || createMetric()),
    })),
  by_sector: [...new Set([...annualBySector.keys(), ...monthlyBySector.keys()])]
    .toSorted()
    .map((sector) => ({
      sector,
      annual: finalizeMetric(annualBySector.get(sector) || createMetric()),
      monthly: finalizeMetric(monthlyBySector.get(sector) || createMetric()),
    })),
  basis_breakdown: Object.values(BASIS_CONFIDENCE).map(({ group, confidence }) => ({
    listing_time_basis: group,
    confidence,
    stock_count: basisStockCounts.get(group) || 0,
    annual: finalizeMetric(annualByBasis.get(group) || createMetric()),
    monthly: finalizeMetric(monthlyByBasis.get(group) || createMetric()),
  })),
  calendar: calendar.years.map((flowYear) => ({
    year: flowYear.year,
    pillar: flowYear.pillar,
    start_et: flowYear.start_et,
    end_et: flowYear.end_et,
    boundary_intraday: isBoundaryIntraday(flowYear.start_et) || isBoundaryIntraday(flowYear.end_et),
    months: flowYear.months.map((month) => ({
      month_index: month.index,
      jie_name: month.jie_name,
      pillar: month.pillar,
      start_et: month.start_et,
      end_et: month.end_et,
      calendar_month: month.start_et.slice(0, 7),
      boundary_intraday: isBoundaryIntraday(month.start_et) || isBoundaryIntraday(month.end_et),
    })),
  })),
  data_quality: {
    ...dataQuality,
    incomplete_annual_periods: globalAnnual.total_periods - globalAnnual.complete_periods,
    incomplete_monthly_periods: globalMonthly.total_periods - globalMonthly.complete_periods,
    complete_annual_without_kline: globalAnnual.complete_without_kline,
    complete_monthly_without_kline: globalMonthly.complete_without_kline,
    jie_boundary_audit: calendar.boundary_audit,
    survivorship_bias: (
      `股票池是当前S&P 500与Nasdaq-100成分股，并以${
        universeMetadata.russell_proxy_holdings_date ||
        universeMetadata.holdings_date ||
        input.metadata?.holdings_date ||
        "未注明日期"
      } IWM可交易股票持仓` +
      "代理当前Russell 2000，并加入当前大麻主题联合池；历史验证存在幸存者偏差" +
      "与前视选择偏差，不代表历史时点" +
      "真实指数成分股组合。"
    ),
  },
  methodology: buildMethodology(input),
  regression_checks: {
    boundary_catalog: "348个节边界，67个落在工作日常规交易时段",
    aapl_1999_yin_month: "1.704 / 偏涨",
    meta_2012_wu_month: "-0.824 / 中性震荡",
    mu_2025_bailu_month: "-1.166801360234 / 偏跌，跨癸酉→甲戌",
    hona_2026_wei_month: "-0.12 / 中性震荡，无完整样本",
    meta_reverse_main_god: (
      `${qaSamples.META?.stock.reverse_main_god}（第二名` +
      `${qaSamples.META?.stock.reverse_second_main_god}，差值` +
      `${qaSamples.META?.stock.reverse_fit_margin}）`
    ),
  },
};
Object.assign(summary, {
  timezone: config.timezone,
  forecast: {
    as_of: config.cutoffDate, generated_at: summary.generated_at,
    start_year: 2026, end_year: 2035,
    annual_rows: forecastCounts.annual, monthly_rows: forecastCounts.monthly,
    by_year: [...forecastByYear.values()],
    model: "frozen_original_main_god",
    note: "未来信号仅使用冻结原主用神，未验证，未给出目标价；2026年为进行中周期。",
  },
  universe: {
    definition: "截至2026-09-18当前上市的沪深A股，含沪市主板、深市主板、创业板、科创板",
    holdings_date: config.cutoffDate, union_stock_count: indexStocks.length,
    index_counts: universeCounts, theme_counts: {},
  },
  calendar: calendar.years.map(y => ({ ...y, months: y.months.map(m => ({ ...m, month_index: m.index })) })),
  input_manifest: inputManifest,
  regression_checks: { validator: "validate_a_share_fortune_results.py", source_model: "US root-page frozen rules" },
});
summary.data_quality.survivorship_bias = "只含当前上市公司，回看历史存在存活者与前视选择偏差；未纳入退市股。";
summary.data_quality.excluded_pre_origin_rows = inputManifest.excluded_pre_origin_rows;
summary.data_quality.identity_audit = "上市日齐全；15只与行情首日不一致，已按较晚日期截断。全市场借壳/吸收合并/经营主体重置尚未逐一核实。";
summary.methodology = {
  ...summary.methodology,
  timezone: config.timezone,
  timestamp_aliases: "兼容字段time_et/start_et/end_et在本A股数据集中均为Asia/Shanghai当地民用时间；1990/1991使用历史夏令时。",
  universe: summary.universe,
  universe_scope: summary.universe,
  price_source: "通达信全市场日线与公司行动 + BaoStock当前上市股票名录",
  adjusted_price: "raw OHLC × 正的乘法复权因子；锚定2026-09-18，不使用可能为负的显示前复权价格。",
  primary_period_kline: "以交易日09:30上海当地时间所属节气周期分桶，start <= session_open < end；边界日整根日线归入开盘所在周期。",
  complete_sample: "周期起点不早于上市及可用行情起点，周期终点不晚于最后行情日15:00，且周期内有日线；不完整周期排除。",
  listing_time_basis_warning: "全部09:30均为常规开盘代理，无精确首笔成交时刻；上市日期来自供应商，并非全市场身份审计完成。",
  forecast_policy: summary.forecast.note,
};
await writeJson(join(config.outputDir, "calendar.json"), calendar);
await mkdir(join(config.outputDir, "forecasts"), {recursive: true});
for (const [year, rows] of forecastYearRows) {
  await writeGzipJson(join(config.outputDir, "forecasts", `${year}.json.gz`), {
    year, as_of: config.cutoffDate, model: "frozen_original_main_god", stocks: rows,
  });
}
const indexPayload = {
  generated_at: summary.generated_at,
  data_cutoff: config.cutoffDate,
  rate_scale: "0_to_1",
  stock_count: indexStocks.length,
  universe: summary.universe,
  stocks: indexStocks,
};
await Promise.all([
  writeJson(join(config.outputDir, "index.json"), indexPayload),
  writeJson(join(config.outputDir, "summary.json"), summary),
  writeGzipJson(join(config.outputDir, "index.json.gz"), indexPayload),
  writeGzipJson(join(config.outputDir, "summary.json.gz"), summary),
]);

const outputSize = await directorySize(config.outputDir);
console.log(JSON.stringify({
  event: "fortune_backtest_finished",
  outputDir: config.outputDir,
  stocks: indexStocks.length,
  annualRows: globalAnnual.total_periods,
  monthlyRows: globalMonthly.total_periods,
  annualComplete: globalAnnual.complete_periods,
  monthlyComplete: globalMonthly.complete_periods,
  annualDirectionalSamples: globalAnnual.directional_samples,
  monthlyDirectionalSamples: globalMonthly.directional_samples,
  annualHitRate: annualMetrics.hit_rate,
  monthlyHitRate: monthlyMetrics.hit_rate,
  adjustmentFallbackRows: dataQuality.adjustment_fallback_rows,
  outputBytes: outputSize,
  outputMiB: round(outputSize / 1024 / 1024, 3),
}, null, 2));

function buildStockPayload(stock, chart, prices, basis) {
  if (!chart) throw new Error(`Missing luck chart: ${stock.ticker}`);
  const listingMs = parseEt(stock.listing_date, stock.time_et);
  const rawFirstBarDate = prices[0]?.trading_date || "";
  const qualityValidFrom = stock.price_quality_valid_from || "";
  const qualityStartMs = qualityValidFrom
    ? parseEt(qualityValidFrom, "09:30:00")
    : -Infinity;
  const usablePrices = qualityValidFrom
    ? prices.filter((row) => row.trading_date >= qualityValidFrom)
    : prices;
  if (prices.length > 0 && usablePrices.length === 0) {
    throw new Error(
      `Price-quality policy removes every row for ${stock.ticker}: ${qualityValidFrom}`,
    );
  }
  const firstBarDate = usablePrices[0]?.trading_date || "";
  const lastBarDate = usablePrices.at(-1)?.trading_date || "";
  const observationStartMs = firstBarDate ? parseEt(firstBarDate, "09:30:00") : Infinity;
  const observationEndMs = lastBarDate ? parseEt(lastBarDate, "15:00:00") : 0;
  const natural = buildNaturalKlines(usablePrices);
  const annual = [];
  const monthly = [];
  const annualMetric = createMetric();
  const monthlyMetric = createMetric();

  for (const flowYear of calendar.years) {
    if (flowYear.end_ms <= listingMs || flowYear.start_ms >= observationEndMs) continue;
    const bigLuck = scoreLuckSegments(stock.main_god, chart, flowYear.start_ms, flowYear.end_ms);
    const flowScore = scorePeriod(stock.main_god, flowYear.pillar);
    const totalScore = 0.60 * bigLuck.weighted_score + 0.40 * flowScore.period_score;
    const normalizedTotalScore = round(totalScore, 12);
    const status = classify(normalizedTotalScore);
    const predictedDirection = statusDirection(status);
    const periodKline = periodKlineFor(usablePrices, flowYear.start_et, flowYear.end_et);
    const complete = Boolean(periodKline) &&
      flowYear.start_ms >= listingMs &&
      flowYear.start_ms >= observationStartMs &&
      flowYear.end_ms <= observationEndMs;
    const calendarKline = natural.years.get(String(flowYear.year)) || null;
    const calendarStartMs = parseEt(`${flowYear.year}-01-01`, "00:00:00");
    const calendarEndMs = parseEt(`${flowYear.year + 1}-01-01`, "00:00:00");
    const calendarComplete = Boolean(calendarKline) &&
      calendarStartMs >= listingMs &&
      calendarStartMs >= observationStartMs &&
      calendarEndMs <= observationEndMs;
    const row = {
      year: flowYear.year,
      pillar: flowYear.pillar,
      total_score: normalizedTotalScore,
      status,
      predicted_direction: predictedDirection,
      calculation: {
        big_luck: round(bigLuck.weighted_score, 12),
        segments: bigLuck.segments,
        annual: flowScore.period_score,
      },
      period_kline: periodKline,
      calendar_kline: calendarKline,
      sync: syncValue(predictedDirection, periodKline, complete),
      calendar_sync: syncValue(predictedDirection, calendarKline, calendarComplete),
      complete,
      ...optionalBoundaryFlag(flowYear.start_et, flowYear.end_et),
      ...optionalExclusion(
        complete,
        flowYear.start_ms,
        listingMs,
        observationStartMs,
        flowYear.end_ms,
        observationEndMs,
        periodKline,
        qualityStartMs,
      ),
    };
    annual.push(row);
    updateMetric(annualMetric, row);

    for (const flowMonth of flowYear.months) {
      if (flowMonth.end_ms <= listingMs || flowMonth.start_ms >= observationEndMs) continue;
      const monthBigLuck = scoreLuckSegments(stock.main_god, chart, flowMonth.start_ms, flowMonth.end_ms);
      const monthScore = scorePeriod(stock.main_god, flowMonth.pillar);
      const monthTotal = (
        0.36 * monthBigLuck.weighted_score +
        0.24 * flowScore.period_score +
        0.40 * monthScore.period_score
      );
      const normalizedMonthTotal = round(monthTotal, 12);
      const monthStatus = classify(normalizedMonthTotal);
      const monthDirection = statusDirection(monthStatus);
      const monthPeriodKline = periodKlineFor(
        usablePrices,
        flowMonth.start_et,
        flowMonth.end_et,
      );
      const monthComplete = Boolean(monthPeriodKline) &&
        flowMonth.start_ms >= listingMs &&
        flowMonth.start_ms >= observationStartMs &&
        flowMonth.end_ms <= observationEndMs;
      const calendarMonth = flowMonth.start_et.slice(0, 7);
      const monthCalendarKline = natural.months.get(calendarMonth) || null;
      const [calendarYear, calendarMonthNumber] = calendarMonth.split("-").map(Number);
      const nextCalendarMonth = calendarMonthNumber === 12
        ? `${calendarYear + 1}-01-01`
        : `${calendarYear}-${String(calendarMonthNumber + 1).padStart(2, "0")}-01`;
      const calendarMonthStartMs = parseEt(`${calendarMonth}-01`, "00:00:00");
      const calendarMonthEndMs = parseEt(nextCalendarMonth, "00:00:00");
      const calendarMonthComplete = (
        Boolean(monthCalendarKline) &&
        calendarMonthStartMs >= listingMs &&
        calendarMonthStartMs >= observationStartMs &&
        calendarMonthEndMs <= observationEndMs
      );
      const monthRow = {
        year: flowYear.year,
        month_index: flowMonth.index,
        jie_name: flowMonth.jie_name,
        pillar: flowMonth.pillar,
        total_score: normalizedMonthTotal,
        status: monthStatus,
        predicted_direction: monthDirection,
        calculation: {
          big_luck: round(monthBigLuck.weighted_score, 12),
          segments: monthBigLuck.segments,
          annual: flowScore.period_score,
          month: monthScore.period_score,
        },
        period_kline: monthPeriodKline,
        calendar_kline: monthCalendarKline,
        sync: syncValue(monthDirection, monthPeriodKline, monthComplete),
        calendar_sync: syncValue(monthDirection, monthCalendarKline, calendarMonthComplete),
        complete: monthComplete,
        ...optionalBoundaryFlag(flowMonth.start_et, flowMonth.end_et),
        ...optionalExclusion(
          monthComplete,
          flowMonth.start_ms,
          listingMs,
          observationStartMs,
          flowMonth.end_ms,
          observationEndMs,
          monthPeriodKline,
          qualityStartMs,
        ),
      };
      monthly.push(monthRow);
      updateMetric(monthlyMetric, monthRow);
    }
  }

  const reverseFit = fitReverseMainGod(stock.main_god, annual, monthly);

  return {
    payload: {
      stock: {
        ticker: stock.ticker,
        name: stock.name,
        sector: stock.sector,
        index_membership: stock.index_membership,
        theme_membership: stock.theme_membership || [],
        security_type: stock.security_type || "stock",
        theme_role: stock.theme_role || null,
        listing_market: stock.listing_market || null,
        listing_date_basis_detail: stock.listing_date_basis_detail || null,
        listing_date_source: stock.listing_date_source || null,
        yahoo_first_trade_date: stock.yahoo_first_trade_date || null,
        current_venue_first_trade_date:
          stock.current_venue_first_trade_date || null,
        first_us_exchange_trade_date:
          stock.first_us_exchange_trade_date || null,
        predecessor_symbols: stock.predecessor_symbols || [],
        price_quality_status: stock.price_quality_status || null,
        price_quality_event_date: stock.price_quality_event_date || null,
        price_quality_valid_from: qualityValidFrom || null,
        price_quality_note: stock.price_quality_note || null,
        price_quality_source: stock.price_quality_source || null,
        listing_date: stock.listing_date,
        time_et: stock.time_et,
        listing_time_basis: basis.group,
        listing_time_basis_raw: stock.basis,
        basis_confidence: basis.confidence,
        source_code: stock.source_code,
        listing_note: stock.note || "",
        bazi: stock.bazi,
        day_stem: stock.day_stem,
        month_branch: stock.month_branch,
        main_god: stock.main_god,
        reverse_main_god: reverseFit.main_god,
        reverse_second_main_god: reverseFit.second_main_god,
        reverse_main_god_label: REVERSE_MAIN_GOD_LABEL,
        reverse_selection_mode: REVERSE_SELECTION_MODE,
        reverse_fit_score: reverseFit.fit_score,
        reverse_fit_margin: reverseFit.fit_margin,
        reverse_fit_stability: reverseFit.fit_stability,
        reverse_replacement_applied: reverseFit.replacement_applied,
        reverse_selection_status: reverseFit.selection_status,
        reverse_qualified_candidate_count:
          reverseFit.qualified_candidate_count,
        reverse_annual_full_balanced_accuracy:
          reverseFit.annual_full_balanced_accuracy,
        reverse_monthly_full_balanced_accuracy:
          reverseFit.monthly_full_balanced_accuracy,
        reverse_directional_hit_rate: reverseFit.directional_hit_rate,
        reverse_min_class_recall: reverseFit.min_class_recall,
        reverse_neutral_rate: reverseFit.neutral_rate,
        reverse_full_accuracy: reverseFit.full_accuracy,
        reverse_annual_hits: reverseFit.annual_hits,
        reverse_annual_neutral_predictions:
          reverseFit.annual_neutral_predictions,
        reverse_annual_explicit_predictions:
          reverseFit.annual_explicit_predictions,
        reverse_annual_hit_rate_excluding_neutral:
          reverseFit.annual_hit_rate_excluding_neutral,
        reverse_annual_full_accuracy: reverseFit.annual_full_accuracy,
        reverse_annual_direction_coverage:
          reverseFit.annual_direction_coverage,
        reverse_annual_complete_periods: reverseFit.annual_complete_periods,
        reverse_monthly_complete_periods: reverseFit.monthly_complete_periods,
        reverse_annual_directional_samples: reverseFit.annual_directional_samples,
        reverse_monthly_directional_samples: reverseFit.monthly_directional_samples,
        reverse_annual_eligible: reverseFit.annual_eligible,
        reverse_monthly_eligible: reverseFit.monthly_eligible,
        reverse_sample_status: reverseFit.sample_status,
        reverse_matches_algorithm: reverseFit.matches_algorithm,
        reverse_main_god_matches_algorithm: reverseFit.matches_algorithm,
        algorithm_fit_score: reverseFit.algorithm_fit_score,
        algorithm_annual_full_balanced_accuracy:
          reverseFit.algorithm_annual_full_balanced_accuracy,
        algorithm_monthly_full_balanced_accuracy:
          reverseFit.algorithm_monthly_full_balanced_accuracy,
        algorithm_annual_hits: reverseFit.algorithm_annual_hits,
        algorithm_annual_neutral_predictions:
          reverseFit.algorithm_annual_neutral_predictions,
        algorithm_annual_explicit_predictions:
          reverseFit.algorithm_annual_explicit_predictions,
        algorithm_annual_hit_rate_excluding_neutral:
          reverseFit.algorithm_annual_hit_rate_excluding_neutral,
        algorithm_annual_full_accuracy:
          reverseFit.algorithm_annual_full_accuracy,
        algorithm_annual_direction_coverage:
          reverseFit.algorithm_annual_direction_coverage,
        reverse_candidate_ranking: reverseFit.candidate_ranking,
        auxiliary_gods: stock.auxiliary_gods,
        luck_direction: chart.direction,
        first_luck_start_et: chart.first_luck_start_et,
        first_price_date: firstBarDate,
        raw_first_price_date: rawFirstBarDate,
        effective_price_start_date: firstBarDate,
        last_price_date: lastBarDate,
        adjustment_fallback_rows: prices.filter((row) => row.adjustment_fallback).length,
      },
      annual,
      monthly,
    },
    annualMetric,
    monthlyMetric,
  };
}

function fitReverseMainGod(algorithmMainGod, annualRows, monthlyRows) {
  const annualCompletePeriods = countCompletePeriods(annualRows);
  const monthlyCompletePeriods = countCompletePeriods(monthlyRows);
  const candidates = [...GANS].map((mainGod) => {
    const annual = evaluateReverseRows(
      annualRows,
      (row) => reverseAnnualDirection(mainGod, row),
    );
    const monthly = evaluateReverseRows(
      monthlyRows,
      (row) => reverseMonthlyDirection(mainGod, row),
    );
    const annualEligible = (
      annual.full_balanced_accuracy_raw !== null &&
      annual.directional_samples >= REVERSE_ANNUAL_MIN_SAMPLES &&
      annual.actual_up >= REVERSE_ANNUAL_MIN_PER_CLASS &&
      annual.actual_down >= REVERSE_ANNUAL_MIN_PER_CLASS
    );
    const minClassRecallRaw = annual.full_balanced_accuracy_raw !== null
      ? Math.min(annual.up_recall_raw, annual.down_recall_raw)
      : null;
    const annualExplicitPredictions = (
      annual.directional_samples - annual.neutral_predictions
    );
    const annualHitRateExcludingNeutralRaw = rawDivide(
      annual.hits,
      annualExplicitPredictions,
    );
    const annualDirectionCoverageRaw = rawDivide(
      annualExplicitPredictions,
      annual.directional_samples,
    );
    const fitScoreRaw = annualHitRateExcludingNeutralRaw;
    return {
      main_god: mainGod,
      is_algorithm_main_god: mainGod === algorithmMainGod,
      fit_score_raw: fitScoreRaw,
      fit_score: fitScoreRaw === null ? null : round(fitScoreRaw, 6),
      annual_full_balanced_accuracy_raw: annual.full_balanced_accuracy_raw,
      annual_full_balanced_accuracy: annual.full_balanced_accuracy,
      monthly_full_balanced_accuracy_raw: monthly.full_balanced_accuracy_raw,
      monthly_full_balanced_accuracy: monthly.full_balanced_accuracy,
      directional_hit_rate_raw: annualHitRateExcludingNeutralRaw,
      directional_hit_rate: annualHitRateExcludingNeutralRaw === null
        ? null
        : round(annualHitRateExcludingNeutralRaw, 6),
      min_class_recall_raw: minClassRecallRaw,
      min_class_recall: minClassRecallRaw === null ? null : round(minClassRecallRaw, 6),
      neutral_rate_raw: annual.neutral_rate_raw,
      neutral_rate: annual.neutral_rate_raw === null
        ? null
        : round(annual.neutral_rate_raw, 6),
      full_accuracy_raw: annual.full_accuracy_raw,
      full_accuracy: annual.full_accuracy_raw === null
        ? null
        : round(annual.full_accuracy_raw, 6),
      annual_directional_samples: annual.directional_samples,
      monthly_directional_samples: monthly.directional_samples,
      annual_actual_up: annual.actual_up,
      annual_actual_down: annual.actual_down,
      monthly_actual_up: monthly.actual_up,
      monthly_actual_down: monthly.actual_down,
      annual_hits: annual.hits,
      annual_explicit_predictions: annualExplicitPredictions,
      annual_hit_rate_excluding_neutral_raw: annualHitRateExcludingNeutralRaw,
      annual_hit_rate_excluding_neutral: annualHitRateExcludingNeutralRaw === null
        ? null
        : round(annualHitRateExcludingNeutralRaw, 6),
      annual_direction_coverage_raw: annualDirectionCoverageRaw,
      annual_direction_coverage: annualDirectionCoverageRaw === null
        ? null
        : round(annualDirectionCoverageRaw, 6),
      annual_full_accuracy: annual.full_accuracy_raw === null
        ? null
        : round(annual.full_accuracy_raw, 6),
      monthly_hits: monthly.hits,
      annual_neutral_predictions: annual.neutral_predictions,
      monthly_neutral_predictions: monthly.neutral_predictions,
      annual_eligible: annualEligible,
      monthly_eligible: false,
      selection_mode: REVERSE_SELECTION_MODE,
    };
  });

  const algorithmCandidateBase = candidates.find(
    (candidate) => candidate.is_algorithm_main_god,
  );
  if (!algorithmCandidateBase) {
    throw new Error(`Algorithm main god is not a valid candidate: ${algorithmMainGod}`);
  }
  const sampleStatus = algorithmCandidateBase.annual_directional_samples === 0
    ? "no_data"
    : algorithmCandidateBase.annual_eligible
      ? "sufficient"
      : "insufficient";
  const gatedCandidates = candidates
    .map((candidate) => ({
      ...candidate,
      ...reverseImprovementGates(candidate, algorithmCandidateBase, sampleStatus),
    }))
    .toSorted(compareReverseCandidates);
  const algorithmCandidate = gatedCandidates.find(
    (candidate) => candidate.is_algorithm_main_god,
  );
  const qualifiedCandidates = gatedCandidates.filter(
    (candidate) => candidate.passes_improvement_gate,
  );
  const replacementApplied = qualifiedCandidates.length > 0;
  const best = replacementApplied ? qualifiedCandidates[0] : algorithmCandidate;
  const second = replacementApplied ? qualifiedCandidates[1] : null;
  const fitMargin = best && second &&
      best.fit_score_raw !== null && second.fit_score_raw !== null
    ? round(best.fit_score_raw - second.fit_score_raw, 6)
    : null;
  const fitStability = sampleStatus === "no_data"
    ? "no_data"
    : sampleStatus === "insufficient"
      ? "insufficient"
      : !replacementApplied
        ? "retained"
        : second && fitMargin < REVERSE_NEAR_TIE_MARGIN
          ? "near_tie"
          : "stable";
  const qualifiedRank = new Map(
    qualifiedCandidates.map((candidate, index) => [candidate.main_god, index + 1]),
  );

  return {
    main_god: best.main_god,
    second_main_god: second?.main_god || null,
    fit_score: best.fit_score,
    fit_margin: fitMargin,
    fit_stability: fitStability,
    replacement_applied: replacementApplied,
    selection_status: replacementApplied
      ? "replaced"
      : sampleStatus === "insufficient"
        ? "retained_insufficient_samples"
        : sampleStatus === "no_data"
          ? "retained_no_data"
          : "retained_no_qualified_candidate",
    qualified_candidate_count: qualifiedCandidates.length,
    annual_full_balanced_accuracy:
      best.annual_full_balanced_accuracy,
    monthly_full_balanced_accuracy:
      best.monthly_full_balanced_accuracy,
    directional_hit_rate: best.directional_hit_rate,
    min_class_recall: best.min_class_recall,
    neutral_rate: best.neutral_rate,
    full_accuracy: best.full_accuracy,
    annual_hits: best.annual_hits,
    annual_neutral_predictions: best.annual_neutral_predictions,
    annual_explicit_predictions: best.annual_explicit_predictions,
    annual_hit_rate_excluding_neutral:
      best.annual_hit_rate_excluding_neutral,
    annual_full_accuracy: best.annual_full_accuracy,
    annual_direction_coverage: best.annual_direction_coverage,
    annual_complete_periods: annualCompletePeriods,
    monthly_complete_periods: monthlyCompletePeriods,
    annual_directional_samples: best.annual_directional_samples,
    monthly_directional_samples: best.monthly_directional_samples,
    annual_eligible: sampleStatus === "sufficient",
    monthly_eligible: false,
    sample_status: sampleStatus,
    matches_algorithm: best.main_god === algorithmMainGod,
    algorithm_fit_score: algorithmCandidate?.fit_score ?? null,
    algorithm_annual_full_balanced_accuracy:
      algorithmCandidate?.annual_full_balanced_accuracy ?? null,
    algorithm_monthly_full_balanced_accuracy:
      algorithmCandidate?.monthly_full_balanced_accuracy ?? null,
    algorithm_annual_hits: algorithmCandidate?.annual_hits ?? null,
    algorithm_annual_neutral_predictions:
      algorithmCandidate?.annual_neutral_predictions ?? null,
    algorithm_annual_explicit_predictions:
      algorithmCandidate?.annual_explicit_predictions ?? null,
    algorithm_annual_hit_rate_excluding_neutral:
      algorithmCandidate?.annual_hit_rate_excluding_neutral ?? null,
    algorithm_annual_full_accuracy:
      algorithmCandidate?.annual_full_accuracy ?? null,
    algorithm_annual_direction_coverage:
      algorithmCandidate?.annual_direction_coverage ?? null,
    candidate_ranking: gatedCandidates.map((candidate, index) => ({
      rank: index + 1,
      qualified_rank: qualifiedRank.get(candidate.main_god) ?? null,
      main_god: candidate.main_god,
      is_algorithm_main_god: candidate.is_algorithm_main_god,
      is_selected: candidate.main_god === best.main_god,
      passes_improvement_gate: candidate.passes_improvement_gate,
      passes_ordinary_hit_rate_gate: candidate.passes_ordinary_hit_rate_gate,
      passes_full_accuracy_gate: candidate.passes_full_accuracy_gate,
      passes_direction_coverage_gate: candidate.passes_direction_coverage_gate,
      fit_score: candidate.fit_score,
      annual_full_balanced_accuracy: candidate.annual_full_balanced_accuracy,
      monthly_full_balanced_accuracy: candidate.monthly_full_balanced_accuracy,
      directional_hit_rate: candidate.directional_hit_rate,
      min_class_recall: candidate.min_class_recall,
      neutral_rate: candidate.neutral_rate,
      full_accuracy: candidate.full_accuracy,
      annual_directional_samples: candidate.annual_directional_samples,
      monthly_directional_samples: candidate.monthly_directional_samples,
      annual_actual_up: candidate.annual_actual_up,
      annual_actual_down: candidate.annual_actual_down,
      monthly_actual_up: candidate.monthly_actual_up,
      monthly_actual_down: candidate.monthly_actual_down,
      annual_neutral_predictions: candidate.annual_neutral_predictions,
      annual_explicit_predictions: candidate.annual_explicit_predictions,
      annual_hit_rate_excluding_neutral:
        candidate.annual_hit_rate_excluding_neutral,
      annual_full_accuracy: candidate.annual_full_accuracy,
      annual_direction_coverage: candidate.annual_direction_coverage,
      monthly_neutral_predictions: candidate.monthly_neutral_predictions,
      annual_eligible: candidate.annual_eligible,
      monthly_eligible: candidate.monthly_eligible,
      selection_mode: candidate.selection_mode,
    })),
  };
}

function evaluateReverseRows(rows, predictDirection) {
  let actualUp = 0;
  let actualDown = 0;
  let upHits = 0;
  let downHits = 0;
  let neutralPredictions = 0;
  for (const row of rows) {
    if (!row.complete || !row.period_kline) continue;
    const actual = row.period_kline[5];
    if (actual !== "up" && actual !== "down") continue;
    const predicted = predictDirection(row);
    if (actual === "up") {
      actualUp += 1;
      if (predicted === "up") upHits += 1;
    } else {
      actualDown += 1;
      if (predicted === "down") downHits += 1;
    }
    if (predicted === "neutral") neutralPredictions += 1;
  }
  const upRecall = rawDivide(upHits, actualUp);
  const downRecall = rawDivide(downHits, actualDown);
  const fullBalancedAccuracy = upRecall === null || downRecall === null
    ? null
    : (upRecall + downRecall) / 2;
  return {
    directional_samples: actualUp + actualDown,
    actual_up: actualUp,
    actual_down: actualDown,
    hits: upHits + downHits,
    neutral_predictions: neutralPredictions,
    up_recall_raw: upRecall,
    down_recall_raw: downRecall,
    neutral_rate_raw: rawDivide(neutralPredictions, actualUp + actualDown),
    full_accuracy_raw: rawDivide(upHits + downHits, actualUp + actualDown),
    full_balanced_accuracy_raw: fullBalancedAccuracy,
    full_balanced_accuracy:
      fullBalancedAccuracy === null ? null : round(fullBalancedAccuracy, 6),
  };
}

function reverseAnnualDirection(mainGod, row) {
  const luckScore = rescoreLuckSegments(mainGod, row.calculation.segments);
  const annualScore = scorePeriod(mainGod, row.pillar).period_score;
  const totalScore = round(0.60 * luckScore + 0.40 * annualScore, 12);
  return statusDirection(classify(totalScore));
}

function reverseMonthlyDirection(mainGod, row) {
  const annualPillar = annualPillarByYear.get(row.year);
  if (!annualPillar) throw new Error(`Missing annual pillar for reverse fit: ${row.year}`);
  const luckScore = rescoreLuckSegments(mainGod, row.calculation.segments);
  const annualScore = scorePeriod(mainGod, annualPillar).period_score;
  const monthScore = scorePeriod(mainGod, row.pillar).period_score;
  const totalScore = round(
    0.36 * luckScore + 0.24 * annualScore + 0.40 * monthScore,
    12,
  );
  return statusDirection(classify(totalScore));
}

function rescoreLuckSegments(mainGod, segments) {
  return segments.reduce((sum, segment) => (
    sum + number(segment[1]) * (
      segment[0] === "未上市" ? 0 : scorePeriod(mainGod, segment[0]).period_score
    )
  ), 0);
}

function countCompletePeriods(rows) {
  return rows.filter((row) => row.complete && row.period_kline).length;
}

function reverseImprovementGates(candidate, algorithmCandidate, sampleStatus) {
  const hasComparableOrdinaryRates = (
    sampleStatus === "sufficient" &&
    candidate.annual_explicit_predictions > 0 &&
    algorithmCandidate.annual_explicit_predictions > 0
  );
  const passesOrdinaryHitRateGate = hasComparableOrdinaryRates && (
    candidate.annual_hits * algorithmCandidate.annual_explicit_predictions >
    algorithmCandidate.annual_hits * candidate.annual_explicit_predictions
  );
  const passesFullAccuracyGate = sampleStatus === "sufficient" && (
    candidate.annual_hits >= algorithmCandidate.annual_hits
  );
  const passesDirectionCoverageGate = sampleStatus === "sufficient" && (
    candidate.annual_explicit_predictions >=
    algorithmCandidate.annual_explicit_predictions
  );
  return {
    passes_ordinary_hit_rate_gate: passesOrdinaryHitRateGate,
    passes_full_accuracy_gate: passesFullAccuracyGate,
    passes_direction_coverage_gate: passesDirectionCoverageGate,
    passes_improvement_gate: (
      !candidate.is_algorithm_main_god &&
      candidate.annual_eligible &&
      passesOrdinaryHitRateGate &&
      passesFullAccuracyGate &&
      passesDirectionCoverageGate
    ),
  };
}

function compareReverseCandidates(left, right) {
  const descendingKeys = [
    "fit_score_raw",
    "full_accuracy_raw",
    "annual_direction_coverage_raw",
    "annual_full_balanced_accuracy_raw",
    "min_class_recall_raw",
  ];
  for (const key of descendingKeys) {
    const comparison = compareNullableNumbers(left[key], right[key], "desc");
    if (comparison !== 0) return comparison;
  }
  return GANS.indexOf(left.main_god) - GANS.indexOf(right.main_god);
}

function compareNullableNumbers(left, right, direction) {
  if (left === null || left === undefined) {
    return right === null || right === undefined ? 0 : 1;
  }
  if (right === null || right === undefined) return -1;
  if (Math.abs(left - right) <= REVERSE_TIE_EPSILON) return 0;
  return direction === "asc" ? left - right : right - left;
}

function scoreLuckSegments(mainGod, chart, startMs, endMs) {
  if (!(endMs > startMs)) throw new Error(`Invalid interval ${startMs}..${endMs}`);
  const segments = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const period = luckPeriodAt(chart, cursor);
    const boundary = period
      ? period.end_ms
      : cursor < chart.listing_ms
        ? chart.listing_ms
        : null;
    if (boundary === null) {
      throw new Error(`Uncovered luck interval: ${chart.ticker} ${cursor}`);
    }
    const segmentEnd = Math.min(endMs, boundary);
    if (!(segmentEnd > cursor)) {
      throw new Error(`Non-advancing luck boundary: ${chart.ticker} ${cursor} ${boundary}`);
    }
    const pillar = period?.pillar || "未上市";
    const phase = period?.phase === "pre_luck"
      ? "小运"
      : period?.phase === "official_luck"
        ? "大运"
        : "未上市";
    const score = scorePeriod(mainGod, period?.pillar || null);
    segments.push({
      pillar,
      phase,
      start_et: formatEt(new Date(cursor)),
      end_et: formatEt(new Date(segmentEnd)),
      weight: (segmentEnd - cursor) / (endMs - startMs),
      period_score: score.period_score,
    });
    cursor = segmentEnd;
  }
  const weightSum = segments.reduce((sum, segment) => sum + segment.weight, 0);
  if (Math.abs(weightSum - 1) > 1e-10) throw new Error(`Luck weights: ${weightSum}`);
  const weightedScore = segments.reduce(
    (sum, segment) => sum + segment.weight * segment.period_score,
    0,
  );
  return {
    weighted_score: weightedScore,
    segments: segments.map((segment) => [
      segment.pillar,
      round(segment.weight, 12),
      segment.period_score,
      segment.phase,
    ]),
  };
}

function luckPeriodAt(chart, momentMs) {
  if (momentMs < chart.listing_ms) return null;
  const periods = momentMs < chart.first_luck_start_ms
    ? chart.pre_luck_periods
    : chart.periods;
  const period = periods.find(
    (candidate) => candidate.start_ms <= momentMs && momentMs < candidate.end_ms,
  );
  if (!period) throw new Error(`Luck chart uncovered/exhausted: ${chart.ticker} ${momentMs}`);
  return period;
}

function scorePeriod(mainGod, pillar) {
  if (!pillar) {
    return {
      pillar: "未起运",
      state: "未起运",
      state_score: 0,
      stem_relation_code: "not_started",
      stem_base_score: 0,
      combo_name: "—",
      combo_adjustment: 0,
      stem_final_score: 0,
      period_score: 0,
    };
  }
  const state = LONGSHENG[mainGod][pillar[1]];
  const relation = stemRelation(pillar[0], mainGod);
  return {
    pillar,
    state,
    state_score: STATE_SCORES[state],
    ...relation,
    period_score: round(0.60 * STATE_SCORES[state] + 0.40 * relation.stem_final_score, 6),
  };
}

function stemRelation(actionStem, mainGod) {
  const actionElement = STEM_INFO[actionStem][0];
  const mainElement = STEM_INFO[mainGod][0];
  let stemRelationCode;
  let stemBaseScore;
  if (actionElement === mainElement) {
    stemRelationCode = "same_element";
    stemBaseScore = 3;
  } else if (GENERATES[actionElement] === mainElement) {
    stemRelationCode = "action_generates_main";
    stemBaseScore = 5;
  } else if (GENERATES[mainElement] === actionElement) {
    stemRelationCode = "main_generates_action";
    stemBaseScore = -3;
  } else if (CONTROLS[actionElement] === mainElement) {
    stemRelationCode = "action_controls_main";
    stemBaseScore = -5;
  } else if (CONTROLS[mainElement] === actionElement) {
    stemRelationCode = "main_controls_action";
    stemBaseScore = 1;
  } else {
    throw new Error(`Unknown stem relation: ${actionStem}/${mainGod}`);
  }
  const combo = FIVE_COMBOS.get(comboKey(actionStem, mainGod));
  let comboAdjustment = 0;
  if (combo) {
    if (stemRelationCode === "action_controls_main") comboAdjustment = 2;
    else if (stemRelationCode === "main_controls_action") comboAdjustment = -2;
  }
  return {
    stem_relation_code: stemRelationCode,
    stem_base_score: stemBaseScore,
    combo_name: combo?.[0] || "—",
    combo_adjustment: comboAdjustment,
    stem_final_score: Math.max(-5, Math.min(5, stemBaseScore + comboAdjustment)),
  };
}

function periodKlineFor(prices, startEt, endEt) {
  const first = lowerBound(prices, startEt, (row) => row.session_open_et);
  const end = lowerBound(prices, endEt, (row) => row.session_open_et);
  return aggregatePriceSlice(prices, first, end);
}

function buildNaturalKlines(prices) {
  const yearStates = new Map();
  const monthStates = new Map();
  for (const row of prices) {
    updateKlineState(mapState(yearStates, row.trading_date.slice(0, 4)), row);
    updateKlineState(mapState(monthStates, row.trading_date.slice(0, 7)), row);
  }
  return {
    years: new Map([...yearStates].map(([key, value]) => [key, finishKline(value)])),
    months: new Map([...monthStates].map(([key, value]) => [key, finishKline(value)])),
  };
}

function aggregatePriceSlice(prices, start, end) {
  if (start >= end) return null;
  const state = emptyKlineState();
  for (let index = start; index < end; index += 1) updateKlineState(state, prices[index]);
  return finishKline(state);
}

function emptyKlineState() {
  return {
    open: null,
    high: -Infinity,
    low: Infinity,
    close: null,
    first_close: null,
    sessions: 0,
    first_date: "",
    last_date: "",
    volume: 0,
    adjustment_fallback_rows: 0,
  };
}

function updateKlineState(state, row) {
  if (state.sessions === 0) {
    state.open = row.adj_open;
    state.first_close = row.adj_close;
    state.first_date = row.trading_date;
  }
  state.high = Math.max(state.high, row.adj_high);
  state.low = Math.min(state.low, row.adj_low);
  state.close = row.adj_close;
  state.last_date = row.trading_date;
  state.sessions += 1;
  state.volume += row.volume;
  if (row.adjustment_fallback) state.adjustment_fallback_rows += 1;
}

function finishKline(state) {
  if (!state.sessions) return null;
  const storedOpen = round(state.open, 6);
  const storedHigh = round(state.high, 6);
  const storedLow = round(state.low, 6);
  const storedClose = round(state.close, 6);
  const candleReturn = storedClose / storedOpen - 1;
  return [
    storedOpen,
    storedHigh,
    storedLow,
    storedClose,
    round(candleReturn * 100, 6),
    actualDirection(candleReturn),
    state.sessions,
    state.first_date,
    state.last_date,
  ];
}

function createMetric() {
  return {
    total_periods: 0,
    complete_periods: 0,
    complete_without_kline: 0,
    directional_samples: 0,
    hits: 0,
    predicted_up: 0,
    predicted_down: 0,
    neutral_periods: 0,
    actual_up_complete: 0,
    actual_up_directional_sample: 0,
    pred_up_actual_up: 0,
    pred_up_actual_down: 0,
    pred_down_actual_down: 0,
    pred_down_actual_up: 0,
    directional_actual_neutral: 0,
    return_sum: 0,
    by_status: Object.fromEntries(STATUS_ORDER.map((status) => [status, {
      samples: 0,
      actual_up: 0,
      return_sum: 0,
    }])),
  };
}

function updateMetric(metric, row) {
  metric.total_periods += 1;
  if (!row.complete) return;
  if (!row.period_kline) {
    metric.complete_without_kline += 1;
    return;
  }
  metric.complete_periods += 1;
  const periodReturn = number(row.period_kline[4]);
  metric.return_sum += periodReturn;
  if (row.period_kline[5] === "up") metric.actual_up_complete += 1;
  const statusMetric = metric.by_status[row.status];
  statusMetric.samples += 1;
  statusMetric.return_sum += periodReturn;
  if (row.period_kline[5] === "up") statusMetric.actual_up += 1;
  if (row.predicted_direction === "neutral") {
    metric.neutral_periods += 1;
    return;
  }
  metric.directional_samples += 1;
  if (row.predicted_direction === "up") metric.predicted_up += 1;
  else metric.predicted_down += 1;
  if (row.period_kline[5] === "neutral") {
    metric.directional_actual_neutral += 1;
  } else if (row.predicted_direction === "up" && row.period_kline[5] === "up") {
    metric.pred_up_actual_up += 1;
  } else if (row.predicted_direction === "up" && row.period_kline[5] === "down") {
    metric.pred_up_actual_down += 1;
  } else if (row.predicted_direction === "down" && row.period_kline[5] === "down") {
    metric.pred_down_actual_down += 1;
  } else if (row.predicted_direction === "down" && row.period_kline[5] === "up") {
    metric.pred_down_actual_up += 1;
  }
  if (row.period_kline[5] === "up") metric.actual_up_directional_sample += 1;
  if (row.sync === true) metric.hits += 1;
}

function mergeMetric(target, source) {
  for (const key of [
    "total_periods", "complete_periods", "complete_without_kline", "directional_samples",
    "hits", "predicted_up", "predicted_down", "neutral_periods", "actual_up_complete",
    "actual_up_directional_sample", "return_sum",
    "pred_up_actual_up", "pred_up_actual_down", "pred_down_actual_down",
    "pred_down_actual_up", "directional_actual_neutral",
  ]) target[key] += source[key];
  for (const status of STATUS_ORDER) {
    target.by_status[status].samples += source.by_status[status].samples;
    target.by_status[status].actual_up += source.by_status[status].actual_up;
    target.by_status[status].return_sum += source.by_status[status].return_sum;
  }
}

function finalizeMetric(metric) {
  const bullishHitRateRaw = rawDivide(
    metric.pred_up_actual_up,
    metric.pred_up_actual_up + metric.pred_up_actual_down,
  );
  const bearishHitRateRaw = rawDivide(
    metric.pred_down_actual_down,
    metric.pred_down_actual_down + metric.pred_down_actual_up,
  );
  const upRecallRaw = rawDivide(
    metric.pred_up_actual_up,
    metric.pred_up_actual_up + metric.pred_down_actual_up,
  );
  const downRecallRaw = rawDivide(
    metric.pred_down_actual_down,
    metric.pred_down_actual_down + metric.pred_up_actual_down,
  );
  const bullishHitRate = bullishHitRateRaw == null ? null : round(bullishHitRateRaw, 6);
  const bearishHitRate = bearishHitRateRaw == null ? null : round(bearishHitRateRaw, 6);
  const upRecall = upRecallRaw == null ? null : round(upRecallRaw, 6);
  const downRecall = downRecallRaw == null ? null : round(downRecallRaw, 6);
  return {
    total_periods: metric.total_periods,
    complete_periods: metric.complete_periods,
    directional_samples: metric.directional_samples,
    hits: metric.hits,
    hit_rate: divide(metric.hits, metric.directional_samples),
    bullish_hit_rate: bullishHitRate,
    bearish_hit_rate: bearishHitRate,
    macro_precision: bullishHitRateRaw == null || bearishHitRateRaw == null
      ? null
      : round((bullishHitRateRaw + bearishHitRateRaw) / 2, 6),
    up_recall: upRecall,
    down_recall: downRecall,
    balanced_accuracy: upRecallRaw == null || downRecallRaw == null
      ? null
      : round((upRecallRaw + downRecallRaw) / 2, 6),
    directional_confusion: {
      pred_up_actual_up: metric.pred_up_actual_up,
      pred_up_actual_down: metric.pred_up_actual_down,
      pred_down_actual_down: metric.pred_down_actual_down,
      pred_down_actual_up: metric.pred_down_actual_up,
      actual_neutral: metric.directional_actual_neutral,
    },
    predicted_up: metric.predicted_up,
    predicted_down: metric.predicted_down,
    neutral_periods: metric.neutral_periods,
    neutral_coverage: divide(metric.neutral_periods, metric.complete_periods),
    actual_up_periods: metric.actual_up_complete,
    actual_up_rate: divide(metric.actual_up_complete, metric.complete_periods),
    average_return_pct: divide(metric.return_sum, metric.complete_periods),
    by_status: Object.fromEntries(STATUS_ORDER.map((status) => {
      const row = metric.by_status[status];
      return [status, {
        samples: row.samples,
        actual_up_rate: divide(row.actual_up, row.samples),
        average_return_pct: divide(row.return_sum, row.samples),
      }];
    })),
  };
}

function alwaysUpBaseline(metric) {
  return {
    definition: "每个周期始终预测上涨",
    same_evaluable_samples: metric.directional_samples,
    same_evaluable_hits: metric.actual_up_directional_sample,
    same_evaluable_hit_rate: divide(
      metric.actual_up_directional_sample,
      metric.directional_samples,
    ),
    all_complete_samples: metric.complete_periods,
    all_complete_hits: metric.actual_up_complete,
    all_complete_hit_rate: divide(metric.actual_up_complete, metric.complete_periods),
  };
}

function summarizeReverseFit(stocks) {
  const statusCounts = Object.fromEntries(
    ["sufficient", "insufficient", "no_data"].map((status) => [status, 0]),
  );
  const stemCounts = Object.fromEntries([...GANS].map((stem) => [stem, 0]));
  let annualEligible = 0;
  let nearTie = 0;
  let fitCount = 0;
  let algorithmMatches = 0;
  let replacementCount = 0;
  const selected = {
    hits: 0,
    neutral_predictions: 0,
    explicit_predictions: 0,
    actual_direction_samples: 0,
    full_balanced_accuracy_sum: 0,
  };
  const algorithm = {
    hits: 0,
    neutral_predictions: 0,
    explicit_predictions: 0,
    actual_direction_samples: 0,
    full_balanced_accuracy_sum: 0,
  };
  for (const stock of stocks) {
    statusCounts[stock.reverse_sample_status] += 1;
    if (stock.reverse_main_god && stock.reverse_sample_status !== "no_data") {
      stemCounts[stock.reverse_main_god] += 1;
      fitCount += 1;
      if (stock.reverse_matches_algorithm) algorithmMatches += 1;
    }
    if (stock.reverse_replacement_applied) replacementCount += 1;
    if (stock.reverse_annual_eligible) annualEligible += 1;
    if (stock.reverse_fit_stability === "near_tie") nearTie += 1;
    if (stock.reverse_sample_status === "sufficient") {
      selected.hits += number(stock.reverse_annual_hits);
      selected.neutral_predictions += number(stock.reverse_annual_neutral_predictions);
      selected.explicit_predictions += number(stock.reverse_annual_explicit_predictions);
      selected.actual_direction_samples += number(stock.reverse_annual_directional_samples);
      selected.full_balanced_accuracy_sum += number(
        stock.reverse_annual_full_balanced_accuracy,
      );
      algorithm.hits += number(stock.algorithm_annual_hits);
      algorithm.neutral_predictions += number(
        stock.algorithm_annual_neutral_predictions,
      );
      algorithm.explicit_predictions += number(
        stock.algorithm_annual_explicit_predictions,
      );
      algorithm.actual_direction_samples += number(
        stock.reverse_annual_directional_samples,
      );
      algorithm.full_balanced_accuracy_sum += number(
        stock.algorithm_annual_full_balanced_accuracy,
      );
    }
  }
  const performance = (metric) => ({
    annual_hits: metric.hits,
    annual_neutral_predictions: metric.neutral_predictions,
    annual_explicit_predictions: metric.explicit_predictions,
    annual_actual_direction_samples: metric.actual_direction_samples,
    micro_hit_rate_excluding_neutral: divide(
      metric.hits,
      metric.explicit_predictions,
    ),
    micro_full_accuracy_including_neutral: divide(
      metric.hits,
      metric.actual_direction_samples,
    ),
    direction_coverage: divide(
      metric.explicit_predictions,
      metric.actual_direction_samples,
    ),
    macro_full_balanced_accuracy: divide(
      metric.full_balanced_accuracy_sum,
      annualEligible,
    ),
  });
  return {
    label: REVERSE_MAIN_GOD_LABEL,
    selection_mode: REVERSE_SELECTION_MODE,
    stock_count: stocks.length,
    fitted_stock_count: fitCount,
    sample_status_counts: statusCounts,
    annual_eligible_stock_count: annualEligible,
    near_tie_stock_count: nearTie,
    algorithm_match_count: algorithmMatches,
    algorithm_match_rate: divide(algorithmMatches, fitCount),
    replacement_count: replacementCount,
    retained_count: stocks.length - replacementCount,
    selected_stem_counts: stemCounts,
    sufficient_stocks_annual_performance: {
      selected_reverse_main_god: performance(selected),
      algorithm_main_god: performance(algorithm),
    },
  };
}

function buildMethodology(source) {
  const holdingsDate = source.metadata?.universe?.russell_proxy_holdings_date ||
    source.metadata?.universe?.holdings_date ||
    source.metadata?.holdings_date ||
    "未注明日期";
  return {
    frozen_parameters: true,
    parameter_tuning: "none",
    rate_scale: "0_to_1",
    universe_scope: {
      definition: (
        `S&P 500与Nasdaq-100当前成分股，加${holdingsDate} iShares IWM当前可交易` +
        "股票持仓作为Russell 2000当前股票代理，并加入当前大麻板块联合池。"
      ),
      russell_proxy_warning: (
        "IWM持仓不是FTSE Russell授权成分文件；现金、期货、无正常交易行情的CVR/" +
        "退市残余不进入股票回测。以当前持仓回看历史存在幸存者与前视选择偏差。"
      ),
      cannabis_theme_warning: (
        "大麻板块是当前MSOS、YOLO、MJ、CNBS非零底层敞口与美国仍挂牌核心业务" +
        "证券的联合池；OTC、ETF与行情起点代理均单独标记，零值遗留与无日K证券排除。" +
        "前身证券或漏记资本合并造成的断点从回测起点前剔除；其余极端涨跌经拆股事件核对后保留并标警示。"
      ),
      source: source.metadata?.universe_sources || [],
    },
    compact_schema: {
      kline_array: [
        "open", "high", "low", "close", "return_pct", "direction", "sessions",
        "first_date", "last_date",
      ],
      big_luck_segment_array: ["pillar", "elapsed_time_weight", "period_score", "phase"],
      calculation_object: {
        big_luck: "行运加权分（正式起运前为小运，起运后为大运）",
        segments: "行运分段，字段见big_luck_segment_array",
        annual: "流年周期分",
        month: "流月周期分（仅monthly记录）",
      },
      period_lookup: "流年/流月起止时刻在summary.calendar中按year/month_index查找",
    },
    price_source: "asset_daily_prices / yahoo_research",
    adjusted_price: (
      "adj_OHLC = raw_OHLC × COALESCE(NULLIF(adjustment_factor,0),1)；" +
      "复权因子缺失或0时按1处理并逐股标记。"
    ),
    actual_direction: "复权K线 close/open-1；>0=up，<0=down，=0=neutral。",
    primary_period_kline: (
      "以该交易日09:30 ET开盘时刻所属的节气周期分桶：" +
      "period_start <= session_open_ET < period_end。若节气边界落在盘中，当日整根日线归开盘时所在的旧周期；" +
      "相关记录以boundary_intraday=true标记。"
    ),
    auxiliary_calendar_kline: (
      "calendar_kline是标准公历年K/月K，仅展示参考，不进入主命中率。"
    ),
    complete_sample: (
      "cycle_start >= max(上市时刻,本地最早日线开盘时刻) 且 " +
      "cycle_end <= 该股最后日线收盘时刻，且周期内存在可用K线；" +
      "上市首个不完整周期及截至2026-07-10未结束周期排除。"
    ),
    listing_time_basis_warning: (
      "行情起点代理不等于真实IPO时刻；所有结果按精确首笔/股类开盘/常规开盘/" +
      "行情起点代理分层报告。"
    ),
    annual_formula: "annual_total = 0.60×luck_background + 0.40×annual_period",
    monthly_formula: "monthly_total = 0.36×luck_background + 0.24×annual_period + 0.40×month_period",
    period_formula: "period_score = 0.60×twelve_growth_state_score + 0.40×stem_relation_final_score",
    pre_luck_rule: (
      "正式起运前，上市精确时刻起的第1年取上市八字时柱；" +
      "此后每到上市周年按六十甲子顺推一柱，与正式大运顺逆无关。"
    ),
    luck_transition: (
      "回测年仍按立春切分；周期内遇上市周年或正式起运时刻，" +
      "按实际UTC秒数分段加权；边界区间固定为[start,end)。"
    ),
    direction_mapping: {
      "强势偏涨": "up",
      "偏涨": "up",
      "中性震荡": "neutral",
      "偏跌": "down",
      "弱势偏跌": "down",
    },
    status_thresholds: [
      { status: "强势偏涨", condition: "score >= 3" },
      { status: "偏涨", condition: "1 <= score < 3" },
      { status: "中性震荡", condition: "-1 < score < 1" },
      { status: "偏跌", condition: "-3 < score <= -1" },
      { status: "弱势偏跌", condition: "score <= -3" },
    ],
    neutral_rule: "中性震荡不计入上涨/下跌方向命中率，另行统计覆盖率。",
    reverse_main_god_fit: {
      label: REVERSE_MAIN_GOD_LABEL,
      scope: "sample_in_descriptive_fit_only",
      selection_mode: REVERSE_SELECTION_MODE,
      candidates: [...GANS],
      frozen_components: (
        "每只股票冻结节气年周期、行运分段及其时间权重、年运公式权重与实际复权K线；" +
        "仅将主用神依次替换为十天干并重算年运分数。月运只保留为诊断数据，" +
        "不参与选神、资格、状态、排名或汇总。"
      ),
      actual_sample_rule: (
        "仅使用complete=true且实际K线方向为up/down的样本；实际neutral排除。" +
        "候选之间使用完全相同的实际样本分母。"
      ),
      full_balanced_accuracy: (
        "full_BA = 0.5×(预测上涨且实际上涨/全部实际上涨 + " +
        "预测下跌且实际下跌/全部实际下跌)。预测中性保留在实际up/down分母中并按未命中处理。"
      ),
      annual_hit_rates: {
        excluding_neutral: "命中数/(实际up/down样本-预测中性数)",
        including_neutral: "命中数/全部实际up/down样本，预测中性按未命中处理",
      },
      annual_eligibility: (
        `实际方向样本>=${REVERSE_ANNUAL_MIN_SAMPLES}，且实际上涨、下跌各>=` +
        `${REVERSE_ANNUAL_MIN_PER_CLASS}。`
      ),
      improvement_gate: (
        "只有年运样本充足时才允许替换；候选的普通年运命中率（排除中性）必须严格高于" +
        "算法原主用神，全样本准确率（中性计错）不得下降，方向覆盖率不得下降。" +
        "普通命中率使用命中数与明确预测数交叉相乘比较，相等不替换；" +
        "无合格候选时保留算法原主用神。"
      ),
      selection_score: (
        "fit_score=普通年运命中率（排除中性），不与月运合成。" +
        "full_BA只作为门槛后的后续tie-break和诊断指标。" +
        "年运样本未达门槛时标记insufficient；实际涨跌不具备两类时标记no_data；" +
        "两种情况都保留算法原主用神。"
      ),
      tie_break: (
        `数值差<=${REVERSE_TIE_EPSILON}视为相同；对通过硬门槛的候选依次比较` +
        "普通年运命中率（高）、全样本准确率（高）、方向覆盖率（高）、" +
        "full_BA（高）、上涨/下跌召回率的最小值（高）、固定天干顺序。"
      ),
      stability: (
        `第一、第二名合格候选的普通年运命中率差<` +
        `${REVERSE_NEAR_TIE_MARGIN}标记near_tie。`
      ),
      leakage_warning: (
        "该主用神由同一批历史K线反向选择，存在明确的样本内拟合、数据泄漏与多重比较偏差；" +
        "其命中率不是独立样本预测能力，不能替代走样本外、滚动窗口或留出集验证。"
      ),
      algorithm_comparison: (
        "algorithm_*字段使用与reverse_*字段完全相同的年运样本计算原算法主用神，" +
        "用于与reverse_*字段公平对照。"
      ),
    },
    state_scores: STATE_SCORES,
    longsheng_lookup: source.longsheng_records,
    stem_relation_lookup: source.relation_records,
    listing_time_basis: BASIS_CONFIDENCE,
  };
}

function validateReverseSelection(stock) {
  const selected = stock.reverse_candidate_ranking.find(
    (candidate) => candidate.is_selected,
  );
  if (!selected || selected.main_god !== stock.reverse_main_god) {
    throw new Error(`${stock.ticker} reverse selection marker is inconsistent`);
  }
  if (stock.reverse_replacement_applied) {
    if (stock.reverse_selection_status !== "replaced" ||
        stock.reverse_sample_status !== "sufficient" ||
        stock.reverse_main_god === stock.main_god ||
        stock.reverse_qualified_candidate_count < 1 ||
        selected.passes_improvement_gate !== true ||
        !(stock.reverse_annual_hit_rate_excluding_neutral >
          stock.algorithm_annual_hit_rate_excluding_neutral) ||
        stock.reverse_annual_full_accuracy + 1e-6 <
          stock.algorithm_annual_full_accuracy ||
        stock.reverse_annual_direction_coverage + 1e-6 <
          stock.algorithm_annual_direction_coverage) {
      throw new Error(`${stock.ticker} invalid reverse replacement gates`);
    }
  } else {
    const expectedStatus = stock.reverse_sample_status === "insufficient"
      ? "retained_insufficient_samples"
      : stock.reverse_sample_status === "no_data"
        ? "retained_no_data"
        : "retained_no_qualified_candidate";
    if (stock.reverse_selection_status !== expectedStatus ||
        stock.reverse_main_god !== stock.main_god ||
        stock.reverse_qualified_candidate_count !== 0 ||
        selected.is_algorithm_main_god !== true) {
      throw new Error(`${stock.ticker} must retain the algorithm main god`);
    }
  }
}

async function loadPrices(ticker) {
  const rows = JSON.parse(gunzipSync(await readFile(join(config.inputDir, "prices", `${ticker}.json.gz`))).toString("utf8"));
  return rows.map(row => ({ ...row,
    session_open_et: `${row.trading_date} 09:30:00`,
    session_close_et: `${row.trading_date} 15:00:00`,
  }));
}

function hydrateChart(chart) {
  return {
    ...chart,
    listing_ms: parseEtText(chart.listing_et),
    first_luck_start_ms: parseEtText(chart.first_luck_start_et),
    pre_luck_periods: (chart.pre_luck_periods || []).map((period) => ({
      ...period,
      phase: period.phase || "pre_luck",
      start_ms: parseEtText(period.start_et),
      end_ms: parseEtText(period.end_et),
    })),
    periods: chart.periods.map((period) => ({
      ...period,
      phase: period.phase || "official_luck",
      start_ms: parseEtText(period.start_et),
      end_ms: parseEtText(period.end_et),
    })),
  };
}

function validateLuckChart(stock, chart) {
  if (!chart) throw new Error(`Missing luck chart: ${stock.ticker}`);
  const expectedListingMs = parseEt(stock.listing_date, stock.time_et);
  if (chart.listing_ms !== expectedListingMs) {
    throw new Error(`Listing timestamp mismatch: ${stock.ticker}`);
  }
  if (!chart.pre_luck_periods.length) {
    throw new Error(`Missing pre-luck periods: ${stock.ticker}`);
  }
  const hourPillar = String(stock.bazi).split(/\s+/)[3];
  const hourIndex = JIAZI.indexOf(hourPillar);
  if (hourIndex < 0 || chart.pre_luck_periods[0].pillar !== hourPillar) {
    throw new Error(`Pre-luck must start from hour pillar: ${stock.ticker}`);
  }
  let cursor = chart.listing_ms;
  for (let index = 0; index < chart.pre_luck_periods.length; index += 1) {
    const period = chart.pre_luck_periods[index];
    const expectedPillar = JIAZI[(hourIndex + index) % JIAZI.length];
    if (period.start_ms !== cursor || period.end_ms <= period.start_ms) {
      throw new Error(`Discontinuous pre-luck periods: ${stock.ticker}/${index + 1}`);
    }
    if (period.pillar !== expectedPillar || period.phase !== "pre_luck") {
      throw new Error(`Invalid pre-luck sequence: ${stock.ticker}/${period.pillar}`);
    }
    cursor = period.end_ms;
  }
  if (cursor !== chart.first_luck_start_ms) {
    throw new Error(`Pre-luck must end at first luck start: ${stock.ticker}`);
  }
  if (chart.periods.some((period) => period.phase !== "official_luck")) {
    throw new Error(`Invalid official-luck phase: ${stock.ticker}`);
  }
}

function parseEt(dateText, timeText) {
  return parseEtText(`${dateText} ${timeText}`);
}

function parseEtText(text) {
  const match = String(text).match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!match) throw new Error(`Invalid ET timestamp: ${text}`);
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = formattedParts(nyFormatter, new Date(guess));
    const represented = Date.UTC(
      parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second,
    );
    guess += desired - represented;
  }
  return guess;
}

function formatEt(instant) {
  const parts = formattedParts(nyFormatter, instant);
  return (
    `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")} ` +
    `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:` +
    `${String(parts.second).padStart(2, "0")}`
  );
}

function formattedParts(formatter, instant) {
  const result = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") result[part.type] = Number(part.value);
  }
  return result;
}

function classify(score) {
  if (score >= 3) return "强势偏涨";
  if (score >= 1) return "偏涨";
  if (score > -1) return "中性震荡";
  if (score > -3) return "偏跌";
  return "弱势偏跌";
}

function statusDirection(status) {
  if (status === "强势偏涨" || status === "偏涨") return "up";
  if (status === "偏跌" || status === "弱势偏跌") return "down";
  return "neutral";
}

function actualDirection(value) {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "neutral";
}

function syncValue(predictedDirection, kline, complete) {
  if (!complete || !kline || predictedDirection === "neutral") return null;
  return predictedDirection === kline[5];
}

function optionalExclusion(
  complete,
  startMs,
  listingMs,
  observationStartMs,
  endMs,
  observationEndMs,
  kline,
  qualityStartMs = -Infinity,
) {
  const reason = exclusionReason(
    complete,
    startMs,
    listingMs,
    observationStartMs,
    endMs,
    observationEndMs,
    kline,
    qualityStartMs,
  );
  return reason ? { exclusion_reason: reason } : {};
}

function optionalBoundaryFlag(startEt, endEt) {
  return isBoundaryIntraday(startEt) || isBoundaryIntraday(endEt)
    ? { boundary_intraday: true }
    : {};
}

function isBoundaryIntraday(etText) {
  const [dateText, timeText] = String(etText).split(" ");
  const weekday = new Date(`${dateText}T12:00:00Z`).getUTCDay();
  return weekday >= 1 && weekday <= 5 && ((timeText >= "09:30:00" && timeText < "11:30:00") || (timeText >= "13:00:00" && timeText < "15:00:00"));
}

function exclusionReason(
  complete,
  startMs,
  listingMs,
  observationStartMs,
  endMs,
  observationEndMs,
  kline,
  qualityStartMs = -Infinity,
) {
  if (complete && !kline) return "complete_period_without_price_bar";
  if (complete) return "";
  if (startMs < listingMs) return "left_censored_by_listing";
  if (startMs < qualityStartMs) {
    return "left_censored_by_price_quality_policy";
  }
  if (startMs < observationStartMs) return "left_censored_by_price_history";
  if (endMs > observationEndMs) return "right_censored_by_data_cutoff";
  if (!kline) return "no_full_session_in_period";
  return "incomplete";
}

function basisInfo(raw) {
  return BASIS_CONFIDENCE[raw] || { group: raw || "unknown", confidence: "unknown" };
}

function comboKey(first, second) {
  const order = "甲乙丙丁戊己庚辛壬癸";
  return [first, second].toSorted((left, right) => order.indexOf(left) - order.indexOf(right)).join("");
}

function zip(keys, valuesText) {
  return Object.fromEntries([...keys].map((key, index) => [key, valuesText.split(" ")[index]]));
}

function lowerBound(rows, target, accessor) {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (accessor(rows[middle]) < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function mapState(map, key) {
  if (!map.has(key)) map.set(key, emptyKlineState());
  return map.get(key);
}

function metricAt(map, key) {
  if (!map.has(key)) map.set(key, createMetric());
  return map.get(key);
}

function countDuplicateDates(prices) {
  let duplicates = 0;
  for (let index = 1; index < prices.length; index += 1) {
    if (prices[index].trading_date === prices[index - 1].trading_date) duplicates += 1;
  }
  return duplicates;
}

function divide(numerator, denominator) {
  return denominator ? round(numerator / denominator, 6) : null;
}

function rawDivide(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function round(value, digits = 6) {
  if (!Number.isFinite(Number(value))) return null;
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function assertNear(actual, expected, tolerance, label) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`);
  }
}

async function removeStaleStockPayloads(directory, expectedFiles) {
  const files = await readdir(directory);
  await Promise.all(
    files
      .filter(
        (file) =>
          (file.endsWith(".json") || file.endsWith(".json.gz")) &&
          !expectedFiles.has(file),
      )
      .map((file) => unlink(join(directory, file))),
  );
}

async function writeGzipJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const payload = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  await writeFile(path, gzipSync(payload, { level: 9 }));
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

async function directorySize(path) {
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) total += await directorySize(child);
    else total += (await stat(child)).size;
  }
  return total;
}

function buildForecasts(stock, chart) {
  const cutoff = parseEt(config.cutoffDate, "15:00:00");
  const annual = [], monthly = [];
  for (const y of calendar.years) {
    if (y.year < 2026 || y.year > 2035 || y.end_ms <= cutoff) continue;
    const annualScore = scorePeriod(stock.main_god, y.pillar).period_score;
    for (const [kind, period] of [["annual", y], ...y.months.map(m => ["monthly", m])]) {
      if (period.end_ms <= cutoff) continue;
      const luck = scoreLuckSegments(stock.main_god, chart, period.start_ms, period.end_ms);
      const monthScore = kind === "monthly" ? scorePeriod(stock.main_god, period.pillar).period_score : null;
      const total = round(kind === "annual"
        ? .60 * luck.weighted_score + .40 * annualScore
        : .36 * luck.weighted_score + .24 * annualScore + .40 * monthScore, 12);
      const status = classify(total);
      const row = {
        year: y.year, pillar: period.pillar,
        ...(kind === "monthly" ? { month_index: period.index, jie_name: period.jie_name } : {}),
        start_et: period.start_et, end_et: period.end_et,
        total_score: total, status, predicted_direction: statusDirection(status),
        calculation: { big_luck: round(luck.weighted_score, 12), segments: luck.segments, annual: annualScore,
          ...(kind === "monthly" ? {month: monthScore} : {}) },
        forecast_as_of: config.cutoffDate, model: "frozen_original_main_god",
        period_state: period.start_ms <= cutoff ? "in_progress" : "future",
        complete: false, sync: null, period_kline: null, calendar_kline: null,
      };
      (kind === "annual" ? annual : monthly).push(row);
    }
  }
  return { annual, monthly };
}
