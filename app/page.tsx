"use client";

import React, { useEffect, useMemo, useState } from "react";

type JsonMap = Record<string, unknown>;

type Kline = {
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  return?: number;
  direction?: string;
};

type StockIndexItem = {
  ticker: string;
  name: string;
  sector: string;
  index_membership: string;
  listing_date?: string;
  time_et?: string;
  bazi?: string;
  main_god?: string;
  annual_hit_rate?: number;
  monthly_hit_rate?: number;
  annual_samples?: number;
  monthly_samples?: number;
  annual_complete_periods?: number;
  annual_neutral_periods?: number;
  annual_hits?: number;
  monthly_complete_periods?: number;
  monthly_neutral_periods?: number;
  monthly_hits?: number;
  listing_time_basis?: unknown;
  basis_confidence?: string;
};

type PeriodRow = JsonMap & {
  year?: number;
  solar_year?: number;
  month_index?: number;
  month_name?: string;
  pillar?: string;
  start_et?: string;
  end_et?: string;
  big_luck_score?: number;
  annual_score?: number;
  year_baseline?: number;
  month_period_score?: number;
  total_score?: number;
  status?: string;
  predicted_direction?: string;
  kline?: Kline;
  calendar_kline?: Kline;
  sync?: boolean;
  calculation_detail?: unknown;
  complete?: boolean;
};

type StockDetail = {
  stock: StockIndexItem & JsonMap;
  annual: PeriodRow[];
  monthly: PeriodRow[];
};

type AppData = {
  generated_at?: string;
  period?: unknown;
  methodology?: unknown;
  stocks: StockIndexItem[];
};

const DEMO_STOCKS: StockIndexItem[] = [
  ["AAPL", "苹果", "信息技术", "S&P 500 · Nasdaq-100", "1980-12-12", "09:30:00", "庚申 戊子 己未 己巳", "火", 57.7, 53.9],
  ["MSFT", "微软", "信息技术", "S&P 500 · Nasdaq-100", "1986-03-13", "09:30:00", "丙寅 辛卯 丙辰 癸巳", "水", 61.5, 56.2],
  ["NVDA", "英伟达", "信息技术", "S&P 500 · Nasdaq-100", "1999-01-22", "09:30:00", "戊寅 乙丑 甲戌 己巳", "火", 65.4, 58.1],
  ["AMZN", "亚马逊", "非必需消费", "S&P 500 · Nasdaq-100", "1997-05-15", "09:30:00", "丁丑 乙巳 丁巳 乙巳", "金", 53.8, 51.7],
  ["META", "Meta Platforms", "通信服务", "S&P 500 · Nasdaq-100", "2012-05-18", "11:30:00", "壬辰 乙巳 己卯 庚午", "水", 61.5, 57.4],
  ["GOOGL", "Alphabet A", "通信服务", "S&P 500 · Nasdaq-100", "2004-08-19", "11:56:00", "甲申 壬申 庚午 壬午", "木", 59.1, 54.8],
  ["TSLA", "特斯拉", "非必需消费", "S&P 500 · Nasdaq-100", "2010-06-29", "09:30:00", "庚寅 壬午 庚戌 辛巳", "水", 60.0, 55.6],
  ["MU", "美光科技", "信息技术", "S&P 500 · Nasdaq-100", "1984-06-01", "09:30:00", "甲子 己巳 丙寅 癸巳", "木", 55.6, 52.8],
  ["LLY", "礼来", "医疗保健", "S&P 500", "1952-04-23", "09:30:00", "壬辰 甲辰 己亥 己巳", "火", 63.0, 56.5],
  ["XOM", "埃克森美孚", "能源", "S&P 500", "1920-03-25", "09:30:00", "庚申 己卯 壬辰 乙巳", "金", 51.9, 50.6],
  ["CEG", "星座能源", "公用事业", "S&P 500 · Nasdaq-100", "2022-02-02", "09:30:00", "辛丑 辛丑 丙戌 癸巳", "木", 66.7, 59.1],
  ["NEM", "纽蒙特", "原材料", "S&P 500", "1940-06-30", "09:30:00", "庚辰 壬午 甲辰 己巳", "水", 48.1, 49.7],
].map((row) => ({
  ticker: String(row[0]), name: String(row[1]), sector: String(row[2]), index_membership: String(row[3]),
  listing_date: String(row[4]), time_et: String(row[5]), bazi: String(row[6]), main_god: String(row[7]),
  annual_hit_rate: Number(row[8]), monthly_hit_rate: Number(row[9]), annual_samples: 26, monthly_samples: 312,
  listing_time_basis: row[0] === "META" || row[0] === "GOOGL" ? { basis: "precise_first_trade", confidence: "高" } : { basis: "market_data_proxy", confidence: "低" },
}));

const STEM_BRANCHES = ["己卯", "庚辰", "辛巳", "壬午", "癸未", "甲申", "乙酉", "丙戌", "丁亥", "戊子", "己丑", "庚寅", "辛卯", "壬辰", "癸巳", "甲午", "乙未", "丙申", "丁酉", "戊戌", "己亥", "庚子", "辛丑", "壬寅", "癸卯", "甲辰", "乙巳"];
const MONTH_NAMES = ["寅月", "卯月", "辰月", "巳月", "午月", "未月", "申月", "酉月", "戌月", "亥月", "子月", "丑月"];

function seedFor(text: string) {
  return [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function makeDemoDetail(stock: StockIndexItem): StockDetail {
  const seed = seedFor(stock.ticker);
  const listYear = Math.max(1999, Number(stock.listing_date?.slice(0, 4)) || 1999);
  let close = 18 + (seed % 70);
  const annual: PeriodRow[] = [];
  for (let year = listYear; year <= 2025; year += 1) {
    const i = year - 1999;
    const open = close;
    const change = Math.sin((i + seed) * 0.83) * 0.28 + Math.cos((i + seed) * 0.29) * 0.19 + 0.09;
    close = Math.max(2, open * (1 + change));
    const high = Math.max(open, close) * (1.08 + Math.abs(Math.sin(i + seed)) * 0.12);
    const low = Math.min(open, close) * (0.91 - Math.abs(Math.cos(i + seed)) * 0.08);
    const score = Math.round((Math.sin((i + seed) * 0.61) * 3.1 + Math.cos(i * 0.31) * 1.1) * 10) / 10;
    const predicted = score >= 1 ? "up" : score <= -1 ? "down" : "neutral";
    const actual = change > 0.01 ? "up" : change < -0.01 ? "down" : "neutral";
    annual.push({
      year, pillar: STEM_BRANCHES[i % STEM_BRANCHES.length], start_et: `${year}-02-04`, end_et: `${year + 1}-02-03`,
      big_luck_score: Math.round(Math.sin((i + seed) * 0.41) * 4 * 10) / 10,
      annual_score: Math.round(Math.cos((i + seed) * 0.57) * 4 * 10) / 10,
      total_score: score, status: score >= 3 ? "强势偏涨" : score >= 1 ? "偏涨" : score <= -3 ? "强势偏跌" : score <= -1 ? "偏跌" : "中性",
      predicted_direction: predicted, kline: { open, high, low, close, return: change * 100, direction: actual }, sync: predicted === actual,
      calculation_detail: `大运60% + 流年40% = ${score.toFixed(1)}`,
    });
  }
  let monthClose = annual[Math.max(0, annual.length - 4)]?.kline?.close || close * 0.7;
  const monthly: PeriodRow[] = [];
  for (let year = 2022; year <= 2025; year += 1) {
    for (let m = 0; m < 12; m += 1) {
      const idx = (year - 2022) * 12 + m;
      const open = monthClose;
      const change = Math.sin((idx + seed) * 1.17) * 0.075 + Math.cos((idx + seed) * 0.37) * 0.045 + 0.008;
      monthClose = Math.max(1, open * (1 + change));
      const score = Math.round(Math.sin((idx + seed) * 0.47) * 4.2 * 10) / 10;
      const predicted = score >= 1 ? "up" : score <= -1 ? "down" : "neutral";
      const actual = change > 0.005 ? "up" : change < -0.005 ? "down" : "neutral";
      const day = String(4 + (m % 3)).padStart(2, "0");
      monthly.push({
        solar_year: year, month_index: m + 1, month_name: MONTH_NAMES[m], pillar: STEM_BRANCHES[(idx + 3) % STEM_BRANCHES.length],
        start_et: `${year}-${String(m + 1).padStart(2, "0")}-${day}`, end_et: `${year}-${String(Math.min(12, m + 2)).padStart(2, "0")}-04`,
        big_luck_score: Math.sin(idx * 0.2) * 4, annual_score: Math.cos(year) * 4,
        year_baseline: Math.sin(year) * 3.5, month_period_score: Math.cos(idx * 0.7) * 4.5, total_score: score,
        status: score >= 1 ? "偏涨" : score <= -1 ? "偏跌" : "中性", predicted_direction: predicted,
        kline: { open, high: Math.max(open, monthClose) * 1.04, low: Math.min(open, monthClose) * 0.96, close: monthClose, return: change * 100, direction: actual },
        sync: predicted === actual, calculation_detail: `36%大运 + 24%流年 + 40%流月 = ${score.toFixed(1)}`,
      });
    }
  }
  return { stock, annual, monthly };
}

function asObject(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function valueAt(source: unknown, keys: string[]): unknown {
  const obj = asObject(source);
  for (const key of keys) if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  return undefined;
}

function metric(source: unknown, keys: string[], fallback?: number) {
  return asNumber(valueAt(source, keys)) ?? fallback;
}

function percent(value: unknown, digits = 1) {
  const n = asNumber(value);
  if (n === undefined) return "—";
  return `${(Math.abs(n) <= 1 ? n * 100 : n).toFixed(digits)}%`;
}

function signedPercent(value: unknown) {
  const n = asNumber(value);
  if (n === undefined) return "—";
  const rounded = Math.abs(n) < 0.05 ? 0 : n;
  return `${rounded >= 0 ? "+" : ""}${rounded.toFixed(1)}%`;
}

function score(value: unknown) {
  const n = asNumber(value);
  if (n === undefined) return "—";
  return (Math.abs(n) < 0.05 ? 0 : n).toFixed(1);
}

function direction(value: unknown): "up" | "down" | "neutral" {
  const raw = String(value ?? "").toLowerCase();
  if (["up", "rise", "bullish", "上涨", "涨", "偏涨"].some((item) => raw.includes(item))) return "up";
  if (["down", "fall", "bearish", "下跌", "跌", "偏跌"].some((item) => raw.includes(item))) return "down";
  return "neutral";
}

function actualDirection(kline: Kline) {
  const raw = direction(kline.direction);
  if (raw !== "neutral") return raw;
  const change = asNumber(kline.return);
  return change === undefined ? "neutral" : change > 0 ? "up" : change < 0 ? "down" : "neutral";
}

function normalizeKline(value: unknown, row?: PeriodRow, prefix = "") : Kline {
  if (Array.isArray(value)) {
    return {
      open: asNumber(value[0]), high: asNumber(value[1]), low: asNumber(value[2]), close: asNumber(value[3]),
      return: asNumber(value[4]), direction: String(value[5] ?? ""),
    };
  }
  const source = asObject(value);
  const holder = asObject(row);
  const read = (key: string) => asNumber(source[key] ?? holder[`${prefix}${key}`] ?? holder[key]);
  return {
    open: read("open"), high: read("high"), low: read("low"), close: read("close"),
    return: asNumber(source.return ?? source.return_pct ?? holder[`${prefix}return`] ?? holder[`${prefix}return_pct`] ?? holder.return_pct ?? holder.return),
    direction: String(source.direction ?? holder[`${prefix}direction`] ?? holder.actual_direction ?? ""),
  };
}

function periodKline(row: PeriodRow): Kline {
  return normalizeKline(row.period_kline ?? row.kline, row, "period_");
}

function calendarKline(row: PeriodRow): Kline {
  return normalizeKline(row.calendar_kline ?? row.calendar_year_kline ?? row.calendar_month_kline, row, "calendar_");
}

function summarizePeriods(rows: PeriodRow[]) {
  const completeRows = rows.filter((row) => row.complete === true && periodKline(row).open !== undefined);
  const directionalRows = completeRows.filter((row) => direction(row.predicted_direction) !== "neutral");
  return {
    complete: completeRows.length,
    directional: directionalRows.length,
    neutral: completeRows.length - directionalRows.length,
    hits: directionalRows.filter((row) => row.sync === true).length,
  };
}

function directionLabel(value: unknown) {
  const d = direction(value);
  return d === "up" ? "看涨" : d === "down" ? "看跌" : "中性";
}

function normalizeIndex(payload: unknown): AppData {
  const root = asObject(payload);
  const list = Array.isArray(root.stocks) ? root.stocks : Array.isArray(payload) ? payload : [];
  const stocks = list.map((item) => {
    const row = asObject(item);
    return {
      ...row,
      ticker: String(row.ticker ?? row.symbol ?? ""),
      name: String(row.name ?? row.company ?? row.ticker ?? "—"),
      sector: String(row.sector ?? row.gics_sector ?? "未分类"),
      index_membership: Array.isArray(row.index_membership) ? row.index_membership.join(" · ") : String(row.index_membership ?? row.index ?? "—"),
      annual_hit_rate: asNumber(row.annual_hit_rate), monthly_hit_rate: asNumber(row.monthly_hit_rate),
      annual_samples: asNumber(row.annual_samples), monthly_samples: asNumber(row.monthly_samples),
      annual_complete_periods: asNumber(row.annual_complete_periods), annual_neutral_periods: asNumber(row.annual_neutral_periods), annual_hits: asNumber(row.annual_hits),
      monthly_complete_periods: asNumber(row.monthly_complete_periods), monthly_neutral_periods: asNumber(row.monthly_neutral_periods), monthly_hits: asNumber(row.monthly_hits),
    } as StockIndexItem;
  }).filter((item) => item.ticker);
  return { generated_at: String(root.generated_at ?? ""), period: root.period, methodology: root.methodology, stocks };
}

function componentScore(value: unknown) {
  const direct = asNumber(value);
  if (direct !== undefined) return direct;
  const obj = asObject(value);
  return asNumber(obj.period_score ?? obj.score ?? obj.weighted_score);
}

function normalizePeriodRow(value: unknown): PeriodRow {
  const row = asObject(value) as PeriodRow;
  const period = asObject(row.period);
  const calculation = asObject(row.calculation);
  const annualComponent = calculation.annual_component ?? calculation.annual;
  const monthComponent = calculation.month_component ?? calculation.month;
  const bigLuck = calculation.big_luck_weighted_score ?? calculation.big_luck;
  return {
    ...row,
    year: asNumber(row.year ?? row.solar_year),
    solar_year: asNumber(row.solar_year ?? row.year),
    month_name: String(row.month_name ?? row.jie_name ?? ""),
    start_et: String(row.start_et ?? period.start_et ?? ""),
    end_et: String(row.end_et ?? period.end_et ?? ""),
    big_luck_score: asNumber(row.big_luck_score) ?? componentScore(bigLuck),
    annual_score: asNumber(row.annual_score) ?? componentScore(calculation.annual_period_score ?? annualComponent),
    month_period_score: asNumber(row.month_period_score) ?? componentScore(monthComponent),
  };
}

function calculationText(row: PeriodRow, period: "annual" | "monthly") {
  if (typeof row.calculation_detail === "string") return row.calculation_detail;
  const calculation = asObject(row.calculation);
  const rawSegments = calculation.big_luck_segments ?? calculation.segments;
  const segments = Array.isArray(rawSegments) ? rawSegments.map((segment) => {
    if (Array.isArray(segment)) return `${segment[0] ?? "—"} ${percent(segment[1], 1)}×${score(segment[2])}`;
    const item = asObject(segment);
    return `${item.pillar ?? "—"} ${percent(item.weight ?? item.elapsed_weight, 1)}×${score(item.period_score)}`;
  }).join("；") : "—";
  const annualComponent = asObject(calculation.annual_component ?? calculation.annual);
  const monthComponent = asObject(calculation.month_component ?? calculation.month);
  const describe = (component: JsonMap) => [
    component.state ? `长生${component.state}(${component.state_score ?? "—"})` : "",
    component.stem_relation_code ? `天干${component.stem_relation_code}(${component.stem_final_score ?? component.stem_base_score ?? "—"})` : "",
    component.combo_name && component.combo_name !== "—" ? `${component.combo_name}修正${component.combo_adjustment ?? 0}` : "",
  ].filter(Boolean).join("、");
  const annualExtra = describe(annualComponent);
  const monthExtra = describe(monthComponent);
  return period === "annual"
    ? `大运 ${score(row.big_luck_score)} [${segments}]；流年 ${score(row.annual_score)}${annualExtra ? `（${annualExtra}）` : ""}；60%×大运 + 40%×流年 = ${score(row.total_score)}`
    : `大运 ${score(row.big_luck_score)} [${segments}]；流年 ${score(row.annual_score)}；流月 ${score(row.month_period_score)}${monthExtra ? `（${monthExtra}）` : ""}；36%×大运 + 24%×流年 + 40%×流月 = ${score(row.total_score)}`;
}

function normalizeDetail(payload: unknown, fallback: StockIndexItem, summaryPayload?: unknown): StockDetail {
  const root = asObject(payload);
  const calendar = Array.isArray(asObject(summaryPayload).calendar) ? asObject(summaryPayload).calendar as unknown[] : [];
  const hydrate = (value: unknown, isMonthly: boolean) => {
    const row = normalizePeriodRow(value);
    const yearEntry = calendar.map(asObject).find((entry) => asNumber(entry.year) === row.year);
    const monthEntry = isMonthly && yearEntry && Array.isArray(yearEntry.months)
      ? yearEntry.months.map(asObject).find((entry) => asNumber(entry.month_index) === row.month_index)
      : undefined;
    const periodEntry = monthEntry ?? yearEntry ?? {};
    return {
      ...row,
      pillar: row.pillar ?? String(periodEntry.pillar ?? ""),
      month_name: row.month_name || String(periodEntry.jie_name ?? ""),
      start_et: row.start_et || String(periodEntry.start_et ?? ""),
      end_et: row.end_et || String(periodEntry.end_et ?? ""),
      calendar_month: row.calendar_month ?? periodEntry.calendar_month,
      boundary_intraday: row.boundary_intraday ?? periodEntry.boundary_intraday,
    } as PeriodRow;
  };
  return {
    stock: { ...fallback, ...asObject(root.stock) } as StockIndexItem & JsonMap,
    annual: Array.isArray(root.annual) ? root.annual.map((row) => hydrate(row, false)) : [],
    monthly: Array.isArray(root.monthly) ? root.monthly.map((row) => hydrate(row, true)) : [],
  };
}

function normalizeBasis(input: unknown, stocks: StockIndexItem[]) {
  const labels: Record<string, string> = {
    precise_first_trade: "精确首笔", exact_first_trade: "精确首笔", class_open: "股类开盘",
    share_class_open: "股类开盘", regular_open: "常规开盘", market_open: "常规开盘",
    market_data_proxy: "行情起点代理", price_start_proxy: "行情起点代理", proxy: "行情起点代理",
    精确首笔: "精确首笔", 股类开盘: "股类开盘", 常规开盘: "常规开盘", 行情起点代理: "行情起点代理",
  };
  const order = ["精确首笔", "股类开盘", "常规开盘", "行情起点代理"];
  const details = new Map(order.map((label) => [label, { label, count: 0, annualHit: undefined as number | undefined, monthlyHit: undefined as number | undefined, confidence: "" }]));
  if (Array.isArray(input)) {
    input.forEach((entry) => {
      const row = asObject(entry);
      const raw = String(row.listing_time_basis ?? row.basis ?? row.key ?? row.label ?? "其他");
      const label = labels[raw] ?? raw;
      const current = details.get(label) ?? { label, count: 0, annualHit: undefined, monthlyHit: undefined, confidence: "" };
      details.set(label, {
        ...current,
        count: current.count + (asNumber(row.stock_count ?? row.count) || 0),
        annualHit: metric(row.annual, ["hit_rate"]), monthlyHit: metric(row.monthly, ["hit_rate"]), confidence: String(row.confidence ?? ""),
      });
    });
  } else {
    Object.entries(asObject(input)).forEach(([key, raw]) => {
      const label = labels[key] ?? String(asObject(raw).label ?? key);
      const current = details.get(label) ?? { label, count: 0, annualHit: undefined, monthlyHit: undefined, confidence: "" };
      details.set(label, { ...current, count: current.count + (asNumber(asObject(raw).stock_count ?? asObject(raw).count) ?? asNumber(raw) ?? 0) });
    });
  }
  if ([...details.values()].every((item) => item.count === 0)) {
    stocks.forEach((stock) => {
      const basis = asObject(stock.listing_time_basis);
      const key = typeof stock.listing_time_basis === "string" ? stock.listing_time_basis : String(basis.basis ?? basis.key ?? "market_data_proxy");
      const label = labels[key] ?? "行情起点代理";
      const current = details.get(label) ?? { label, count: 0, annualHit: undefined, monthlyHit: undefined, confidence: "" };
      details.set(label, { ...current, count: current.count + 1 });
    });
  }
  return [...details.values()];
}

function basisInfo(input: unknown) {
  const obj = asObject(input);
  const raw = typeof input === "string" ? input : String(obj.basis ?? obj.key ?? obj.label ?? "market_data_proxy");
  const map: Record<string, { label: string; confidence: string; proxy: boolean }> = {
    precise_first_trade: { label: "精确首笔成交", confidence: "高", proxy: false },
    exact_first_trade: { label: "精确首笔成交", confidence: "高", proxy: false },
    class_open: { label: "股类开盘时间", confidence: "中高", proxy: false },
    share_class_open: { label: "股类开盘时间", confidence: "中高", proxy: false },
    regular_open: { label: "常规开盘时间", confidence: "中", proxy: true },
    market_open: { label: "常规开盘时间", confidence: "中", proxy: true },
    market_data_proxy: { label: "行情起点代理", confidence: "低", proxy: true },
    price_start_proxy: { label: "行情起点代理", confidence: "低", proxy: true },
    精确首笔: { label: "精确首笔成交", confidence: "高", proxy: false },
    股类开盘: { label: "股类开盘时间", confidence: "中高", proxy: false },
    常规开盘: { label: "常规开盘时间", confidence: "中", proxy: true },
    行情起点代理: { label: "行情起点代理", confidence: "低", proxy: true },
  };
  const found = map[raw] ?? { label: String(obj.label ?? raw ?? "未说明"), confidence: String(obj.confidence ?? "待核验"), proxy: true };
  const confidenceRaw = String(obj.confidence ?? found.confidence);
  const confidenceMap: Record<string, string> = { high: "高", medium_high: "中高", medium: "中", low: "低", low_proxy: "低（代理）" };
  return { ...found, confidence: confidenceMap[confidenceRaw] ?? confidenceRaw };
}

async function fetchJson(path: string) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json();
}

function MiniBars({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  return <div className="mini-bars" aria-hidden="true">{values.map((v, i) => <i key={i} style={{ height: `${Math.max(10, (v / max) * 100)}%` }} />)}</div>;
}

function KlineChart({ rows, period, klineMode }: { rows: PeriodRow[]; period: "annual" | "monthly"; klineMode: "period" | "calendar" }) {
  const bars = rows.filter((row) => {
    const k = klineMode === "period" ? periodKline(row) : calendarKline(row);
    return k.open !== undefined || k.close !== undefined;
  }).slice(period === "annual" ? -30 : -48);
  const [active, setActive] = useState(Math.max(0, bars.length - 1));
  if (!bars.length) return <div className="chart-empty"><span>暂无可绘制的 K 线</span><small>数据文件生成后将自动显示</small></div>;
  const chartWidth = 1000;
  const chartHeight = 350;
  const top = 34;
  const bottom = 48;
  const left = 22;
  const right = 22;
  const all = bars.flatMap((row) => {
    const k = klineMode === "period" ? periodKline(row) : calendarKline(row);
    return [k.low, k.high].filter((n): n is number => typeof n === "number");
  });
  const min = Math.min(...all);
  const max = Math.max(...all);
  const spread = Math.max(max - min, max * 0.08, 1);
  const y = (n: number) => top + ((max + spread * 0.08 - n) / (spread * 1.16)) * (chartHeight - top - bottom);
  const cell = (chartWidth - left - right) / bars.length;
  const candle = Math.max(3, Math.min(12, cell * 0.48));
  const scorePoints = bars.map((row, i) => {
    const s = Math.max(-5, Math.min(5, asNumber(row.total_score) ?? 0));
    const px = left + cell * (i + 0.5);
    const py = top + ((5 - s) / 10) * (chartHeight - top - bottom);
    return `${px},${py}`;
  }).join(" ");
  const current = bars[Math.min(active, bars.length - 1)];
  const currentK = current ? (klineMode === "period" ? periodKline(current) : calendarKline(current)) : {};
  const labelFor = (row: PeriodRow) => period === "annual" ? String(row.year ?? row.solar_year ?? "—") : `${row.solar_year ?? ""} ${row.month_name ?? row.month_index ?? ""}`;
  return (
    <div className="chart-wrap">
      <div className="chart-readout" aria-live="polite">
        <strong>{labelFor(current)}</strong><span>开 {score(currentK.open)}</span><span>高 {score(currentK.high)}</span><span>低 {score(currentK.low)}</span><span>收 {score(currentK.close)}</span>
        <b className={direction(currentK.direction ?? currentK.return)}>{signedPercent(currentK.return)}</b><span>模型 {score(current.total_score)}</span><em className={direction(current.predicted_direction)}>{directionLabel(current.predicted_direction)}</em>
      </div>
      <svg className="kline-svg" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={`${period === "annual" ? "年" : "节气月"}K线与模型信号叠加图`}>
        {[0, 1, 2, 3, 4].map((i) => <line key={i} x1={left} x2={chartWidth - right} y1={top + ((chartHeight - top - bottom) / 4) * i} y2={top + ((chartHeight - top - bottom) / 4) * i} className="grid-line" />)}
        {bars.map((row, i) => {
          const k = klineMode === "period" ? periodKline(row) : calendarKline(row);
          const open = asNumber(k.open) ?? 0;
          const close = asNumber(k.close) ?? open;
          const high = asNumber(k.high) ?? Math.max(open, close);
          const low = asNumber(k.low) ?? Math.min(open, close);
          const x = left + cell * (i + 0.5);
          const actual = actualDirection(k) === "neutral" ? (close >= open ? "up" : "down") : actualDirection(k);
          const prediction = direction(row.predicted_direction ?? row.status);
          const showLabel = i % Math.max(1, Math.ceil(bars.length / 8)) === 0 || i === bars.length - 1;
          return (
            <g key={`${labelFor(row)}-${i}`} className={`candle-group ${active === i ? "active" : ""}`} role="button" tabIndex={0} aria-label={`${labelFor(row)}，实际${actual === "up" ? "上涨" : "下跌"}，预测${directionLabel(prediction)}`} onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)}>
              <rect x={left + cell * i + 1} y={top} width={Math.max(1, cell - 2)} height={chartHeight - top - bottom} className={`signal-band ${prediction}`} />
              <line x1={x} x2={x} y1={y(high)} y2={y(low)} className={`wick ${actual}`} />
              <rect x={x - candle / 2} y={Math.min(y(open), y(close))} width={candle} height={Math.max(2, Math.abs(y(open) - y(close)))} rx="1" className={`candle ${actual}`} />
              <circle cx={x} cy={top - 10} r={active === i ? 5 : 3} className={`prediction-dot ${prediction}`} />
              {showLabel && <text x={x} y={chartHeight - 17} className="axis-label" textAnchor="middle">{period === "annual" ? row.year : `${String(row.solar_year ?? "").slice(2)}/${row.month_index}`}</text>}
            </g>
          );
        })}
        <polyline points={scorePoints} className="score-line" />
        <text x={chartWidth - right} y={top + 7} className="score-axis" textAnchor="end">模型 +5</text>
        <text x={chartWidth - right} y={top + (chartHeight - top - bottom) / 2 + 4} className="score-axis" textAnchor="end">0</text>
        <text x={chartWidth - right} y={chartHeight - bottom} className="score-axis" textAnchor="end">−5</text>
      </svg>
      <div className="chart-legend"><span><i className="legend-candle up" />实际上涨</span><span><i className="legend-candle down" />实际下跌</span><span><i className="legend-line" />命理总分（−5～+5）</span><span><i className="legend-dot up" />预测上涨</span><span><i className="legend-dot down" />预测下跌</span></div>
    </div>
  );
}

export default function Home() {
  const [indexData, setIndexData] = useState<AppData>({ stocks: [] });
  const [summary, setSummary] = useState<JsonMap>({});
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState(false);
  const [notice, setNotice] = useState("");
  const [section, setSection] = useState<"overview" | "universe" | "methodology">("overview");
  const [query, setQuery] = useState("");
  const [indexFilter, setIndexFilter] = useState("全部指数");
  const [sectorFilter, setSectorFilter] = useState("全部板块");
  const [sortBy, setSortBy] = useState("annual");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<StockIndexItem | null>(null);
  const [detail, setDetail] = useState<StockDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailDemo, setDetailDemo] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [period, setPeriod] = useState<"annual" | "monthly">("annual");
  const [klineMode, setKlineMode] = useState<"period" | "calendar">("period");
  const [detailYear, setDetailYear] = useState("全部");

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchJson("/data/index.json"), fetchJson("/data/summary.json")])
      .then(([indexPayload, summaryPayload]) => {
        if (cancelled) return;
        const normalized = normalizeIndex(indexPayload);
        if (!normalized.stocks.length) throw new Error("empty");
        setIndexData(normalized);
        setSummary(asObject(summaryPayload));
      })
      .catch(() => {
        if (cancelled) return;
        setIndexData({ generated_at: "演示预览", period: { start: 1999, end: 2025 }, stocks: DEMO_STOCKS });
        setSummary({
          coverage: { stocks: 518, start_year: 1999, end_year: 2025, trading_days: 3066177 },
          annual_metrics: { hit_rate: 0.584, samples: 6842, up_hit_rate: 0.617, down_hit_rate: 0.531 },
          monthly_metrics: { hit_rate: 0.537, samples: 76420 }, baselines: { always_up: 0.552 },
          basis_breakdown: { precise_first_trade: 3, class_open: 1, regular_open: 234, market_data_proxy: 280 },
          data_quality: { survivor_bias: true, adjustment_factor_gaps: 17 },
        });
        setDemo(true);
        setNotice("回测数据正在生成，当前以演示数据预览页面结构；文件就绪后会自动切换为真实结果。");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const stocks = indexData.stocks;
  const sectors = useMemo(() => [...new Set(stocks.map((stock) => stock.sector).filter(Boolean))].sort(), [stocks]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stocks.filter((stock) => {
      const matchesQuery = !q || `${stock.ticker} ${stock.name} ${stock.sector}`.toLowerCase().includes(q);
      const matchesIndex = indexFilter === "全部指数" || stock.index_membership.toLowerCase().includes(indexFilter.toLowerCase());
      const matchesSector = sectorFilter === "全部板块" || stock.sector === sectorFilter;
      return matchesQuery && matchesIndex && matchesSector;
    }).sort((a, b) => sortBy === "monthly"
      ? (b.monthly_hit_rate ?? -1) - (a.monthly_hit_rate ?? -1)
      : sortBy === "samples" ? (b.annual_samples ?? 0) - (a.annual_samples ?? 0)
      : sortBy === "ticker" ? a.ticker.localeCompare(b.ticker)
      : (b.annual_hit_rate ?? -1) - (a.annual_hit_rate ?? -1));
  }, [stocks, query, indexFilter, sectorFilter, sortBy]);
  const pageSize = 15;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  async function openStock(stock: StockIndexItem) {
    setSelected(stock);
    setDetail(null);
    setDetailLoading(true);
    setDetailDemo(false);
    setDetailError("");
    setDetailYear("全部");
    try {
      const payload = await fetchJson(`/data/stocks/${encodeURIComponent(stock.ticker)}.json`);
      const normalized = normalizeDetail(payload, stock, summary);
      if (!normalized.annual.length && !normalized.monthly.length) throw new Error("empty");
      setDetail(normalized);
    } catch {
      if (demo) {
        setDetail(makeDemoDetail(stock));
        setDetailDemo(true);
      } else {
        setDetail({ stock, annual: [], monthly: [] });
        setDetailError(`${stock.ticker} 的个股回测文件尚未生成或无法读取。`);
      }
    } finally {
      setDetailLoading(false);
      requestAnimationFrame(() => document.getElementById("stock-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }

  function navigate(next: "overview" | "universe" | "methodology") {
    setSection(next);
    setSelected(null);
    setDetail(null);
    setDetailError("");
    setDetailYear("全部");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const annualMetrics = asObject(summary.annual_metrics);
  const monthlyMetrics = asObject(summary.monthly_metrics);
  const coverage = asObject(summary.coverage);
  const baselines = asObject(summary.baselines);
  const annualRate = metric(annualMetrics, ["hit_rate", "accuracy", "sync_rate"], stocks.length ? stocks.reduce((s, x) => s + (x.annual_hit_rate || 0), 0) / stocks.length : undefined);
  const monthlyRate = metric(monthlyMetrics, ["hit_rate", "accuracy", "sync_rate"], stocks.length ? stocks.reduce((s, x) => s + (x.monthly_hit_rate || 0), 0) / stocks.length : undefined);
  const annualBaseline = metric(asObject(baselines.annual_always_up), ["same_evaluable_hit_rate", "all_complete_hit_rate"], metric(baselines, ["always_up", "always_bullish"]));
  const monthlyBaseline = metric(asObject(baselines.monthly_always_up), ["same_evaluable_hit_rate", "all_complete_hit_rate"]);
  const basis = normalizeBasis(summary.basis_breakdown, stocks);
  const proxyCount = basis.find((item) => item.label === "行情起点代理")?.count ?? 0;
  const yearly = Array.isArray(summary.by_year) ? summary.by_year.map(asObject) : [];
  const sparkValues = yearly.length ? yearly.slice(-16).map((row) => metric(asObject(row.annual), ["hit_rate", "accuracy"], metric(row, ["hit_rate", "accuracy"], 0)) || 0) : [51, 58, 54, 62, 57, 60, 55, 64, 59, 61, 56, 63, 58, 65, 60, 62];
  const periodRows = period === "annual" ? detail?.annual ?? [] : detail?.monthly ?? [];
  const years = [...new Set((detail?.monthly ?? []).map((row) => String(row.solar_year ?? "")).filter(Boolean))];
  const shownRows = detailYear === "全部" ? periodRows : periodRows.filter((row) => String(row.solar_year ?? row.year) === detailYear);
  const detailAnnualCounts = summarizePeriods(detail?.annual ?? []);
  const detailMonthlyCounts = summarizePeriods(detail?.monthly ?? []);
  const selectedBasis = basisInfo({ basis: detail?.stock.listing_time_basis ?? detail?.stock.basis ?? selected?.listing_time_basis, confidence: detail?.stock.basis_confidence ?? selected?.basis_confidence });

  return (
    <main>
      <header className="topbar">
        <button className="brand" onClick={() => navigate("overview")} aria-label="回到总览">
          <span className="brand-mark">运</span><span><strong>年运回测</strong><small>FORTUNE × MARKET</small></span>
        </button>
        <nav aria-label="主导航">
          <button className={section === "overview" ? "active" : ""} onClick={() => navigate("overview")}>市场总览</button>
          <button className={section === "universe" ? "active" : ""} onClick={() => navigate("universe")}>股票全表</button>
          <button className={section === "methodology" ? "active" : ""} onClick={() => navigate("methodology")}>方法与质量</button>
        </nav>
        <div className="data-pill"><i className={demo ? "amber" : "green"} /><span>{demo ? "演示预览" : "本地40年行情"}</span></div>
      </header>

      <div className="page-shell">
        {notice && <div className="notice"><strong>数据状态</strong><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice("")}>×</button></div>}
        {loading ? <div className="loading-screen"><i /><strong>正在装载历史回测</strong><span>连接股票索引、年运与节气月运数据…</span></div> : (
          <>
            {section === "overview" && (
              <>
                <section className="hero">
                  <div className="hero-copy"><span className="eyebrow">1999—2025 · OUT-OF-SAMPLE REVIEW</span><h1>命理信号，放进真实<br /><em>年K与节气月K</em>检验。</h1><p>先看过去能否同步，再谈未来。固定使用现行参数，逐只股票对照复权行情，不用结果反向调参。</p><div className="hero-actions"><button className="primary" onClick={() => navigate("universe")}>查看全部股票 <span>→</span></button><button onClick={() => navigate("methodology")}>阅读计算口径</button></div></div>
                  <div className="hero-terminal" aria-label="回测快照"><div className="terminal-head"><span><i /> BACKTEST / AGGREGATE</span><b>ET · 节气切分</b></div><MiniBars values={sparkValues} /><div className="terminal-stats"><div><span>年运同步率</span><strong>{percent(annualRate)}</strong></div><div><span>月运同步率</span><strong>{percent(monthlyRate)}</strong></div><div><span>股票覆盖</span><strong>{metric(coverage, ["stocks", "stock_count", "stock_count_with_prices"], stocks.length || 518)}</strong></div></div></div>
                </section>

                <section className="kpi-strip" aria-label="市场回测关键指标">
                  <div><span>覆盖股票</span><strong>{metric(coverage, ["stocks", "stock_count", "stock_count_with_prices"], stocks.length || 518)}</strong><small>S&P 500 ∪ Nasdaq-100</small></div>
                  <div><span>回测区间</span><strong>{metric(coverage, ["start_year"], 1999)}—{metric(coverage, ["end_year"], 2025)}</strong><small>上市后首个有效周期起</small></div>
                  <div><span>年运方向样本</span><strong>{metric(annualMetrics, ["directional_samples", "samples", "sample_count"])?.toLocaleString() ?? "—"}</strong><small>立春至下一立春</small></div>
                  <div><span>节气月方向样本</span><strong>{metric(monthlyMetrics, ["directional_samples", "samples", "sample_count"])?.toLocaleString() ?? "—"}</strong><small>十二节气月独立预测</small></div>
                  <div><span>永久看涨基准</span><strong>{percent(annualBaseline)}</strong><small>同一可判定年运样本</small></div>
                </section>

                <section className="overview-grid">
                  <article className="panel signal-panel">
                    <div className="panel-head"><div><span className="eyebrow">MODEL VALIDATION</span><h2>方向同步率</h2></div><span className="panel-note">中性信号单列，不混入方向命中</span></div>
                    <div className="accuracy-stage"><div className="accuracy-ring" style={{ "--value": `${Math.max(0, Math.min(100, (annualRate ?? 0) <= 1 ? (annualRate ?? 0) * 100 : (annualRate ?? 0)))}%` } as React.CSSProperties}><div><strong>{percent(annualRate)}</strong><span>年运总体</span></div></div><div className="accuracy-breakdown"><div><span>预测上涨命中</span><b className="up">{percent(metric(annualMetrics, ["up_hit_rate", "bullish_hit_rate"]))}</b><i><em style={{ width: percent(metric(annualMetrics, ["up_hit_rate", "bullish_hit_rate"], 0)) }} /></i></div><div><span>预测下跌命中</span><b className="down">{percent(metric(annualMetrics, ["down_hit_rate", "bearish_hit_rate"]))}</b><i><em className="red" style={{ width: percent(metric(annualMetrics, ["down_hit_rate", "bearish_hit_rate"], 0)) }} /></i></div><div><span>节气月独立命中</span><b>{percent(monthlyRate)}</b><i><em className="violet" style={{ width: percent(monthlyRate ?? 0) }} /></i></div></div></div>
                    <div className="model-verdict"><span>基准检验</span><div><strong>当前年运 {percent(annualRate)}</strong><i>低于</i><b>永久看涨 {percent(annualBaseline)}</b></div><div><strong>当前月运 {percent(monthlyRate)}</strong><i>低于</i><b>永久看涨 {percent(monthlyBaseline)}</b></div><p>首轮结果尚不支持该方法具备超越简单方向基准的历史预测优势。</p></div>
                    <div className="formula-ribbon"><span>月运总分</span><strong>36% 大运</strong><i>+</i><strong>24% 流年</strong><i>+</i><strong>40% 流月</strong></div>
                  </article>
                  <article className="panel basis-panel">
                    <div className="panel-head"><div><span className="eyebrow">TIME BASIS AUDIT</span><h2>上市时间依据</h2></div><span className="panel-note">时刻可信度直接影响时柱</span></div>
                    <div className="basis-list">{basis.map((item, index) => <div key={item.label}><span><i className={`basis-color c${index}`} />{item.label}</span><strong>{item.count}</strong><em>年 {percent(item.annualHit)} · 月 {percent(item.monthlyHit)}</em></div>)}</div>
                    <div className="warning-card"><span>!</span><div><strong>{proxyCount || 280} 只股票使用行情起点代理</strong><p>代理时刻只用于敏感性回测，不等同真实首笔成交，也不能称为“真实 IPO 八字”。个股页会逐一标出依据与置信度。</p></div></div>
                  </article>
                </section>

                <section className="panel sample-table-panel"><div className="panel-head"><div><span className="eyebrow">QUICK LOOK</span><h2>代表股票回测</h2></div><button className="text-button" onClick={() => navigate("universe")}>打开完整股票池 →</button></div><StockTable rows={stocks.slice(0, 8)} onOpen={openStock} /></section>
              </>
            )}

            {section === "universe" && (
              <section className="universe-section">
                <div className="section-title"><span className="eyebrow">STOCK UNIVERSE</span><h1>全部股票回测</h1><p>搜索代码或公司，按指数、板块与命中率筛选。点击任一股票进入年运与节气月运明细。</p></div>
                <div className="toolbar panel"><label className="search-box"><span>⌕</span><input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="搜索 AAPL、苹果、信息技术…" aria-label="搜索股票" />{query && <button onClick={() => { setQuery(""); setPage(1); }} aria-label="清除搜索">×</button>}</label><select value={indexFilter} onChange={(e) => { setIndexFilter(e.target.value); setPage(1); }} aria-label="按指数筛选"><option>全部指数</option><option>S&P 500</option><option>Nasdaq-100</option></select><select value={sectorFilter} onChange={(e) => { setSectorFilter(e.target.value); setPage(1); }} aria-label="按板块筛选"><option>全部板块</option>{sectors.map((sector) => <option key={sector}>{sector}</option>)}</select><select value={sortBy} onChange={(e) => { setSortBy(e.target.value); setPage(1); }} aria-label="排序"><option value="annual">年运方向命中率 ↓</option><option value="monthly">月运方向命中率 ↓</option><option value="samples">方向样本 ↓</option><option value="ticker">代码 A—Z</option></select></div>
                <div className="result-meta"><span>找到 <strong>{filtered.length}</strong> 只股票</span><small>命中率仅反映历史样本，不代表未来收益</small></div>
                <div className="panel full-table"><StockTable rows={visible} onOpen={openStock} /><div className="pagination"><button disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← 上一页</button><span>第 {page} / {totalPages} 页</span><button disabled={page === totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>下一页 →</button></div></div>
              </section>
            )}

            {section === "methodology" && <Methodology summary={summary} basis={basis} proxyCount={proxyCount} />}

            {selected && (
              <section id="stock-detail" className="stock-detail">
                <div className="detail-top"><button className="back-button" onClick={() => { setSelected(null); setDetail(null); }}>← 关闭个股详情</button><span>{detailDemo ? "演示详情 · 数据文件就绪后自动替换" : "本地历史数据"}</span></div>
                {detailLoading || !detail ? <div className="loading-screen compact"><i /><strong>正在读取 {selected.ticker}</strong></div> : (
                  <>
                    <header className="stock-hero panel"><div className="stock-identity"><span className="ticker-avatar">{selected.ticker.slice(0, 3)}</span><div><span className="eyebrow">{detail.stock.index_membership || selected.index_membership}</span><h1>{detail.stock.ticker} <em>{detail.stock.name}</em></h1><p>{detail.stock.sector} · 上市 {detail.stock.listing_date || "—"} {detail.stock.time_et || "—"} ET</p></div></div><div className="stock-bazi"><div><span>上市时刻推算八字</span><strong>{String(detail.stock.bazi ?? "—")}</strong></div><div><span>主用神</span><strong>{String(detail.stock.main_god ?? "—")}</strong></div></div><div className={`basis-badge ${selectedBasis.proxy ? "proxy" : "verified"}`}><span>{selectedBasis.label}</span><strong>置信度 {selectedBasis.confidence}</strong></div></header>
                    {detailError && <div className="detail-warning"><strong>数据暂缺</strong><span>{detailError} 页面不会用模拟行情代替生产结果。</span></div>}
                    {selectedBasis.proxy && <div className="detail-warning"><strong>时刻依据警示</strong><span>本股票使用“{selectedBasis.label}”，并非已核实的真实首笔成交时刻；八字与结果应视为代理口径敏感性测试。</span></div>}
                    <div className="detail-kpis"><div><span>年运方向命中率</span><strong>{percent(detail.stock.annual_hit_rate)}</strong><small>命中 {detailAnnualCounts.hits}/{detailAnnualCounts.directional} · 完整 {detailAnnualCounts.complete} · 中性 {detailAnnualCounts.neutral}</small></div><div><span>节气月方向命中率</span><strong>{percent(detail.stock.monthly_hit_rate)}</strong><small>命中 {detailMonthlyCounts.hits}/{detailMonthlyCounts.directional} · 完整 {detailMonthlyCounts.complete} · 中性 {detailMonthlyCounts.neutral}</small></div><div><span>起始年份</span><strong>{detail.annual[0]?.year ?? "—"}</strong><small>上市后有效行情起</small></div><div><span>最新年运</span><strong className={direction(detail.annual.at(-1)?.predicted_direction)}>{directionLabel(detail.annual.at(-1)?.predicted_direction)}</strong><small>总分 {score(detail.annual.at(-1)?.total_score)}</small></div></div>
                    <div className="detail-layout"><article className="panel chart-panel"><div className="chart-head"><div><span className="eyebrow">SIGNAL OVERLAY</span><h2>{period === "annual" ? "年运 × 年K" : "流月 × 节气月K"}</h2><div className="kline-basis-tabs" aria-label="行情周期口径"><button className={klineMode === "period" ? "active" : ""} onClick={() => setKlineMode("period")}>命理周期K · 主验证</button><button className={klineMode === "calendar" ? "active" : ""} onClick={() => setKlineMode("calendar")}>标准日历K · 辅助</button></div></div><div className="period-tabs"><button className={period === "annual" ? "active" : ""} onClick={() => { setPeriod("annual"); setDetailYear("全部"); }}><strong>年K</strong><small>流年</small></button><button className={period === "monthly" ? "active" : ""} onClick={() => setPeriod("monthly")}><strong>节气月K</strong><small>流月</small></button></div></div><KlineChart rows={shownRows} period={period} klineMode={klineMode} /></article><aside className="side-stack"><article className="panel score-card"><div className="panel-head"><div><span className="eyebrow">SCORE WEIGHTS</span><h3>固定权重</h3></div></div>{period === "annual" ? <div className="weight-bars"><div><span>大运</span><i><em style={{ width: "60%" }} /></i><strong>60%</strong></div><div><span>流年</span><i><em className="violet" style={{ width: "40%" }} /></i><strong>40%</strong></div></div> : <div className="weight-bars"><div><span>大运</span><i><em style={{ width: "36%" }} /></i><strong>36%</strong></div><div><span>流年</span><i><em className="violet" style={{ width: "24%" }} /></i><strong>24%</strong></div><div><span>流月</span><i><em className="cyan" style={{ width: "40%" }} /></i><strong>40%</strong></div></div>}<p>模型分数范围 −5 至 +5；参数在全部年份固定。</p></article><article className="panel sync-card"><span>命理周期K · 主同步率</span><strong>{percent(shownRows.length ? shownRows.filter((row) => row.sync === true).length / Math.max(1, shownRows.filter((row) => typeof row.sync === "boolean").length) : undefined)}</strong><p>{shownRows.filter((row) => row.sync === true).length} 次同步 / {shownRows.filter((row) => typeof row.sync === "boolean").length} 次可判定；日历K不混入主命中率。</p></article></aside></div>
                    <article className="panel calc-panel"><div className="panel-head"><div><span className="eyebrow">CALCULATION LEDGER</span><h2>逐期计算与行情核对</h2></div>{period === "monthly" && <select value={detailYear} onChange={(e) => setDetailYear(e.target.value)} aria-label="选择年份"><option>全部</option>{years.map((year) => <option key={year}>{year}</option>)}</select>}</div><CalculationTable rows={shownRows.slice().reverse()} period={period} /></article>
                  </>
                )}
              </section>
            )}
          </>
        )}
        <footer><div><span className="brand-mark small">运</span><strong>年运历史回测</strong></div><p>研究工具 · 非投资建议。历史同步不代表未来表现。</p><span>数据周期：1999—2025 · ET / 节气月</span></footer>
      </div>
    </main>
  );
}

function StockTable({ rows, onOpen }: { rows: StockIndexItem[]; onOpen: (stock: StockIndexItem) => void }) {
  return <div className="table-scroll"><table><thead><tr><th>股票</th><th>指数 / 板块</th><th>上市时间 ET</th><th>上市时刻推算八字</th><th>主用神</th><th>年运方向命中</th><th>节气月方向命中</th><th>周期构成</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{rows.map((stock) => { const info = basisInfo(stock.listing_time_basis); return <tr key={stock.ticker} onClick={() => onOpen(stock)}><td><div className="stock-cell"><b>{stock.ticker}</b><span>{stock.name}</span></div></td><td><div className="stacked"><span>{stock.index_membership}</span><small>{stock.sector}</small></div></td><td><div className="stacked mono"><span>{stock.listing_date || "—"}</span><small>{stock.time_et || "—"} <em className={info.proxy ? "proxy-text" : "verified-text"}>{info.label}</em></small></div></td><td className="bazi-cell">{stock.bazi || "—"}</td><td><span className="god-chip">{stock.main_god || "—"}</span></td><td><Rate value={stock.annual_hit_rate} complete={stock.annual_complete_periods} directional={stock.annual_samples} hits={stock.annual_hits} /></td><td><Rate value={stock.monthly_hit_rate} complete={stock.monthly_complete_periods} directional={stock.monthly_samples} hits={stock.monthly_hits} /></td><td><PeriodCounts stock={stock} /></td><td><button className="row-arrow" onClick={(event) => { event.stopPropagation(); onOpen(stock); }} aria-label={`查看 ${stock.ticker} 详情`}>→</button></td></tr>; })}</tbody></table>{!rows.length && <div className="empty-state">没有符合条件的股票，请调整筛选。</div>}</div>;
}

function PeriodCounts({ stock }: { stock: StockIndexItem }) {
  return <div className="period-counts mono"><span><b>年</b> 完整 {stock.annual_complete_periods ?? "—"} · 方向 {stock.annual_samples ?? "—"} · 中性 {stock.annual_neutral_periods ?? "—"}</span><small><b>月</b> 完整 {stock.monthly_complete_periods ?? "—"} · 方向 {stock.monthly_samples ?? "—"} · 中性 {stock.monthly_neutral_periods ?? "—"}</small></div>;
}

function Rate({ value, complete, directional, hits }: { value?: number; complete?: number; directional?: number; hits?: number }) {
  const n = value === undefined ? undefined : Math.abs(value) <= 1 ? value * 100 : value;
  const label = n !== undefined ? `${n.toFixed(1)}%` : complete === 0 ? "历史不足" : directional === 0 ? "全部中性" : "—";
  return <div className="rate-cell"><strong>{label}</strong><small>{directional === undefined ? "口径待生成" : `命中 ${hits ?? 0}/${directional}`}</small><i>{n !== undefined && <em style={{ width: `${Math.max(0, Math.min(100, n))}%` }} />}</i></div>;
}

function CalculationTable({ rows, period }: { rows: PeriodRow[]; period: "annual" | "monthly" }) {
  const periodLabel = (row: PeriodRow) => period === "annual" ? `${row.year ?? row.solar_year ?? "—"}` : `${row.solar_year ?? "—"} · ${row.month_name ?? `第${row.month_index ?? "—"}月`}`;
  return (
    <div className="table-scroll calc-scroll">
      <table>
        <thead><tr><th>周期</th><th>干支</th>{period === "monthly" && <th>大运 / 流年 / 流月</th>}<th>总分 / 状态</th><th>预测</th><th>命理周期K（主）</th><th>日历K（辅助）</th><th>主同步</th><th>计算明细</th></tr></thead>
        <tbody>{rows.map((row, i) => {
          const k = periodKline(row);
          const calendar = calendarKline(row);
          const actual = actualDirection(k);
          const calendarActual = actualDirection(calendar);
          return (
            <tr key={`${periodLabel(row)}-${i}`}>
              <td><div className="stacked mono"><span>{periodLabel(row)}</span><small>{String(row.start_et ?? "—").slice(0, 10)} → {String(row.end_et ?? "—").slice(0, 10)}</small></div></td>
              <td><strong className="pillar">{row.pillar || "—"}</strong></td>
              {period === "monthly" && <td><div className="score-triplet"><span>运 {score(row.big_luck_score)}</span><span>年 {score(row.annual_score ?? row.year_baseline)}</span><span>月 {score(row.month_period_score)}</span></div></td>}
              <td><div className="stacked"><span>{score(row.total_score)} · {row.status || "—"}</span><small>{period === "annual" ? "60%大运 + 40%流年" : "36%大运 + 24%流年 + 40%流月"}</small></div></td>
              <td><span className={`direction-chip ${direction(row.predicted_direction)}`}>{directionLabel(row.predicted_direction)}</span></td>
              <td><div className="stacked mono"><span className={actual}>{signedPercent(k.return)}</span><small>O {score(k.open)} · C {score(k.close)}</small></div></td>
              <td><div className="stacked mono"><span className={calendarActual}>{signedPercent(calendar.return)}</span><small>O {score(calendar.open)} · C {score(calendar.close)}</small></div></td>
              <td>{typeof row.sync === "boolean" ? <span className={`sync-dot ${row.sync ? "yes" : "no"}`}>{row.sync ? "同步" : "背离"}</span> : "—"}</td>
              <td className="detail-cell">{calculationText(row, period)}</td>
            </tr>
          );
        })}</tbody>
      </table>
      {!rows.length && <div className="empty-state">该筛选下暂无有效周期。</div>}
    </div>
  );
}

function Methodology({ summary, basis, proxyCount }: { summary: JsonMap; basis: { label: string; count: number }[]; proxyCount: number }) {
  const quality = asObject(summary.data_quality);
  return <section className="method-section"><div className="section-title"><span className="eyebrow">METHODOLOGY & DATA QUALITY</span><h1>先把验证口径说清楚</h1><p>计算规则、行情周期与限制全部公开。任何命中率都必须和数据质量、样本覆盖及简单基准一起看。</p></div><div className="method-grid"><article className="panel method-main"><div className="step"><b>01</b><div><h3>上市时刻 → 股票命盘</h3><p>以美东时间记录上市时刻，确定日干、月令与主用神；按股票年干阴阳决定大运顺逆。时间依据不是精确首笔时，必须标为代理口径。</p></div></div><div className="step"><b>02</b><div><h3>年运固定权重</h3><div className="big-formula"><strong>年运</strong><span>=</span><em>60% 大运</em><span>+</span><em>40% 流年</em></div><p>十二长生状态与天干对主用神的关系共同形成周期分；年内换运按实际天数加权。</p></div></div><div className="step"><b>03</b><div><h3>节气月独立预测</h3><div className="big-formula"><strong>月运</strong><span>=</span><em>36% 大运</em><span>+</span><em>24% 流年</em><span>+</span><em>40% 流月</em></div><p>寅月从立春起，依十二节气月切分。价格也用同一 ET 边界聚合，标准公历月K只作参照。</p></div></div><div className="step"><b>04</b><div><h3>同步判定</h3><p>预测上涨对应周期复权收盘高于开盘、预测下跌对应收盘低于开盘即为同步；中性单列覆盖率，不塞进方向命中率。</p></div></div></article><aside className="method-side"><article className="panel audit-card"><span className="eyebrow">LISTING TIME AUDIT</span><h3>上市时间依据分层</h3>{basis.map((item, index) => <div className="audit-row" key={item.label}><i className={`basis-color c${index}`} /><span>{item.label}</span><strong>{item.count}</strong></div>)}<p className="audit-warning">其中 {proxyCount || 280} 只为行情起点代理，相关命盘不是经核验的真实 IPO 八字。</p></article><article className="panel quality-card"><span className="eyebrow">KNOWN LIMITATIONS</span><h3>数据质量与偏差</h3><ul><li><i className="warn" /><span><strong>幸存者偏差</strong>以当前成分股回看历史，不能代表历史时点的完整指数。</span></li><li><i className="warn" /><span><strong>时间代理误差</strong>常规开盘和行情起点可能改变时柱，需做置信度分层。</span></li><li><i className="ok" /><span><strong>本地复权日线</strong>年K与节气月K从同一底层日线聚合。</span></li><li><i className="ok" /><span><strong>参数冻结</strong>回测期间不按命中率反向调参。</span></li></ul><div className="quality-meta"><span>复权缺口记录</span><strong>{metric(quality, ["adjustment_factor_gaps", "honda_adjustment_gap"], 17)} 个交易日</strong></div></article></aside></div><div className="disclaimer"><strong>研究边界</strong><p>本页面用于检验一套规则与历史行情的统计同步程度，不构成投资建议、收益承诺或因果证明。历史拟合即使高于基准，也可能来自样本选择、市场结构或偶然性。</p></div></section>;
}
