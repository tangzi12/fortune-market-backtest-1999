"use client";

import React, { useEffect, useMemo, useState } from "react";
import styles from "./v2-magnitude.module.css";

type JsonMap = Record<string, unknown>;

type V2Stock = {
  ticker: string;
  name?: string;
  sector?: string;
  index_membership?: string | string[];
  oos_years?: number;
  direction_accuracy?: number;
  balanced_accuracy?: number;
  neutral_rows?: number;
  neutral_accuracy?: number;
  pairwise_accuracy?: number;
  spearman?: number;
  top_decile_hits?: number;
  tenbagger_events?: number;
  data_path?: string;
} & JsonMap;

type V2Year = {
  anchor_year?: number;
  year?: number;
  anchor_date?: string;
  horizon_end?: string;
  split_id?: string;
  train_cutoff?: string;
  generated_without_future?: boolean;
  a0_score?: number;
  a0_direction?: string;
  a0_is_neutral?: boolean;
  v2_p_up?: number;
  v2_direction?: string;
  v2_confidence?: number;
  neutral_resolved?: boolean;
  predicted_mfe_q50?: number;
  predicted_mfe_q80?: number;
  predicted_mae_q50?: number;
  predicted_within_stock_percentile?: number;
  actual_close_return_12m?: number;
  actual_mfe_12m?: number;
  actual_mae_12m?: number;
  actual_max_ordered_runup_12m?: number;
  direction_hit?: boolean;
  eligible?: boolean;
  exclusion_reason?: string | null;
} & JsonMap;

function asObject(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function pick(source: unknown, keys: string[]) {
  const row = asObject(source);
  for (const key of keys) if (row[key] !== undefined && row[key] !== null) return row[key];
  return undefined;
}

function metric(source: unknown, keys: string[], fallback?: number) {
  return asNumber(pick(source, keys)) ?? fallback;
}

function rate(value: unknown, digits = 1) {
  const n = asNumber(value);
  if (n === undefined) return "—";
  return `${(Math.abs(n) <= 1 ? n * 100 : n).toFixed(digits)}%`;
}

function signedRate(value: unknown, digits = 1) {
  const n = asNumber(value);
  if (n === undefined) return "—";
  const normalized = Math.abs(n) <= 1 ? n * 100 : n;
  return `${normalized >= 0 ? "+" : ""}${normalized.toFixed(digits)}%`;
}

function decimal(value: unknown, digits = 2) {
  const n = asNumber(value);
  return n === undefined ? "—" : n.toFixed(digits);
}

function integer(value: unknown) {
  const n = asNumber(value);
  return n === undefined ? "—" : Math.round(n).toLocaleString();
}

function normalizeDirection(value: unknown) {
  const raw = String(value ?? "").toLowerCase();
  if (["up", "bull", "rise", "涨"].some((item) => raw.includes(item))) return "up";
  if (["down", "bear", "fall", "跌"].some((item) => raw.includes(item))) return "down";
  return "neutral";
}

function directionLabel(value: unknown) {
  const normalized = normalizeDirection(value);
  return normalized === "up" ? "偏涨" : normalized === "down" ? "偏跌" : "低置信";
}

function membership(value: unknown) {
  return Array.isArray(value) ? value.join(" · ") : String(value ?? "—");
}

function normalizedSummary(payload: unknown): JsonMap {
  const root = asObject(payload);
  const evaluation = asObject(root.evaluation);
  const overallRaw = asObject(root.overall);
  const direction = asObject(overallRaw.v2 ?? overallRaw.v2_forced_direction ?? evaluation.direction);
  const a0 = asObject(overallRaw.a0_frozen ?? overallRaw.a0_v0_direction ?? evaluation.v0_base_same_rows);
  const neutralRaw = asObject(root.neutral ?? overallRaw.a0_neutral_rows_resolved_by_v2 ?? evaluation.v0_neutral_resolution);
  const magnitudeRaw = asObject(root.magnitude ?? evaluation.magnitude);
  const mfe = asObject(magnitudeRaw.mfe);
  const ordering = asObject(magnitudeRaw.within_ticker_ordering);
  const topDecile = asObject(magnitudeRaw.top_decile);
  const folds = Array.isArray(root.by_year)
    ? root.by_year.map(asObject)
    : Array.isArray(evaluation.folds)
      ? evaluation.folds.map(asObject)
      : [];
  const modelRaw = asObject(root.model);
  const coverageRaw = asObject(root.coverage ?? root.scope);
  const validationRaw = asObject(root.validation);
  const alwaysRaw = asObject(overallRaw.always_up);
  return {
    ...root,
    schema_version: root.schema_version ?? root.model_version,
    model: {
      ...modelRaw,
      version: modelRaw.version ?? root.model_version,
      status: modelRaw.status ?? root.model_status,
      prediction_mode: "expanding_year_walk_forward",
      data_cutoff: pick(root.source, ["source_data_cutoff"]),
      scope_label: "V2 Alpha：全池压缩序列代理的时间滚动历史回放，尚非完整typed/node V2。",
      training_matrix: (modelRaw.full_v2_typed_state_available ?? root.full_v2_typed_state_available) ? "完整typed/node矩阵" : "experimental sequence proxy",
      data_hash: pick(root.source, ["source_index_sha256"]),
    },
    coverage: {
      ...coverageRaw,
      oos_rows: metric(coverageRaw, ["oos_rows", "strict_oos_rows"]),
      stocks: metric(coverageRaw, ["stocks", "strict_oos_stocks"]),
    },
    validation: {
      ...validationRaw,
      protocol: pick(root.training_protocol, ["split"]),
      fold_count: metric(coverageRaw, ["fold_count"]),
      folds: folds.map((fold) => ({
        ...fold,
        id: `year-${metric(fold, ["test_year"])}`,
        train_start: metric(fold, ["train_year_min"]),
        train_end: metric(fold, ["train_year_max"]),
        test_start: metric(fold, ["test_year"]),
        test_end: metric(fold, ["test_year"]),
      })),
    },
    overall: {
      ...overallRaw,
      v2: {
        ...direction,
        rows: metric(direction, ["samples"]),
        direction_coverage: 1,
      },
      a0_frozen: {
        ...a0,
        accuracy: metric(a0, ["explicit_accuracy"]),
        balanced_accuracy: metric(a0, ["explicit_balanced_accuracy"]),
        up_recall: metric(a0, ["explicit_up_recall"]),
        down_recall: metric(a0, ["explicit_down_recall"]),
        rows: metric(a0, ["explicit_samples"]),
        direction_coverage: metric(a0, ["direction_coverage"]),
        full_accuracy_neutral_counted_wrong: metric(a0, ["full_accuracy_neutral_counted_wrong"]),
      },
      always_up: {
        ...alwaysRaw,
        accuracy: metric(alwaysRaw, ["accuracy"], metric(direction, ["always_up_accuracy"])),
        balanced_accuracy: metric(alwaysRaw, ["balanced_accuracy"], 0.5),
        up_recall: metric(alwaysRaw, ["up_recall"], 1),
        down_recall: metric(alwaysRaw, ["down_recall"], 0),
        rows: metric(direction, ["samples"]),
        direction_coverage: 1,
      },
    },
    neutral: {
      ...neutralRaw,
      evaluable_rows: metric(neutralRaw, ["samples"]),
      always_up_accuracy: metric(neutralRaw, ["always_up_accuracy"]),
      forced_choice: {
        ...neutralRaw,
        lift_vs_always_up_pp: ((metric(neutralRaw, ["accuracy"], 0) ?? 0) - (metric(neutralRaw, ["always_up_accuracy"], 0) ?? 0)) * 100,
      },
      selective_curve: [],
    },
    magnitude: {
      ...magnitudeRaw,
      within_ticker_pairwise_accuracy: metric(ordering, ["pairwise_concordance"]),
      spearman_macro: metric(ordering, ["macro_mean_spearman"]),
      global_mfe_spearman: metric(mfe, ["predicted_vs_actual_spearman"]),
      top_decile_lift: metric(topDecile, ["mean_mfe_lift"]),
      top_decile_capture: metric(topDecile, ["actual_top_decile_capture_micro"]),
      top_quartile_capture: metric(magnitudeRaw, ["top_quartile_capture"]),
      mfe_mae: metric(mfe, ["log_mae"]),
    },
    by_year: folds.map((fold) => ({
      ...fold,
      year: metric(fold, ["year", "test_year"]),
      direction_accuracy: metric(fold, ["direction_accuracy"]),
      magnitude_spearman: metric(fold, ["mfe_spearman"]),
      rank_spearman: metric(fold, ["rank_spearman"]),
      rows: metric(fold, ["test_rows"]),
    })),
    warnings: Array.isArray(root.warnings) ? root.warnings : Array.isArray(root.limitations) ? root.limitations : [],
  };
}

function normalizeStockRow(value: unknown): V2Stock {
  const row = asObject(value);
  return {
    ...row,
    ticker: String(row.ticker ?? ""),
    name: String(row.name ?? ""),
    sector: String(row.sector ?? ""),
    index_membership: row.index_membership as string | string[] | undefined,
    oos_years: metric(row, ["oos_years"]),
    direction_accuracy: metric(row, ["direction_accuracy", "oos_direction_accuracy"]),
    balanced_accuracy: metric(row, ["balanced_accuracy", "oos_balanced_accuracy"]),
    neutral_rows: metric(row, ["neutral_rows", "oos_neutral_years"]),
    neutral_accuracy: metric(row, ["neutral_accuracy", "oos_neutral_accuracy"]),
    pairwise_accuracy: metric(row, ["pairwise_accuracy", "oos_pairwise_accuracy"]),
    spearman: metric(row, ["spearman", "oos_rank_spearman"]),
    top_decile_hits: metric(row, ["top_decile_hits"]),
    tenbagger_events: metric(row, ["tenbagger_events"]),
    data_path: String(row.data_path ?? row.payload ?? ""),
  };
}

function normalizeYearRow(value: unknown): V2Year {
  const row = asObject(value);
  if (row.anchor_year !== undefined || row.v2_direction !== undefined) return row as V2Year;
  const base = asObject(row.base_v0);
  const actual = asObject(row.actual);
  const v2 = asObject(row.v2_magnitude);
  const direction = String(v2.direction ?? "neutral");
  const probability = metric(v2, ["up_probability"]);
  return {
    ...row,
    anchor_year: metric(row, ["year"]),
    anchor_date: String(row.period_start ?? ""),
    horizon_end: String(row.period_end ?? ""),
    split_id: `year-${metric(v2, ["fold_year"], metric(row, ["year"]))}`,
    train_cutoff: `${metric(v2, ["trained_through_year"], 0)}-12-31`,
    generated_without_future: (metric(v2, ["trained_through_year"], 9999) ?? 9999) < (metric(row, ["year"], 0) ?? 0),
    a0_score: metric(base, ["score"]),
    a0_direction: String(base.prediction ?? "neutral"),
    a0_is_neutral: normalizeDirection(base.prediction) === "neutral",
    v2_p_up: probability,
    v2_direction: direction,
    v2_confidence: probability === undefined ? undefined : Math.abs(probability - 0.5) * 2,
    neutral_resolved: normalizeDirection(base.prediction) === "neutral",
    predicted_mfe_q50: metric(v2, ["predicted_mfe_pct"]),
    predicted_mae_q50: metric(v2, ["predicted_mae_pct"]),
    predicted_within_stock_percentile: metric(v2, ["within_ticker_potential_percentile"]),
    actual_close_return_12m: metric(actual, ["terminal_return_pct"]),
    actual_mfe_12m: metric(actual, ["mfe_pct"]),
    actual_mae_12m: metric(actual, ["mae_pct"]),
    direction_hit: Boolean(v2.direction_hit),
    eligible: !row.not_scored_reason,
    exclusion_reason: row.not_scored_reason ? String(row.not_scored_reason) : null,
  };
}

async function fetchJson(path: string) {
  const relativePath = path.replace(/^\/+/, "");
  const resolvedPath = typeof document === "undefined"
    ? `/${relativePath}`
    : new URL(relativePath, document.baseURI).toString();
  const response = await fetch(resolvedPath, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${path}`);
  if (!relativePath.endsWith(".gz")) return response.json();
  const bytes = await response.arrayBuffer();
  const signature = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  if (signature[0] !== 0x1f || signature[1] !== 0x8b) {
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  if (typeof DecompressionStream === "undefined") throw new Error("浏览器不支持gzip分片解压");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}

function MetricCard({ label, value, note, tone = "blue" }: { label: string; value: string; note: string; tone?: "blue" | "green" | "amber" | "violet" }) {
  return (
    <article className={`${styles.metricCard} ${styles[tone]}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function AccuracyBar({ value, tone = "blue" }: { value: unknown; tone?: "blue" | "green" | "red" | "amber" | "violet" }) {
  const n = asNumber(value);
  const width = n === undefined ? 0 : Math.max(0, Math.min(100, Math.abs(n) <= 1 ? n * 100 : n));
  return <i className={styles.accuracyTrack}><em className={styles[tone]} style={{ width: `${width}%` }} /></i>;
}

function BenchmarkTable({ summary }: { summary: JsonMap }) {
  const overall = asObject(summary.overall);
  const v2 = asObject(overall.v2 ?? overall.v2_alpha ?? summary.v2);
  const a0 = asObject(overall.a0_frozen ?? overall.a0 ?? summary.a0);
  const always = asObject(overall.always_up ?? summary.always_up);
  const rows = [
    { name: "A0 冻结主用神", tag: "基准", payload: a0, tone: "amber" as const },
    { name: "A0 + V2 残差", tag: "滚动时间外", payload: v2, tone: "blue" as const },
    { name: "永久看涨", tag: "简单基准", payload: always, tone: "green" as const },
  ];
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr><th>模型</th><th>方向准确率</th><th>平衡准确率</th><th>方向覆盖率</th><th>上涨召回</th><th>下跌召回</th><th>样本</th></tr></thead>
        <tbody>{rows.map(({ name, tag, payload, tone }) => (
          <tr key={name}>
            <td><div className={styles.modelName}><strong>{name}</strong><span>{tag}</span></div></td>
            <td><div className={styles.barCell}><b>{rate(metric(payload, ["accuracy", "direction_accuracy", "hit_rate"]))}</b><AccuracyBar value={metric(payload, ["accuracy", "direction_accuracy", "hit_rate"])} tone={tone} /></div></td>
            <td>{rate(metric(payload, ["balanced_accuracy", "ba"]))}</td>
            <td>{rate(metric(payload, ["direction_coverage", "coverage"], 1))}</td>
            <td>{rate(metric(payload, ["up_recall", "bullish_recall"]))}</td>
            <td>{rate(metric(payload, ["down_recall", "bearish_recall"]))}</td>
            <td>{integer(metric(payload, ["rows", "samples", "oos_rows"]))}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function NeutralCurve({ summary }: { summary: JsonMap }) {
  const neutral = asObject(summary.neutral);
  const curve = Array.isArray(neutral.selective_curve) ? neutral.selective_curve.map(asObject) : [];
  if (!curve.length) return <div className={styles.emptyInline}>当前输出没有选择性覆盖曲线。</div>;
  return (
    <div className={styles.curve}>
      {curve.map((row, index) => {
        const coverage = metric(row, ["coverage"], 0) ?? 0;
        const accuracy = metric(row, ["accuracy"], 0) ?? 0;
        const balanced = metric(row, ["balanced_accuracy", "ba"], 0) ?? 0;
        return (
          <div className={styles.curveRow} key={`${coverage}-${index}`}>
            <span>覆盖 {rate(coverage, 0)}</span>
            <div><i style={{ width: rate(accuracy) }} /><b style={{ left: rate(balanced) }} /></div>
            <strong>{rate(accuracy)}</strong>
            <small>BA {rate(balanced)}</small>
          </div>
        );
      })}
      <div className={styles.curveLegend}><span><i />原始准确率</span><span><b />平衡准确率</span></div>
    </div>
  );
}

function YearBars({ rows }: { rows: JsonMap[] }) {
  if (!rows.length) return <div className={styles.emptyInline}>暂无逐年时间外结果。</div>;
  return (
    <div className={styles.yearBars}>
      {rows.map((row, index) => {
        const year = metric(row, ["year", "anchor_year"], index);
        const score = metric(row, ["magnitude_spearman", "spearman", "rank_correlation"], 0) ?? 0;
        const accuracy = metric(row, ["direction_accuracy", "accuracy"], 0) ?? 0;
        const scaled = Math.max(4, Math.min(100, 50 + score * 100));
        return (
          <div key={`${year}-${index}`} title={`${year}: 幅度秩相关 ${decimal(score, 3)}；方向 ${rate(accuracy)}`}>
            <span>{rate(accuracy, 0)}</span>
            <i style={{ height: `${scaled}%` }} className={score >= 0 ? styles.positive : styles.negative} />
            <small>{year}</small>
          </div>
        );
      })}
    </div>
  );
}

function StockTable({ stocks, onOpen }: { stocks: V2Stock[]; onOpen: (stock: V2Stock) => void }) {
  return (
    <div className={styles.tableWrap}>
      <table className={`${styles.table} ${styles.stockTable}`}>
        <thead><tr><th>股票</th><th>指数 / 板块</th><th>时间外年份</th><th>方向准确率</th><th>中性选择</th><th>同股排序</th><th>秩相关</th><th /></tr></thead>
        <tbody>{stocks.map((stock) => (
          <tr key={stock.ticker} onClick={() => onOpen(stock)}>
            <td><div className={styles.stockName}><strong>{stock.ticker}</strong><span>{stock.name || "—"}</span></div></td>
            <td><div className={styles.stack}><span>{membership(stock.index_membership)}</span><small>{stock.sector || "未分类"}</small></div></td>
            <td>{integer(stock.oos_years ?? stock.samples)}</td>
            <td><div className={styles.barCell}><b>{rate(stock.direction_accuracy)}</b><AccuracyBar value={stock.direction_accuracy} /></div></td>
            <td>{rate(stock.neutral_accuracy)}</td>
            <td>{rate(stock.pairwise_accuracy)}</td>
            <td>{decimal(stock.spearman, 3)}</td>
            <td><button onClick={(event) => { event.stopPropagation(); onOpen(stock); }} aria-label={`查看${stock.ticker}时间外明细`}>→</button></td>
          </tr>
        ))}</tbody>
      </table>
      {!stocks.length && <div className={styles.emptyInline}>没有符合条件的股票。</div>}
    </div>
  );
}

function StockDetail({ stock, rows, loading, error, onClose }: { stock: V2Stock; rows: V2Year[]; loading: boolean; error: string; onClose: () => void }) {
  const eligible = rows.filter((row) => row.eligible !== false);
  return (
    <section className={styles.detailSection} id="v2-stock-detail">
      <div className={styles.detailHead}>
        <button onClick={onClose}>← 关闭明细</button>
        <div><strong>{stock.ticker}</strong><span>{stock.name}</span></div>
        <small>只显示保存了训练截点的滚动时间外年份</small>
      </div>
      {loading ? <div className={styles.loadingSmall}>正在读取 {stock.ticker}…</div> : error ? <div className={styles.errorBox}>{error}</div> : (
        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.yearTable}`}>
            <thead><tr><th>流年</th><th>训练截止</th><th>A0</th><th>V2方向 / 概率</th><th>预测幅度分位</th><th>实际MFE</th><th>实际终值</th><th>实际MAE</th><th>结果</th></tr></thead>
            <tbody>{eligible.map((row, index) => {
              const predicted = normalizeDirection(row.v2_direction);
              return (
                <tr key={`${row.anchor_year ?? row.year}-${index}`}>
                  <td><div className={styles.stack}><strong>{row.anchor_year ?? row.year ?? "—"}</strong><small>{String(row.anchor_date ?? "").slice(0, 10)} → {String(row.horizon_end ?? "").slice(0, 10)}</small></div></td>
                  <td><div className={styles.stack}><span>{String(row.train_cutoff ?? "—").slice(0, 10)}</span><small>{row.generated_without_future === false ? "边界异常" : "仅使用此前样本"}</small></div></td>
                  <td><span className={`${styles.directionChip} ${styles[normalizeDirection(row.a0_direction)]}`}>{directionLabel(row.a0_direction)}</span></td>
                  <td><div className={styles.stack}><span className={`${styles.directionText} ${styles[predicted]}`}>{directionLabel(row.v2_direction)} · {rate(row.v2_p_up)}</span><small>置信 {rate(row.v2_confidence)}</small></div></td>
                  <td><div className={styles.barCell}><b>{rate(row.predicted_within_stock_percentile)}</b><AccuracyBar value={row.predicted_within_stock_percentile} tone="violet" /></div></td>
                  <td className={styles.upText}>{signedRate(row.actual_mfe_12m)}</td>
                  <td className={(asNumber(row.actual_close_return_12m) ?? 0) >= 0 ? styles.upText : styles.downText}>{signedRate(row.actual_close_return_12m)}</td>
                  <td className={styles.downText}>{signedRate(row.actual_mae_12m)}</td>
                  <td><span className={`${styles.hitBadge} ${row.direction_hit ? styles.hit : styles.miss}`}>{row.direction_hit ? "命中" : "未中"}</span></td>
                </tr>
              );
            })}</tbody>
          </table>
          {!eligible.length && <div className={styles.emptyInline}>该股票没有达到时间外训练门槛的年份。</div>}
        </div>
      )}
    </section>
  );
}

export default function V2MagnitudePage() {
  const [summary, setSummary] = useState<JsonMap>({});
  const [stocks, setStocks] = useState<V2Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("pairwise");
  const [selected, setSelected] = useState<V2Stock | null>(null);
  const [detailRows, setDetailRows] = useState<V2Year[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  useEffect(() => {
    document.title = "V2 幅度回测 · 同股跨年排序与12个月MFE";
    let cancelled = false;
    const indexRequest = fetchJson("/data/v2-magnitude/index.json.gz")
      .catch(() => fetchJson("/data/v2-magnitude/index.json"));
    Promise.all([
      fetchJson("/data/v2-magnitude/summary.json"),
      indexRequest,
    ]).then(([summaryPayload, indexPayload]) => {
      if (cancelled) return;
      const summaryRoot = normalizedSummary(summaryPayload);
      const indexRoot = asObject(indexPayload);
      const stockRows = (Array.isArray(indexRoot.stocks) ? indexRoot.stocks : Array.isArray(indexPayload) ? indexPayload : [])
        .map(normalizeStockRow)
        .filter((row) => row.ticker);
      if (!Object.keys(summaryRoot).length || !stockRows.length) throw new Error("回测输出为空");
      setSummary(summaryRoot);
      setStocks(stockRows);
    }).catch((reason) => {
      if (!cancelled) setError(`V2回测数据尚未完成或无法读取：${reason instanceof Error ? reason.message : String(reason)}`);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const model = asObject(summary.model);
  const coverage = asObject(summary.coverage);
  const validation = asObject(summary.validation);
  const overall = asObject(summary.overall);
  const v2 = asObject(overall.v2 ?? overall.v2_alpha ?? summary.v2);
  const a0 = asObject(overall.a0_frozen ?? overall.a0 ?? summary.a0);
  const neutral = asObject(summary.neutral);
  const magnitude = asObject(summary.magnitude);
  const tenbagger = asObject(summary.tenbagger_challenge);
  const thresholdRetrieval = asObject(asObject(magnitude.top_decile).threshold_retrieval);
  const yearly = Array.isArray(summary.by_year) ? summary.by_year.map(asObject) : [];
  const warnings = Array.isArray(summary.warnings) ? summary.warnings.map(String) : [];
  const folds = Array.isArray(validation.folds) ? validation.folds.map(asObject) : [];

  const filteredStocks = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = stocks.filter((stock) => !q || `${stock.ticker} ${stock.name ?? ""} ${stock.sector ?? ""} ${membership(stock.index_membership)}`.toLowerCase().includes(q));
    return rows.sort((left, right) => {
      if (sortBy === "ticker") return left.ticker.localeCompare(right.ticker);
      if (sortBy === "direction") return (asNumber(right.direction_accuracy) ?? -1) - (asNumber(left.direction_accuracy) ?? -1);
      if (sortBy === "neutral") return (asNumber(right.neutral_accuracy) ?? -1) - (asNumber(left.neutral_accuracy) ?? -1);
      if (sortBy === "spearman") return (asNumber(right.spearman) ?? -9) - (asNumber(left.spearman) ?? -9);
      return (asNumber(right.pairwise_accuracy) ?? -1) - (asNumber(left.pairwise_accuracy) ?? -1);
    });
  }, [stocks, query, sortBy]);

  async function openStock(stock: V2Stock) {
    setSelected(stock);
    setDetailRows([]);
    setDetailError("");
    setDetailLoading(true);
    try {
      const path = stock.data_path || `stocks/${encodeURIComponent(stock.ticker)}.json.gz`;
      const payload = asObject(await fetchJson(`/data/v2-magnitude/${path}`));
      const rows = (Array.isArray(payload.years)
        ? payload.years
        : Array.isArray(payload.predictions)
          ? payload.predictions
          : Array.isArray(payload.periods)
            ? payload.periods
            : []).map(normalizeYearRow);
      setDetailRows(rows);
    } catch (reason) {
      setDetailError(`${stock.ticker} 明细读取失败：${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setDetailLoading(false);
      requestAnimationFrame(() => document.getElementById("v2-stock-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }

  if (loading) return (
    <main className={styles.page}><div className={styles.loading}><i /><strong>正在装载 V2 时间外回测</strong><span>读取滚动折、幅度排序与中性年份结果…</span></div></main>
  );

  if (error) return (
    <main className={styles.page}>
      <header className={styles.topbar}><a href="../"><span>运</span><strong>返回 V0 年运回测</strong></a><b>V2 MAGNITUDE</b></header>
      <section className={styles.missing}>
        <span>V2 DATA STATUS</span><h1>独立入口已经建立，回测输出尚未就绪</h1><p>{error}</p><a href="../">返回原 V0 页面</a>
      </section>
    </main>
  );

  const status = String(model.status ?? "completed");
  const alpha = String(model.version ?? summary.schema_version ?? "V2 Alpha");
  const neutralForced = asObject(neutral.forced_choice ?? neutral.v2);
  const neutralBaseline = metric(neutral, ["always_up_accuracy", "up_prior"]);
  const scheduleValidation = asObject(validation.schedule_validated_518);
  const scheduleMetrics = asObject(scheduleValidation.metrics);
  const scheduleDirection = asObject(scheduleMetrics.v2_direction);
  const scheduleNeutral = asObject(scheduleMetrics.neutral_resolution);
  const scheduleOrdering = asObject(scheduleMetrics.within_ticker_ordering);
  const scheduleTopDecile = asObject(scheduleMetrics.top_decile);
  const scheduleThresholds = asObject(scheduleTopDecile.threshold_retrieval);
  const scheduleFiveX = asObject(scheduleThresholds["5x"]);
  const missingSchedule = Array.isArray(scheduleValidation.missing_complete_history_tickers)
    ? scheduleValidation.missing_complete_history_tickers.join("、")
    : "";

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <a href="../" aria-label="返回V0年运回测"><span>运</span><div><strong>年运回测</strong><small>返回 V0 原计算</small></div></a>
        <nav><a href="#overview">总览</a><a href="#neutral">中性选择</a><a href="#magnitude">幅度排序</a><a href="#stocks">逐股结果</a><a href="#method">方法</a><a href="../tenbagger-m0/">十倍股191</a></nav>
        <div className={styles.status}><i className={status === "completed" ? styles.live : styles.pending} />{alpha}</div>
      </header>

      <div className={styles.shell}>
        <section className={styles.hero} id="overview">
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>WALK-FORWARD · MAGNITUDE RESEARCH</span>
            <h1>不再只问涨跌，<br /><em>直接检验上涨量级。</em></h1>
            <p>这是独立于 V0 的实验入口。主用神 A0 保持冻结，V2 只学习未解释的残差；同时检验中性年份强制选择、同股跨年幅度排序和立春锚定12个月 MFE。</p>
            <div className={styles.heroTags}><span>训练截止早于预测锚点</span><span>同口径基线</span><span>无演示数据回退</span></div>
          </div>
          <div className={styles.heroPanel}>
            <div><span>模型状态</span><strong>{status === "completed" ? "回测完成" : status}</strong></div>
            <div><span>预测模式</span><strong>{String(model.prediction_mode ?? "expanding walk-forward")}</strong></div>
            <div><span>OOS 年份 / 折</span><strong>{integer(metric(coverage, ["oos_rows"]))} / {folds.length || integer(metric(validation, ["fold_count"]))}</strong></div>
            <div><span>数据截止</span><strong>{String(model.data_cutoff ?? "—")}</strong></div>
          </div>
        </section>

        <div className={styles.auditBanner}>
          <strong>研究状态</strong>
          <span>{String(model.scope_label ?? "V2 Alpha：当前成分股历史回放，结果受幸存者偏差与上市起点代理影响。")}</span>
          <b>{String(model.training_matrix ?? "压缩序列基线")}</b>
        </div>

        <section className={styles.metricGrid} aria-label="V2关键指标">
          <MetricCard label="方向平衡准确率" value={rate(metric(v2, ["balanced_accuracy", "ba"]))} note={`A0 ${rate(metric(a0, ["balanced_accuracy", "ba"]))}`} />
          <MetricCard label="中性年份选择" value={rate(metric(neutralForced, ["accuracy", "direction_accuracy"]))} note={`永久看涨 ${rate(neutralBaseline)}`} tone="amber" />
          <MetricCard label="同股跨年排序" value={rate(metric(magnitude, ["within_ticker_pairwise_accuracy", "pairwise_accuracy"]))} note="成对比较正确率" tone="violet" />
          <MetricCard label="全池 MFE 秩相关" value={decimal(metric(magnitude, ["global_mfe_spearman", "spearman_macro", "spearman"]), 3)} note="预测分数 vs 实际MFE" tone="green" />
          <MetricCard label="Top 10% 提升" value={`${decimal(metric(magnitude, ["top_decile_lift"]), 2)}×`} note="相对随机捕获" tone="blue" />
        </section>

        <section className={styles.twoColumn}>
          <article className={styles.panel}>
            <div className={styles.panelHead}><div><span className={styles.eyebrow}>SAME-POOL BASELINES</span><h2>同一时间外总池的基线</h2></div><small>A0 保留原“中性”，V2 必须全覆盖择向</small></div>
            <BenchmarkTable summary={summary} />
            <p className={styles.note}>A0 的方向准确率只统计其明确看涨/看跌年份，样本列与方向覆盖率同时披露；V2 与“永久看涨”则在全部时间外年份上评价，不能把两种口径混成一个百分比。</p>
          </article>
          <article className={styles.panel}>
            <div className={styles.panelHead}><div><span className={styles.eyebrow}>YEAR-BY-YEAR</span><h2>滚动年度稳定性</h2></div><small>柱高为幅度秩相关；上方数字为方向准确率</small></div>
            <YearBars rows={yearly} />
          </article>
        </section>

        {!!Object.keys(scheduleMetrics).length && (
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div><span className={styles.eyebrow}>S&P 500 + NASDAQ-100 CHECK</span><h2>原 518 股核验池</h2></div>
              <small>与 2,519 股实验总池分开报告</small>
            </div>
            <div className={styles.tenbaggerGrid}>
              <div><span>有完整历史</span><strong>{integer(metric(scheduleValidation, ["complete_history_available_stocks"]))} / {integer(metric(scheduleValidation, ["declared_stocks"]))}</strong><small>{integer(metric(scheduleMetrics, ["samples"]))} 个时间外年</small></div>
              <div><span>V2 全覆盖方向</span><strong>{rate(metric(scheduleDirection, ["accuracy"]))}</strong><small>BA {rate(metric(scheduleDirection, ["balanced_accuracy"]))} · 永久看涨 {rate(metric(scheduleMetrics, ["always_up_accuracy"]))}</small></div>
              <div><span>中性年份强制选择</span><strong>{rate(metric(scheduleNeutral, ["accuracy"]))}</strong><small>永久看涨 {rate(metric(scheduleNeutral, ["always_up_accuracy"]))}</small></div>
              <div><span>同股排序 / 5倍检索</span><strong>{rate(metric(scheduleOrdering, ["pairwise_concordance"]))}</strong><small>5倍 Top 10% 提升 {decimal(metric(scheduleFiveX, ["top_decile_lift"]), 2)}× · 仅 {integer(metric(scheduleFiveX, ["events"]))} 例</small></div>
            </div>
            <p className={styles.note}>这一子池的普通方向准确率为 {rate(metric(scheduleDirection, ["accuracy"]))}，但低于同样本永久看涨的 {rate(metric(scheduleMetrics, ["always_up_accuracy"]))}，平衡准确率也只有 {rate(metric(scheduleDirection, ["balanced_accuracy"]))}，因此不能解释成模型改进。{missingSchedule ? ` 缺少完整历史：${missingSchedule}。` : ""}</p>
          </section>
        )}

        <section className={styles.panel} id="neutral">
          <div className={styles.panelHead}><div><span className={styles.eyebrow}>NEUTRAL RESOLUTION</span><h2>旧模型“中性”能否做出选择</h2></div><span className={styles.methodChip}>所有中性年都计入评价</span></div>
          <div className={styles.neutralGrid}>
            <div className={styles.neutralSummary}>
              <div><span>中性时间外样本</span><strong>{integer(metric(neutral, ["evaluable_rows", "rows"]))}</strong></div>
              <div><span>V2强制二选一</span><strong>{rate(metric(neutralForced, ["accuracy", "direction_accuracy"]))}</strong><small>BA {rate(metric(neutralForced, ["balanced_accuracy", "ba"]))}</small></div>
              <div><span>全部判涨基线</span><strong>{rate(neutralBaseline)}</strong><small>同一批样本</small></div>
              <div><span>增量</span><strong className={(metric(neutralForced, ["lift_vs_always_up_pp"], 0) ?? 0) >= 0 ? styles.upText : styles.downText}>{signedRate(metric(neutralForced, ["lift_vs_always_up_pp"]))}</strong><small>百分点</small></div>
            </div>
            <NeutralCurve summary={summary} />
          </div>
        </section>

        <section className={styles.panel} id="magnitude">
          <div className={styles.panelHead}><div><span className={styles.eyebrow}>MAGNITUDE HEAD</span><h2>同股跨年幅度排序＋12个月MFE</h2></div><span className={styles.methodChip}>方向与幅度分开验收</span></div>
          <div className={styles.magnitudeGrid}>
            <div className={styles.rankScore}>
              <span>同股成对排序</span>
              <strong>{rate(metric(magnitude, ["within_ticker_pairwise_accuracy", "pairwise_accuracy"]))}</strong>
              <AccuracyBar value={metric(magnitude, ["within_ticker_pairwise_accuracy", "pairwise_accuracy"])} tone="violet" />
              <small>随机基准 50%；只比较同一股票的不同时间外年份。</small>
            </div>
            <div className={styles.rankScore}>
              <span>Top 10% 捕获</span>
              <strong>{rate(metric(magnitude, ["top_decile_capture"]))}</strong>
              <AccuracyBar value={metric(magnitude, ["top_decile_capture"])} tone="green" />
              <small>实际最高MFE年份进入预测前10%区间的比例。</small>
            </div>
            <div className={styles.rankScore}>
              <span>MFE对数误差</span>
              <strong>{decimal(metric(magnitude, ["mfe_mae", "log_mfe_mae"]), 3)}</strong>
              <small>用于幅度校准；不能和涨跌命中率混写。</small>
            </div>
            <div className={styles.targetBox}>
              <span>目标定义</span>
              <code>MFE₁₂ = max(复权High / 锚点Open − 1)</code>
              <code>同股排序 = score(i,y₁) &gt; score(i,y₂)</code>
              <p>{String(pick(summary.targets, ["mfe_from_anchor_12m"]) ?? "以立春后的首个完整交易日为锚，观察至下一立春。")}</p>
            </div>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHead}><div><span className={styles.eyebrow}>HIGH-MULTIPLE RETRIEVAL</span><h2>2倍、5倍、10倍年份阈值检验</h2></div><small>这里是全池自然发生的MFE阈值，不是事后低点锚定的191事件挑战</small></div>
          <div className={styles.tenbaggerGrid}>
            {["2x", "5x", "10x"].map((threshold) => {
              const result = asObject(thresholdRetrieval[threshold]);
              return (
                <div key={threshold}>
                  <span>{threshold.replace("x", "倍")} MFE年份 · {integer(metric(result, ["events"]))} 个</span>
                  <strong>{`${decimal(metric(result, ["top_decile_lift"]), 2)}×`}</strong>
                  <small>Top 10% 提升 · 捕获 {rate(metric(result, ["event_recall_in_top_decile"]))}</small>
                </div>
              );
            })}
            <div>
              <span>191事件外部挑战</span>
              <strong>{metric(tenbagger, ["eligible_events", "events"]) === undefined ? "未运行" : integer(metric(tenbagger, ["eligible_events", "events"]))}</strong>
              <small>必须在完整typed模型冻结后单独检验</small>
            </div>
          </div>
          <p className={styles.note}>{String(tenbagger.status_note ?? "当前没有用191只事后筛出的十倍股反向训练或调阈值；本页只报告普通年度滚动模型对自然高倍MFE年份的检索能力。")}</p>
        </section>

        <section className={styles.panel} id="stocks">
          <div className={styles.panelHead}><div><span className={styles.eyebrow}>OUT-OF-TIME LEDGER</span><h2>逐股逐年结果</h2></div><small>{filteredStocks.length.toLocaleString()} 只股票</small></div>
          <div className={styles.toolbar}>
            <label><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 AAPL、META、板块…" aria-label="搜索V2股票" /></label>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="V2结果排序">
              <option value="pairwise">同股排序正确率 ↓</option>
              <option value="direction">方向准确率 ↓</option>
              <option value="neutral">中性选择准确率 ↓</option>
              <option value="spearman">幅度秩相关 ↓</option>
              <option value="ticker">代码 A—Z</option>
            </select>
          </div>
          <StockTable stocks={filteredStocks.slice(0, 200)} onOpen={openStock} />
          {filteredStocks.length > 200 && <p className={styles.note}>为保持页面流畅，当前显示前200只；输入代码可直接定位其余股票。</p>}
        </section>

        {selected && <StockDetail stock={selected} rows={detailRows} loading={detailLoading} error={detailError} onClose={() => { setSelected(null); setDetailRows([]); }} />}

        <section className={styles.methodSection} id="method">
          <div><span className={styles.eyebrow}>LEAKAGE-SAFE PROTOCOL</span><h2>这一页如何防止“看过答案再预测”</h2></div>
          <ol>
            <li><b>01</b><div><strong>锚点冻结</strong><p>每条预测保存训练截止日；必须满足 train_cutoff &lt; anchor_date。</p></div></li>
            <li><b>02</b><div><strong>A0不反向换神</strong><p>只使用日干×月令表确定的算法主用神；历史K线逆推主用神不进入输入。</p></div></li>
            <li><b>03</b><div><strong>滚动时间外</strong><p>标准化、阈值、方向残差和幅度头全部只在当折过去数据上拟合。</p></div></li>
            <li><b>04</b><div><strong>覆盖率不隐藏</strong><p>A0 原本允许输出中性，因此明确方向命中率与方向覆盖率分列；V2必须覆盖全部年份，并与同样全覆盖的永久看涨比较。</p></div></li>
            <li><b>05</b><div><strong>研究限制单列</strong><p>当前成分回看存在幸存者偏差；代理上市时刻与未冻结完整typed矩阵不得隐藏。</p></div></li>
          </ol>
          {!!warnings.length && <div className={styles.warningList}>{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
          <div className={styles.provenance}><span>生成时间 {String(summary.generated_at ?? "—")}</span><span>Schema {String(summary.schema_version ?? "—")}</span><span>数据哈希 {String(model.data_hash ?? "—").slice(0, 16) || "—"}</span></div>
        </section>
      </div>
    </main>
  );
}
