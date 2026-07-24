"use client";

import React, { useEffect, useMemo, useState } from "react";
import styles from "./tenbagger-m0.module.css";

type JsonMap = Record<string, unknown>;

type Prediction = "up" | "neutral" | "down" | "unavailable";
type RowStatus = "up" | "neutral" | "down" | "missing" | "insufficient";

type EventRow = {
  id: string;
  symbol: string;
  companyName: string;
  windowStart: string;
  windowEnd: string;
  firstTenXDate: string;
  eventYear?: number;
  daysToTenX?: number;
  highMultiple?: number;
  valueClass: string;
  marketCategory: string;
  industryElement: string;
  payloadMatched: boolean;
  cycleAttributed: boolean;
  cycleYear?: number;
  cycleStart: string;
  cycleEnd: string;
  cycleComplete: boolean;
  annualActualDirection: Prediction;
  annualActualReturnPct?: number;
  annualActualComplete: boolean;
  priorCompleteYears?: number;
  priorUpYears?: number;
  priorDownYears?: number;
  historyStatus: string;
  eligible: boolean;
  selectedMainGod: string;
  score?: number;
  prediction: Prediction;
  captured: boolean;
  rank?: number;
  yearsCompared?: number;
  percentile?: number;
  status: RowStatus;
};

type PageData = {
  events: EventRow[];
  generatedAt: string;
  schema: string;
  sourceHash: string;
};

const EMPTY_EVENTS: EventRow[] = [];

const STATUS_OPTIONS: { value: RowStatus | "all"; label: string }[] = [
  { value: "all", label: "全部状态" },
  { value: "up", label: "可预测 · 看涨" },
  { value: "neutral", label: "可预测 · 中性" },
  { value: "down", label: "可预测 · 看跌" },
  { value: "missing", label: "缺少年运数据" },
  { value: "insufficient", label: "历史样本不足" },
];

const HISTORY_LABELS: Record<string, string> = {
  eligible: "历史门槛满足",
  missing_stock_annual_payload: "缺少股票年运数据",
  missing_payload: "缺少股票年运数据",
  insufficient_total_history: "完整历史不足 8 年",
  insufficient_prior_up_years: "历史上涨年不足 3 年",
  insufficient_prior_down_years: "历史下跌年不足 3 年",
  incomplete_attribution_cycle: "归属年运 K 线不完整",
  cycle_not_attributed: "无法归属立春年运",
  insufficient_history: "历史样本不足",
};

function asObject(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonMap
    : {};
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return undefined;
}

function pick(source: unknown, keys: string[]): unknown {
  const row = asObject(source);
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
  }
  return undefined;
}

function text(source: unknown, keys: string[], fallback = ""): string {
  const value = pick(source, keys);
  return value === undefined ? fallback : String(value);
}

function number(source: unknown, keys: string[]): number | undefined {
  return asNumber(pick(source, keys));
}

function normalizePrediction(value: unknown): Prediction {
  const numeric = asNumber(value);
  if (numeric !== undefined) {
    if (numeric > 0) return "up";
    if (numeric < 0) return "down";
    return "neutral";
  }
  const raw = String(value ?? "").trim().toLowerCase();
  if (["up", "bull", "rise", "看涨", "上涨", "偏涨"].some((item) => raw.includes(item))) {
    return "up";
  }
  if (["down", "bear", "fall", "看跌", "下跌", "偏跌"].some((item) => raw.includes(item))) {
    return "down";
  }
  if (["neutral", "中性", "震荡"].some((item) => raw.includes(item))) return "neutral";
  return "unavailable";
}

function yearFromDate(value: string): number | undefined {
  const match = /^(\d{4})-/.exec(value);
  return match ? Number(match[1]) : undefined;
}

function normalizeEvent(value: unknown, index: number): EventRow {
  const row = asObject(value);
  const rankSource = asObject(
    pick(asObject(row.same_stock_rank), ["m0_selected_score_past_only"])
      ?? pick(row, ["same_stock_score_rank"]),
  );
  const historyStatus = text(row, ["history_status", "eligibility_status"], "");
  const payloadMatched = asBoolean(pick(row, ["payload_matched", "has_stock_payload"]))
    ?? !["missing_stock_annual_payload", "missing_payload"].includes(historyStatus);
  const eligible = asBoolean(pick(row, ["m0_eligible", "eligible"]))
    ?? historyStatus === "eligible";
  const rawPrediction = pick(row, ["m0_prediction_label", "prediction_label", "prediction", "m0_prediction"]);
  const prediction = eligible ? normalizePrediction(rawPrediction) : "unavailable";
  const missing = !payloadMatched
    || ["missing_stock_annual_payload", "missing_payload"].includes(historyStatus);
  const status: RowStatus = missing
    ? "missing"
    : !eligible
      ? "insufficient"
      : prediction === "up"
        ? "up"
        : prediction === "down"
          ? "down"
          : "neutral";
  const windowStart = text(row, ["window_start", "event_date", "start_date"]);
  const symbol = text(row, ["symbol", "ticker"], "—");

  return {
    id: text(row, ["event_key", "id"], `${symbol}-${windowStart || index}`),
    symbol,
    companyName: text(row, ["company_name", "name"], "—"),
    windowStart,
    windowEnd: text(row, ["window_end", "horizon_end", "end_date"]),
    firstTenXDate: text(row, ["first_10x_date_derived", "first_10x_date"]),
    eventYear: number(row, ["source_calendar_start_year", "event_year"])
      ?? yearFromDate(windowStart),
    daysToTenX: number(row, ["days_to_10x"]),
    highMultiple: number(row, ["strict_high_multiple", "future_365_high_multiple", "high_multiple"]),
    valueClass: text(row, ["value_class"]),
    marketCategory: text(row, ["market_category", "industry", "sector"], "—"),
    industryElement: text(row, ["industry_element", "industry_five_element", "element"], "—"),
    payloadMatched,
    cycleAttributed: asBoolean(pick(row, ["cycle_attributed"])) ?? Boolean(
      number(row, ["attribution_cycle_year", "cycle_year"]),
    ),
    cycleYear: number(row, ["attribution_cycle_year", "cycle_year"]),
    cycleStart: text(row, ["attribution_cycle_start", "cycle_start"]),
    cycleEnd: text(row, ["attribution_cycle_end", "cycle_end"]),
    cycleComplete: asBoolean(pick(row, ["cycle_complete"])) ?? false,
    annualActualDirection: normalizePrediction(pick(row, ["annual_actual_direction"])),
    annualActualReturnPct: number(row, ["annual_actual_return_pct"]),
    annualActualComplete: asBoolean(pick(row, ["annual_actual_complete"])) ?? false,
    priorCompleteYears: number(row, ["prior_complete_years"]),
    priorUpYears: number(row, ["prior_up_years"]),
    priorDownYears: number(row, ["prior_down_years"]),
    historyStatus: historyStatus || (eligible ? "eligible" : missing ? "missing_payload" : "insufficient_history"),
    eligible,
    selectedMainGod: text(row, ["m0_selected_main_god", "selected_main_god", "main_god"], "—"),
    score: number(row, ["m0_score", "score"]),
    prediction,
    captured: eligible && prediction === "up"
      && (asBoolean(pick(row, ["captured"])) ?? true),
    rank: number(rankSource, ["rank_desc", "rank"]),
    yearsCompared: number(rankSource, ["years_compared", "sample_count"]),
    percentile: number(rankSource, ["percentile"]),
    status,
  };
}

function normalizePayload(payload: unknown): PageData {
  const root = asObject(payload);
  const rawEvents = Array.isArray(payload)
    ? payload
    : Array.isArray(root.events)
      ? root.events
      : Array.isArray(root.event_rows)
        ? root.event_rows
        : Array.isArray(root.rows)
          ? root.rows
          : [];
  const freeze = asObject(root.event_pool_freeze ?? root.source_freeze);
  return {
    events: rawEvents.map(normalizeEvent),
    generatedAt: text(root, ["generated_at", "generatedAt"]),
    schema: text(root, ["schema", "schema_version", "model_schema"], "tenbagger-m0"),
    sourceHash: text(root, ["source_sha256"], text(freeze, ["source_sha256"])),
  };
}

async function fetchJson(path: string): Promise<unknown> {
  const relativePath = path.replace(/^\/+/, "");
  const resolvedPath = typeof document === "undefined"
    ? `/${relativePath}`
    : new URL(relativePath, document.baseURI).toString();
  const response = await fetch(resolvedPath, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function integer(value: number | undefined): string {
  return value === undefined ? "—" : Math.round(value).toLocaleString("zh-CN");
}

function decimal(value: number | undefined, digits = 2): string {
  return value === undefined ? "—" : value.toFixed(digits);
}

function percent(value: number | undefined, digits = 2): string {
  return value === undefined ? "—" : `${(value * 100).toFixed(digits)}%`;
}

function scoreText(value: number | undefined): string {
  if (value === undefined) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

function signedPercentValue(value: number | undefined): string {
  if (value === undefined) return "—";
  const rounded = Math.abs(value) < .005 ? 0 : value;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`;
}

function predictionLabel(value: Prediction): string {
  if (value === "up") return "看涨";
  if (value === "down") return "看跌";
  if (value === "neutral") return "中性";
  return "不可计算";
}

function statusLabel(value: RowStatus): string {
  if (value === "up") return "可预测 · 看涨";
  if (value === "down") return "可预测 · 看跌";
  if (value === "neutral") return "可预测 · 中性";
  if (value === "missing") return "缺少年运数据";
  return "历史样本不足";
}

function historyLabel(row: EventRow): string {
  if (!row.cycleAttributed && row.payloadMatched) return "无法归属立春年运";
  return HISTORY_LABELS[row.historyStatus] ?? row.historyStatus.replaceAll("_", " ") ?? "历史样本不足";
}

function dateRange(start: string, end: string): React.ReactNode {
  if (!start && !end) return "—";
  return (
    <>
      {start ? <time dateTime={start}>{start}</time> : "—"}
      <span aria-hidden="true"> → </span>
      {end ? <time dateTime={end}>{end}</time> : "—"}
    </>
  );
}

function MetricCard({
  label,
  value,
  note,
  tone = "blue",
}: {
  label: string;
  value: string;
  note: string;
  tone?: "blue" | "green" | "amber" | "red" | "violet";
}) {
  return (
    <article className={`${styles.metricCard} ${styles[tone]}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

export default function TenbaggerM0Page() {
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<RowStatus | "all">("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [sortBy, setSortBy] = useState("event-desc");

  useEffect(() => {
    let cancelled = false;
    fetchJson("/data/tenbagger-m0/index.json")
      .then((payload) => {
        if (cancelled) return;
        const normalized = normalizePayload(payload);
        if (!normalized.events.length) throw new Error("数据文件没有事件记录");
        setData(normalized);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const events = data?.events ?? EMPTY_EVENTS;
  const summary = useMemo(() => {
    const eligible = events.filter((row) => row.eligible);
    const up = eligible.filter((row) => row.prediction === "up").length;
    const neutral = eligible.filter((row) => row.prediction === "neutral").length;
    const down = eligible.filter((row) => row.prediction === "down").length;
    const matched = events.filter((row) => row.payloadMatched).length;
    const missing = events.filter((row) => row.status === "missing").length;
    const insufficient = events.filter((row) => row.status === "insufficient").length;
    return {
      total: events.length,
      matched,
      eligible: eligible.length,
      up,
      neutral,
      down,
      missing,
      insufficient,
      fullCapture: events.length ? up / events.length : undefined,
      eligibleCapture: eligible.length ? up / eligible.length : undefined,
    };
  }, [events]);

  const years = useMemo(
    () => [...new Set(events.map((row) => row.eventYear).filter((year): year is number => year !== undefined))]
      .sort((a, b) => b - a),
    [events],
  );

  const statusCounts = useMemo(() => {
    const counts = new Map<RowStatus, number>();
    for (const row of events) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    return counts;
  }, [events]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("en-US");
    return events
      .filter((row) => {
        const matchesQuery = !normalizedQuery
          || `${row.symbol} ${row.companyName}`.toLocaleLowerCase("en-US").includes(normalizedQuery);
        const matchesStatus = statusFilter === "all" || row.status === statusFilter;
        const matchesYear = yearFilter === "all" || row.eventYear === Number(yearFilter);
        return matchesQuery && matchesStatus && matchesYear;
      })
      .sort((left, right) => {
        if (sortBy === "ticker") return left.symbol.localeCompare(right.symbol);
        if (sortBy === "multiple-desc") {
          return (right.highMultiple ?? -Infinity) - (left.highMultiple ?? -Infinity)
            || left.symbol.localeCompare(right.symbol);
        }
        if (sortBy === "score-desc") {
          return (right.score ?? -Infinity) - (left.score ?? -Infinity)
            || left.symbol.localeCompare(right.symbol);
        }
        if (sortBy === "days-asc") {
          return (left.daysToTenX ?? Infinity) - (right.daysToTenX ?? Infinity)
            || left.symbol.localeCompare(right.symbol);
        }
        if (sortBy === "status") {
          const order: Record<RowStatus, number> = { up: 0, neutral: 1, down: 2, insufficient: 3, missing: 4 };
          return order[left.status] - order[right.status] || left.symbol.localeCompare(right.symbol);
        }
        return (right.eventYear ?? -Infinity) - (left.eventYear ?? -Infinity)
          || right.windowStart.localeCompare(left.windowStart)
          || left.symbol.localeCompare(right.symbol);
      });
  }, [events, query, sortBy, statusFilter, yearFilter]);

  if (loading) {
    return (
      <main className={styles.page}>
        <div className={styles.loading} role="status" aria-live="polite">
          <i aria-hidden="true" />
          <strong>正在装载191只十倍股预测</strong>
          <span>连接冻结事件池与严格滚动 M0 年运结果…</span>
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className={styles.page}>
        <section className={styles.missing} role="alert">
          <span>TENBAGGER M0 DATA</span>
          <h1>十倍股结果暂时无法读取</h1>
          <p>
            数据路径为 <code>/data/tenbagger-m0/index.json</code>。错误：{error || "未知错误"}
          </p>
          <div>
            <button type="button" onClick={() => window.location.reload()}>重新载入</button>
            <a href="../">返回年运总览</a>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <a href="../" aria-label="返回年运历史回测首页">
          <span aria-hidden="true">运</span>
          <div>
            <strong>年运回测</strong>
            <small>返回 V0 原计算</small>
          </div>
        </a>
        <nav aria-label="本页导航">
          <a href="#summary">结果总览</a>
          <a href="#events">191 只明细</a>
          <a href="#method">口径说明</a>
          <a href="../tenbagger-main-god/">主神重跑版</a>
        </nav>
        <div className={styles.dataStatus} aria-label={`已载入 ${summary.total} 条事件`}>
          <i aria-hidden="true" />
          <span>{integer(summary.total)} EVENTS</span>
        </div>
      </header>

      <div className={styles.shell}>
        <section className={styles.hero} id="summary">
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>STRICT WALK-FORWARD · M0</span>
            <h1>191 只一年十倍股，<br /><em>逐只核对当年预测。</em></h1>
            <p>
              每一行保留事件发生时的历史资格、滚动选定主用神、当年分数与预测结果。
              缺少股票年运数据和历史样本不足单独列示，不会伪装成“中性”。
            </p>
            <div className={styles.heroTags} aria-label="回测关键规则">
              <span>只用事件年前历史</span>
              <span>立春年运归属</span>
              <span>分数阈值 ±1</span>
              <span>不可计算不计中性</span>
            </div>
          </div>
          <div className={styles.heroPanel} aria-label="核心结果">
            <div><span>全池抓中</span><strong>{integer(summary.up)} / {integer(summary.total)}</strong><small>{percent(summary.fullCapture)} · 全部事件</small></div>
            <div><span>可预测样本抓中</span><strong>{integer(summary.up)} / {integer(summary.eligible)}</strong><small>{percent(summary.eligibleCapture)} · 仅历史合格</small></div>
            <div><span>可预测构成</span><strong><b className={styles.upText}>{summary.up} 涨</b> · <b className={styles.neutralText}>{summary.neutral} 中</b> · <b className={styles.downText}>{summary.down} 跌</b></strong></div>
            <div><span>数据覆盖</span><strong>{integer(summary.matched)} / {integer(summary.total)}</strong><small>能连接股票年运载荷</small></div>
          </div>
        </section>

        <aside className={styles.auditBanner} aria-label="重要口径警告">
          <strong>不要把这张表读成 191 次实时选股</strong>
          <p>
            这 191 只是事后按未来 365 日“复权日内高点 ÷ 事件日起点低点 ≥ 10 倍”筛出的正样本；
            “抓中”仅表示严格可预测时模型给出看涨，不代表模型能从完整市场提前找出十倍股。
          </p>
          <span>EX-POST POSITIVE POOL</span>
        </aside>

        <section className={styles.metricGrid} aria-label="十倍股年运预测汇总">
          <MetricCard label="事件池" value={integer(summary.total)} note="冻结的十倍股正样本" />
          <MetricCard label="严格可预测" value={integer(summary.eligible)} note={`${percent(summary.eligible / Math.max(1, summary.total))} 全池覆盖`} tone="violet" />
          <MetricCard label="预测看涨" value={integer(summary.up)} note="定义为模型抓中" tone="green" />
          <MetricCard label="预测中性" value={integer(summary.neutral)} note="可计算，但没有明确方向" tone="amber" />
          <MetricCard label="预测看跌" value={integer(summary.down)} note="对十倍正样本方向相反" tone="red" />
          <MetricCard label="不可计算" value={integer(summary.missing + summary.insufficient)} note={`${summary.missing} 缺数据 · ${summary.insufficient} 历史不足`} tone="blue" />
        </section>

        <section className={styles.panel} id="events">
          <div className={styles.panelHead}>
            <div>
              <span className={styles.eyebrow}>EVENT-LEVEL LEDGER</span>
              <h2>全部 191 只当年结果</h2>
            </div>
            <small>筛选只改变显示，不改变汇总分母；表格默认不分页。</small>
          </div>

          <div className={styles.toolbar} role="search" aria-label="筛选十倍股结果">
            <label className={styles.searchBox}>
              <span aria-hidden="true">⌕</span>
              <span className={styles.srOnly}>搜索股票代码或公司</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索代码或公司…"
                aria-label="搜索股票代码或公司"
              />
              {query && (
                <button type="button" onClick={() => setQuery("")} aria-label="清除搜索">×</button>
              )}
            </label>
            <label>
              <span className={styles.srOnly}>预测与数据状态</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as RowStatus | "all")}
                aria-label="按预测与数据状态筛选"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                    {option.value === "all" ? ` (${events.length})` : ` (${statusCounts.get(option.value) ?? 0})`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={styles.srOnly}>事件起始年份</span>
              <select
                value={yearFilter}
                onChange={(event) => setYearFilter(event.target.value)}
                aria-label="按事件起始年份筛选"
              >
                <option value="all">全部事件年份</option>
                {years.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </label>
            <label>
              <span className={styles.srOnly}>结果排序</span>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="结果排序">
                <option value="event-desc">事件时间 · 新到旧</option>
                <option value="ticker">股票代码 · A到Z</option>
                <option value="multiple-desc">实际倍数 · 高到低</option>
                <option value="score-desc">模型分数 · 高到低</option>
                <option value="days-asc">达到十倍 · 快到慢</option>
                <option value="status">预测状态 · 涨中跌</option>
              </select>
            </label>
          </div>

          <div className={styles.resultMeta} aria-live="polite">
            <span>显示 <strong>{filtered.length}</strong> / {events.length} 只</span>
            <small>绿色“抓中”只表示模型当年明确看涨，不表示预知十倍幅度。</small>
          </div>

          <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="191只十倍股当年预测完整表格">
            <table className={styles.table}>
              <caption className={styles.srOnly}>一年十倍股事件与严格滚动 M0 年运预测逐股对照</caption>
              <thead>
                <tr>
                  <th scope="col">股票</th>
                  <th scope="col">行业 / 五行</th>
                  <th scope="col">事件窗口</th>
                  <th scope="col">首次达到十倍</th>
                  <th scope="col">实际最高倍数</th>
                  <th scope="col">归属年运</th>
                  <th scope="col">命理年实际收益</th>
                  <th scope="col">历史资格</th>
                  <th scope="col">滚动主用神</th>
                  <th scope="col">当年分数</th>
                  <th scope="col">当年预测</th>
                  <th scope="col">是否抓中</th>
                  <th scope="col">同股分数排名</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <th scope="row">
                      <span className={styles.stockCell}>
                        <strong>{row.symbol}</strong>
                        <small>{row.companyName}</small>
                      </span>
                    </th>
                    <td>
                      <span className={styles.industryCell}>
                        <strong>{row.marketCategory}</strong>
                        <small>行业五行 <b>{row.industryElement}</b></small>
                      </span>
                    </td>
                    <td>
                      <span className={styles.stack}>
                        <strong>{dateRange(row.windowStart, row.windowEnd)}</strong>
                        <small>事件年 {row.eventYear ?? "—"} · 未来365日</small>
                      </span>
                    </td>
                    <td>
                      <span className={styles.stack}>
                        <strong>{row.firstTenXDate ? <time dateTime={row.firstTenXDate}>{row.firstTenXDate}</time> : "—"}</strong>
                        <small>{row.daysToTenX === undefined ? "天数未知" : `${integer(row.daysToTenX)} 天`}</small>
                      </span>
                    </td>
                    <td>
                      <strong className={styles.actualMultiple}>
                        {row.highMultiple === undefined ? "—" : `${decimal(row.highMultiple, 2)}×`}
                      </strong>
                    </td>
                    <td>
                      <span className={styles.stack}>
                        <strong>{row.cycleYear ?? "—"}</strong>
                        <small>{row.cycleAttributed ? dateRange(row.cycleStart, row.cycleEnd) : "无法归属"}</small>
                        {row.cycleAttributed && !row.cycleComplete && <em className={styles.incomplete}>K线不完整</em>}
                      </span>
                    </td>
                    <td>
                      <span className={styles.stack}>
                        <strong className={
                          row.annualActualComplete
                            ? row.annualActualDirection === "up"
                              ? styles.upText
                              : row.annualActualDirection === "down"
                                ? styles.downText
                                : styles.neutralText
                            : styles.muted
                        }>
                          {row.annualActualComplete ? signedPercentValue(row.annualActualReturnPct) : "—"}
                        </strong>
                        <small>{row.annualActualComplete ? "立春周期收盘收益" : "年运K线不完整"}</small>
                      </span>
                    </td>
                    <td>
                      <span className={styles.stack}>
                        <span className={`${styles.statusChip} ${styles[row.status]}`}>{statusLabel(row.status)}</span>
                        <small>{historyLabel(row)}</small>
                        {row.payloadMatched && (
                          <small>
                            历史 {integer(row.priorCompleteYears)} 年 · 涨 {integer(row.priorUpYears)} · 跌 {integer(row.priorDownYears)}
                          </small>
                        )}
                      </span>
                    </td>
                    <td><strong className={row.eligible ? styles.godChip : styles.muted}>{
                      row.eligible ? row.selectedMainGod : "—"
                    }</strong></td>
                    <td><strong className={row.eligible ? styles.score : styles.muted}>{
                      row.eligible ? scoreText(row.score) : "—"
                    }</strong></td>
                    <td>
                      {row.eligible
                        ? <span className={`${styles.predictionChip} ${styles[row.prediction]}`}>{predictionLabel(row.prediction)}</span>
                        : <span className={styles.unavailable}>不可计算</span>}
                    </td>
                    <td>
                      {row.eligible
                        ? row.captured
                          ? <span className={`${styles.captureChip} ${styles.hit}`}>抓中</span>
                          : <span className={`${styles.captureChip} ${styles.miss}`}>未抓中</span>
                        : <span className={styles.muted}>不计分</span>}
                    </td>
                    <td>
                      <span className={styles.stack}>
                        <strong>{row.rank === undefined ? "—" : `#${integer(row.rank)} / ${integer(row.yearsCompared)}`}</strong>
                        <small>{row.percentile === undefined ? "无可比排名" : `高于 ${percent(row.percentile, 1)} 的同股年份`}</small>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && (
              <div className={styles.emptyState} role="status">没有符合当前筛选条件的股票。</div>
            )}
          </div>
        </section>

        <section className={styles.methodPanel} id="method">
          <div>
            <span className={styles.eyebrow}>HOW TO READ</span>
            <h2>这张表回答什么、不回答什么</h2>
          </div>
          <ol>
            <li>
              <b>01</b>
              <div><strong>事件池是事后冻结的正样本</strong><p>每只股票按未来365日严格最高倍数筛选，因此不能用“191只里猜涨多少”直接评价实时选股能力。</p></div>
            </li>
            <li>
              <b>02</b>
              <div><strong>预测只使用当时以前的完整年运</strong><p>至少8个完整年，并且历史上涨、下跌各至少3年；不满足就明确标为历史不足。</p></div>
            </li>
            <li>
              <b>03</b>
              <div><strong>中性与不可计算完全分开</strong><p>中性是模型完成计算后分数落在 −1 到 +1；不可计算是没有载荷或历史门槛未满足。</p></div>
            </li>
            <li>
              <b>04</b>
              <div><strong>“抓中”只代表明确看涨</strong><p>它既不表示模型预测了十倍幅度，也不等于相对完整市场和匹配对照组具有筛选优势。</p></div>
            </li>
          </ol>
          <footer>
            <span>Schema: {data.schema || "—"}</span>
            <span>Generated: {data.generatedAt || "—"}</span>
            <span>Source SHA-256: {data.sourceHash ? `${data.sourceHash.slice(0, 12)}…` : "—"}</span>
            <strong>研究工具 · 非投资建议</strong>
          </footer>
        </section>
      </div>
    </main>
  );
}
