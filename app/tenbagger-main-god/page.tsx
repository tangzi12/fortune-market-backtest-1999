"use client";

import React, { useEffect, useMemo, useState } from "react";
import styles from "./tenbagger-main-god.module.css";

type Direction = "up" | "neutral" | "down";

type Projection = {
  main_god: string;
  luck_score: number;
  annual_score: number;
  score: number;
  status: string;
  direction: Direction;
};

type GodMetric = {
  main_god: string;
  samples: number;
  actual_up: number;
  actual_down: number;
  hits: number;
  neutral_predictions: number;
  explicit_predictions: number;
  ordinary_hit_rate: number | null;
  full_accuracy: number | null;
  direction_coverage: number | null;
  full_ba: number | null;
};

type MainGodFit = {
  sample_status: "sufficient" | "insufficient" | "no_data";
  replacement_applied: boolean;
  selection_status: string;
  selected_main_god: string;
  second_main_god: string | null;
  qualified_candidate_count: number;
  near_tie: boolean;
  margin: number | null;
  algorithm: GodMetric;
  selected: GodMetric;
};

type HistoryRow = {
  year: number;
  pillar: string;
  complete: boolean;
  actual_direction: Direction | null;
  actual_return_pct: number | null;
  algorithm_score: number;
  algorithm_prediction: Direction;
  selected_score: number;
  selected_prediction: Direction;
};

type StockRow = {
  ticker: string;
  name: string;
  market_category: string;
  industry_element: string | null;
  event_date: string;
  window_end: string;
  first_10x_date: string | null;
  days_to_10x: number | null;
  strict_high_multiple: number | null;
  event_cycle_year: number;
  event_cycle_pillar: string;
  event_actual_complete: boolean;
  event_actual_direction: Direction | null;
  event_actual_return_pct: number | null;
  listing_date: string;
  listing_time_et: string;
  first_luck_start_et: string;
  bazi: string;
  listing_time_basis: string;
  basis_confidence: string;
  identity_method: string;
  identity_audit_status: string;
  identity_risk_tier: string;
  identity_note: string;
  identity_primary_source: string;
  algorithm_main_god: string;
  full_history_fit: MainGodFit;
  event_prefix_fit: MainGodFit;
  algorithm_event: Projection;
  full_history_event: Projection;
  causal_event: Projection;
  history: HistoryRow[];
};

type AggregateMetric = {
  stocks: number;
  samples: number;
  hits: number;
  neutral_predictions: number;
  explicit_predictions: number;
  ordinary_hit_rate: number | null;
  full_accuracy: number | null;
  direction_coverage: number | null;
};

type EventPredictionSummary = {
  direction_counts: Record<Direction, number>;
  bullish_capture_count: number;
  bullish_capture_rate_all_191: number;
  actual_complete_direction_rows: number;
  explicit_direction_rows: number;
  direction_hits: number;
  direction_hit_rate_excluding_neutral: number | null;
  direction_coverage_on_complete_rows: number | null;
  full_accuracy_including_neutral: number | null;
};

type PageSummary = {
  stock_count: number;
  price_payload_count: number;
  full_history: {
    eligible_stocks: number;
    replacement_count: number;
    sample_status_counts: Record<string, number>;
    algorithm: AggregateMetric;
    selected: AggregateMetric;
  };
  event_prefix: {
    eligible_stocks: number;
    replacement_count: number;
    algorithm: AggregateMetric;
    selected: AggregateMetric;
  };
  event_year: {
    actual_complete_rows: number;
    algorithm: EventPredictionSummary;
    full_history_in_sample: EventPredictionSummary;
    event_prefix_causal: EventPredictionSummary;
  };
  identity: {
    audited_candidate_used: number;
    proxy_used: number;
  };
};

type PagePayload = {
  schema_version: string;
  generated_at: string;
  data_cutoff: string;
  rules: {
    algorithm_main_god: string;
    annual_formula: string;
    selection_candidates: string[];
    minimum_samples: number;
    minimum_up_years: number;
    minimum_down_years: number;
    replacement_gate: string[];
    full_history_warning: string;
    event_prefix_rule: string;
  };
  summary: PageSummary;
  rows: StockRow[];
};

type CausalFilter = "all" | "replaced" | "retained" | "insufficient";
type DirectionFilter = "all" | Direction;
type SortKey = "event-desc" | "ticker" | "multiple-desc" | "causal-score" | "uplift";

const PAGE_SIZES = [15, 25, 50];
const EMPTY_ROWS: StockRow[] = [];

function asPayload(value: unknown): PagePayload {
  if (!value || typeof value !== "object" || !Array.isArray((value as PagePayload).rows)) {
    throw new Error("数据结构无效");
  }
  return value as PagePayload;
}

async function fetchPayload(): Promise<PagePayload> {
  const relativePath = "data/tenbagger-main-god/index.json";
  const url = typeof document === "undefined"
    ? `/${relativePath}`
    : new URL(relativePath, document.baseURI).toString();
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return asPayload(await response.json());
}

function pct(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `${(value * 100).toFixed(digits)}%`;
}

function signedPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const normalized = Math.abs(value) < 0.05 ? 0 : value;
  return `${normalized > 0 ? "+" : ""}${normalized.toFixed(1)}%`;
}

function scoreText(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const normalized = Math.abs(value) < 0.005 ? 0 : value;
  return `${normalized > 0 ? "+" : ""}${normalized.toFixed(2)}`;
}

function integer(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : Math.round(value).toLocaleString("zh-CN");
}

function directionLabel(direction: Direction | null | undefined): string {
  if (direction === "up") return "看涨";
  if (direction === "down") return "看跌";
  if (direction === "neutral") return "中性";
  return "—";
}

function directionClass(direction: Direction | null | undefined): string {
  if (direction === "up") return styles.up;
  if (direction === "down") return styles.down;
  return styles.neutral;
}

function fitStatusLabel(fit: MainGodFit): string {
  if (fit.replacement_applied) return "已替换";
  if (fit.sample_status === "insufficient") return "样本不足 · 保留原神";
  if (fit.sample_status === "no_data") return "无历史样本 · 保留原神";
  return "未通过三门槛 · 保留原神";
}

function splitEt(value: string): { date: string; time: string } {
  const [date = "—", time = "—"] = String(value || "").trim().split(/\s+/, 2);
  return { date: date || "—", time: time || "—" };
}

function predictionHit(
  projection: Projection,
  actual: Direction | null,
  complete: boolean,
): "hit" | "miss" | "neutral" | "pending" {
  if (!complete || !actual) return "pending";
  if (projection.direction === "neutral") return "neutral";
  return projection.direction === actual ? "hit" : "miss";
}

function PredictionChip({
  projection,
  annotation,
}: {
  projection: Projection;
  annotation?: string;
}) {
  return (
    <div className={styles.projection}>
      <div>
        <span className={styles.godChip}>{projection.main_god || "—"}</span>
        <span className={`${styles.directionChip} ${directionClass(projection.direction)}`}>
          {directionLabel(projection.direction)}
        </span>
      </div>
      <strong>{scoreText(projection.score)}</strong>
      <small>行运 {scoreText(projection.luck_score)} · 流年 {scoreText(projection.annual_score)}</small>
      {annotation && <em>{annotation}</em>}
    </div>
  );
}

function MetricLine({ metric }: { metric: GodMetric }) {
  return (
    <span className={styles.metricLine}>
      <b>普通 {pct(metric.ordinary_hit_rate)}</b>
      <small>覆盖 {pct(metric.direction_coverage)} · {integer(metric.hits)}/{integer(metric.explicit_predictions)}</small>
    </span>
  );
}

function SummaryMetric({
  label,
  value,
  note,
  tone = "blue",
}: {
  label: string;
  value: string;
  note: string;
  tone?: "blue" | "green" | "red" | "violet" | "amber";
}) {
  return (
    <div className={`${styles.summaryMetric} ${styles[tone]}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function FitOverview({
  title,
  eyebrow,
  fit,
  caution,
  causal = false,
}: {
  title: string;
  eyebrow: string;
  fit: PageSummary["full_history"] | PageSummary["event_prefix"];
  caution: string;
  causal?: boolean;
}) {
  const ordinaryDelta = (
    (fit.selected.ordinary_hit_rate ?? 0) - (fit.algorithm.ordinary_hit_rate ?? 0)
  );
  return (
    <article className={`${styles.fitOverview} ${causal ? styles.causalOverview : styles.inSampleOverview}`}>
      <header>
        <div>
          <span className={styles.eyebrow}>{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        <span className={`${styles.auditFlag} ${causal ? styles.formal : styles.diagnostic}`}>
          {causal ? "正式事件前口径" : "样本内诊断"}
        </span>
      </header>
      <div className={styles.fitStats}>
        <div><span>可逆推股票</span><strong>{integer(fit.eligible_stocks)} / 191</strong></div>
        <div><span>实际替换</span><strong>{integer(fit.replacement_count)}</strong></div>
        <div><span>普通命中</span><strong>{pct(fit.algorithm.ordinary_hit_rate)} <i>→</i> {pct(fit.selected.ordinary_hit_rate)}</strong></div>
        <div><span>普通命中变化</span><strong className={ordinaryDelta > 0 ? styles.positive : ""}>{ordinaryDelta > 0 ? "+" : ""}{pct(ordinaryDelta)}</strong></div>
        <div><span>全样本准确</span><strong>{pct(fit.algorithm.full_accuracy)} <i>→</i> {pct(fit.selected.full_accuracy)}</strong></div>
        <div><span>方向覆盖</span><strong>{pct(fit.algorithm.direction_coverage)} <i>→</i> {pct(fit.selected.direction_coverage)}</strong></div>
      </div>
      <p>{caution}</p>
    </article>
  );
}

function HistoryLedger({ row }: { row: StockRow }) {
  const fullGod = row.full_history_fit.selected_main_god;
  return (
    <div className={styles.expandedPanel}>
      <div className={styles.expandedTop}>
        <div>
          <span>事件前选神截止</span>
          <strong>{row.event_cycle_year - 1} 年年运结束前</strong>
          <small>事件所属 {row.event_cycle_year} · {row.event_cycle_pillar}</small>
        </div>
        <div>
          <span>因果选神结论</span>
          <strong>{row.algorithm_main_god} → {row.event_prefix_fit.selected_main_god}</strong>
          <small>{fitStatusLabel(row.event_prefix_fit)}</small>
        </div>
        <div>
          <span>事件前年样本</span>
          <strong>{integer(row.event_prefix_fit.algorithm.samples)}</strong>
          <small>涨 {integer(row.event_prefix_fit.algorithm.actual_up)} · 跌 {integer(row.event_prefix_fit.algorithm.actual_down)}</small>
        </div>
        <div>
          <span>因果事件年结果</span>
          <strong className={directionClass(row.causal_event.direction)}>
            {directionLabel(row.causal_event.direction)} · {scoreText(row.causal_event.score)}
          </strong>
          <small>实际年K {row.event_actual_complete ? signedPct(row.event_actual_return_pct) : "尚不完整"}</small>
        </div>
      </div>

      <div className={styles.gateStrip}>
        <strong>事件前替换规则</strong>
        <span>普通命中必须严格提高</span>
        <span>全样本命中数不得下降</span>
        <span>明确预测数不得下降</span>
        <em>{row.event_prefix_fit.replacement_applied ? "三门槛通过" : fitStatusLabel(row.event_prefix_fit)}</em>
      </div>

      <div className={styles.historyHeading}>
        <div>
          <h3>逐年历史账本</h3>
          <p>
            蓝色列为算法主神；紫色列为用整段历史选出的样本内主神 {fullGod}。
            紫色结果用于解释，不是当年可获得的因果预测。
          </p>
        </div>
        <span>{row.history.length} 个年运周期</span>
      </div>

      <div className={styles.historyScroll}>
        <table className={styles.historyTable}>
          <thead>
            <tr>
              <th>年运 / 干支</th>
              <th>数据状态</th>
              <th>实际立春年K</th>
              <th>算法主神 {row.algorithm_main_god}</th>
              <th>算法同步</th>
              <th>全历史样本内主神 {fullGod}</th>
              <th>样本内同步</th>
            </tr>
          </thead>
          <tbody>
            {row.history.slice().reverse().map((history) => {
              const algorithmHit = history.complete
                && history.actual_direction
                && history.algorithm_prediction !== "neutral"
                ? history.algorithm_prediction === history.actual_direction
                : null;
              const selectedHit = history.complete
                && history.actual_direction
                && history.selected_prediction !== "neutral"
                ? history.selected_prediction === history.actual_direction
                : null;
              return (
                <tr
                  key={`${row.ticker}-${history.year}`}
                  className={history.year === row.event_cycle_year ? styles.eventHistoryRow : ""}
                >
                  <td>
                    <strong>{history.year}</strong>
                    <small>{history.pillar}{history.year === row.event_cycle_year ? " · 十倍事件归属年" : ""}</small>
                  </td>
                  <td>
                    <span className={history.complete ? styles.complete : styles.incomplete}>
                      {history.complete ? "完整" : "不完整"}
                    </span>
                  </td>
                  <td>
                    <strong className={directionClass(history.actual_direction)}>
                      {history.complete ? signedPct(history.actual_return_pct) : "—"}
                    </strong>
                    <small>{history.complete ? directionLabel(history.actual_direction) : "不计命中"}</small>
                  </td>
                  <td>
                    <strong>{scoreText(history.algorithm_score)}</strong>
                    <small className={directionClass(history.algorithm_prediction)}>{directionLabel(history.algorithm_prediction)}</small>
                  </td>
                  <td>{algorithmHit === null ? <span className={styles.muted}>—</span> : algorithmHit ? <span className={styles.hit}>命中</span> : <span className={styles.miss}>背离</span>}</td>
                  <td>
                    <strong>{scoreText(history.selected_score)}</strong>
                    <small className={directionClass(history.selected_prediction)}>{directionLabel(history.selected_prediction)}</small>
                  </td>
                  <td>{selectedHit === null ? <span className={styles.muted}>—</span> : selectedHit ? <span className={styles.hit}>命中</span> : <span className={styles.miss}>背离</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function TenbaggerMainGodPage() {
  const [data, setData] = useState<PagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [yearFilter, setYearFilter] = useState("all");
  const [causalFilter, setCausalFilter] = useState<CausalFilter>("all");
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("all");
  const [sortBy, setSortBy] = useState<SortKey>("event-desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    fetchPayload()
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "未知错误");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = data?.rows ?? EMPTY_ROWS;
  const years = useMemo(
    () => [...new Set(rows.map((row) => row.event_cycle_year))].sort((a, b) => b - a),
    [rows],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows
      .filter((row) => {
        const matchesQuery = !needle || [
          row.ticker,
          row.name,
          row.market_category,
          row.industry_element ?? "",
          row.bazi,
        ].join(" ").toLowerCase().includes(needle);
        const matchesYear = yearFilter === "all" || row.event_cycle_year === Number(yearFilter);
        const matchesDirection = directionFilter === "all" || row.causal_event.direction === directionFilter;
        const matchesCausal = causalFilter === "all"
          || (causalFilter === "replaced" && row.event_prefix_fit.replacement_applied)
          || (causalFilter === "retained" && row.event_prefix_fit.sample_status === "sufficient" && !row.event_prefix_fit.replacement_applied)
          || (causalFilter === "insufficient" && row.event_prefix_fit.sample_status !== "sufficient");
        return matchesQuery && matchesYear && matchesDirection && matchesCausal;
      })
      .sort((left, right) => {
        if (sortBy === "ticker") return left.ticker.localeCompare(right.ticker);
        if (sortBy === "multiple-desc") return (right.strict_high_multiple ?? -1) - (left.strict_high_multiple ?? -1);
        if (sortBy === "causal-score") return right.causal_event.score - left.causal_event.score;
        if (sortBy === "uplift") {
          const leftDelta = (left.event_prefix_fit.selected.ordinary_hit_rate ?? -1)
            - (left.event_prefix_fit.algorithm.ordinary_hit_rate ?? -1);
          const rightDelta = (right.event_prefix_fit.selected.ordinary_hit_rate ?? -1)
            - (right.event_prefix_fit.algorithm.ordinary_hit_rate ?? -1);
          return rightDelta - leftDelta;
        }
        return right.event_date.localeCompare(left.event_date) || left.ticker.localeCompare(right.ticker);
      });
  }, [rows, query, yearFilter, directionFilter, causalFilter, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  function resetPage() {
    setPage(1);
  }

  function toggleExpanded(ticker: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  }

  if (loading) {
    return (
      <main className={styles.page}>
        <div className={styles.loadingState} role="status">
          <i aria-hidden="true" />
          <strong>正在装载191只股票主用神重跑</strong>
          <span>全历史样本内拟合与事件前因果回放将分开显示</span>
        </div>
      </main>
    );
  }

  if (!data || error) {
    return (
      <main className={styles.page}>
        <div className={styles.errorState} role="alert">
          <span>!</span>
          <h1>主用神对照数据暂时无法读取</h1>
          <p>{error || "数据文件尚未生成。"}</p>
          <button type="button" onClick={() => window.location.reload()}>重新载入</button>
        </div>
      </main>
    );
  }

  const summary = data.summary;
  const causalEvent = summary.event_year.event_prefix_causal;
  const algorithmEvent = summary.event_year.algorithm;
  const inSampleEvent = summary.event_year.full_history_in_sample;

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <a href="../" aria-label="返回年运历史回测首页">
          <span>运</span>
          <div><strong>十倍股主用神回放</strong><small>MAIN-GOD AUDIT · 191 STOCKS</small></div>
        </a>
        <nav aria-label="本页导航">
          <a href="#comparison">选神对照</a>
          <a href="#ledger">191只总表</a>
          <a href="#method">计算口径</a>
          <a href="../tenbagger-m0/">M0 前瞻页</a>
        </nav>
        <div className={styles.dataStatus}><i aria-hidden="true" />{integer(summary.stock_count)} STOCKS</div>
      </header>

      <div className={styles.shell}>
        <section className={styles.hero} id="overview">
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>ALGORITHM GOD → HISTORICAL FIT → CAUSAL REPLAY</span>
            <h1>191 只十倍股，<br /><em>三套主用神结果同表核对。</em></h1>
            <p>
              每只股票先用日干×月令算出的主用神预测；再展示全历史样本内逆推；
              正式事件年回放只允许使用事件所属立春年以前的K线选神。
            </p>
            <div className={styles.heroTags}>
              <span>年运 60% 行运 + 40% 流年</span>
              <span>普通命中提高才考虑替换</span>
              <span>全样本与覆盖不得下降</span>
              <span>中性不伪装成方向</span>
            </div>
          </div>
          <div className={styles.heroBoard}>
            <div>
              <span>事件前因果选神</span>
              <strong>{integer(summary.event_prefix.eligible_stocks)}</strong>
              <small>历史门槛合格 / 191</small>
            </div>
            <div>
              <span>因果替换主神</span>
              <strong>{integer(summary.event_prefix.replacement_count)}</strong>
              <small>三项门槛全部通过</small>
            </div>
            <div>
              <span>因果事件年普通命中</span>
              <strong>{pct(causalEvent.direction_hit_rate_excluding_neutral)}</strong>
              <small>{integer(causalEvent.direction_hits)} / {integer(causalEvent.explicit_direction_rows)} 个明确方向</small>
            </div>
            <div>
              <span>因果事件年覆盖</span>
              <strong>{pct(causalEvent.direction_coverage_on_complete_rows)}</strong>
              <small>只对完整立春年K计分</small>
            </div>
          </div>
        </section>

        <aside className={styles.separationBanner}>
          <div>
            <span className={styles.diagnosticDot} />
            <strong>全历史样本内逆推</strong>
            <p>同一段K线既选神又评分，只用于解释与比较，不能称为事件发生前的预测准确率。</p>
          </div>
          <b>≠</b>
          <div>
            <span className={styles.formalDot} />
            <strong>事件前因果回放</strong>
            <p>只使用事件归属年以前的完整年K选神；这是本页正式的事件年预测口径。</p>
          </div>
        </aside>

        <section className={styles.comparisonGrid} id="comparison">
          <FitOverview
            eyebrow="FULL-HISTORY · IN-SAMPLE"
            title="全历史样本内主用神改进"
            fit={summary.full_history}
            caution={data.rules.full_history_warning}
          />
          <FitOverview
            eyebrow="EVENT-PREFIX · CAUSAL"
            title="事件前主用神选择"
            fit={summary.event_prefix}
            caution={data.rules.event_prefix_rule}
            causal
          />
        </section>

        <section className={styles.eventScorecard} aria-label="事件年三口径结果">
          <header>
            <div><span className={styles.eyebrow}>EVENT-YEAR SCORECARD</span><h2>事件所属立春年的三种预测</h2></div>
            <p>普通命中只对“实际年K完整且预测非中性”的行计算；看涨覆盖只是十倍正样本中给出看涨的比例。</p>
          </header>
          <div className={styles.scorecardGrid}>
            <SummaryMetric
              label="算法主神 · 事件年普通命中"
              value={pct(algorithmEvent.direction_hit_rate_excluding_neutral)}
              note={`方向覆盖 ${pct(algorithmEvent.direction_coverage_on_complete_rows)} · 看涨 ${integer(algorithmEvent.bullish_capture_count)}/191`}
              tone="blue"
            />
            <SummaryMetric
              label="全历史逆推 · 样本内演示"
              value={pct(inSampleEvent.direction_hit_rate_excluding_neutral)}
              note={`含事件及未来数据 · 看涨 ${integer(inSampleEvent.bullish_capture_count)}/191`}
              tone="violet"
            />
            <SummaryMetric
              label="事件前因果神 · 事件年普通命中"
              value={pct(causalEvent.direction_hit_rate_excluding_neutral)}
              note={`方向覆盖 ${pct(causalEvent.direction_coverage_on_complete_rows)} · 看涨 ${integer(causalEvent.bullish_capture_count)}/191`}
              tone="green"
            />
            <SummaryMetric
              label="完整事件年K"
              value={`${integer(summary.event_year.actual_complete_rows)} / 191`}
              note="其余仍显示预测，但不计事件年命中"
              tone="amber"
            />
          </div>
        </section>

        <section className={styles.ledgerPanel} id="ledger">
          <div className={styles.panelHead}>
            <div><span className={styles.eyebrow}>STOCK-LEVEL AUDIT LEDGER</span><h2>191 只股票逐只对照</h2></div>
            <p>展开任一股票可查看算法主神与全历史样本内主神的逐年账本。</p>
          </div>

          <div className={styles.toolbar} role="search" aria-label="筛选191只股票">
            <label className={styles.searchBox}>
              <span aria-hidden="true">⌕</span>
              <span className={styles.srOnly}>搜索股票、公司、行业或八字</span>
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  resetPage();
                }}
                placeholder="搜索股票、公司、行业或八字…"
              />
              {query && <button type="button" onClick={() => { setQuery(""); resetPage(); }} aria-label="清除搜索">×</button>}
            </label>
            <label>
              <span className={styles.srOnly}>事件立春年</span>
              <select value={yearFilter} onChange={(event) => { setYearFilter(event.target.value); resetPage(); }}>
                <option value="all">全部事件年</option>
                {years.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </label>
            <label>
              <span className={styles.srOnly}>事件前主用神状态</span>
              <select value={causalFilter} onChange={(event) => { setCausalFilter(event.target.value as CausalFilter); resetPage(); }}>
                <option value="all">全部因果选神状态</option>
                <option value="replaced">事件前已替换</option>
                <option value="retained">事件前合格但保留</option>
                <option value="insufficient">事件前历史不足</option>
              </select>
            </label>
            <label>
              <span className={styles.srOnly}>因果事件年预测</span>
              <select value={directionFilter} onChange={(event) => { setDirectionFilter(event.target.value as DirectionFilter); resetPage(); }}>
                <option value="all">全部因果预测</option>
                <option value="up">因果预测看涨</option>
                <option value="neutral">因果预测中性</option>
                <option value="down">因果预测看跌</option>
              </select>
            </label>
            <label>
              <span className={styles.srOnly}>排序</span>
              <select value={sortBy} onChange={(event) => { setSortBy(event.target.value as SortKey); resetPage(); }}>
                <option value="event-desc">事件时间 · 新到旧</option>
                <option value="ticker">股票代码 · A到Z</option>
                <option value="multiple-desc">实际倍数 · 高到低</option>
                <option value="causal-score">因果分数 · 高到低</option>
                <option value="uplift">事件前普通命中提升 · 高到低</option>
              </select>
            </label>
          </div>

          <div className={styles.resultBar}>
            <span>显示 <strong>{visible.length}</strong> / 筛选后 {filtered.length} / 全部 {rows.length}</span>
            <label>
              每页
              <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); resetPage(); }}>
                {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
          </div>

          <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="十倍股主用神对照总表">
            <table className={styles.mainTable}>
              <caption className={styles.srOnly}>191只十倍股算法主用神、样本内逆推和事件前因果主用神逐股对照</caption>
              <thead>
                <tr>
                  <th rowSpan={2}><span className={styles.srOnly}>展开</span></th>
                  <th rowSpan={2}>股票 / 十倍事件</th>
                  <th rowSpan={2}>上市 ET / 起运 ET</th>
                  <th rowSpan={2}>上市八字</th>
                  <th colSpan={3} className={styles.groupHead}>主用神选择</th>
                  <th colSpan={3} className={styles.groupHead}>事件所属立春年预测</th>
                  <th rowSpan={2}>实际立春年K</th>
                  <th rowSpan={2}>十倍事实</th>
                </tr>
                <tr>
                  <th>算法主神<br /><small>全历史普通命中 / 覆盖</small></th>
                  <th className={styles.inSampleHead}>全历史逆推<br /><small>样本内诊断</small></th>
                  <th className={styles.causalHead}>事件前因果主神<br /><small>仅事件前样本</small></th>
                  <th>算法主神预测</th>
                  <th className={styles.inSampleHead}>全历史神预测<br /><small>含未来 · 不计正式结果</small></th>
                  <th className={styles.causalHead}>因果主神预测<br /><small>正式事件年口径</small></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const isExpanded = expanded.has(row.ticker);
                  const luckStart = splitEt(row.first_luck_start_et);
                  const causalHit = predictionHit(row.causal_event, row.event_actual_direction, row.event_actual_complete);
                  return (
                    <React.Fragment key={row.ticker}>
                      <tr className={isExpanded ? styles.openRow : ""}>
                        <td>
                          <button
                            type="button"
                            className={styles.expandButton}
                            onClick={() => toggleExpanded(row.ticker)}
                            aria-expanded={isExpanded}
                            aria-label={`${isExpanded ? "收起" : "展开"} ${row.ticker} 逐年账本`}
                          >
                            {isExpanded ? "−" : "+"}
                          </button>
                        </td>
                        <th scope="row">
                          <div className={styles.stockCell}>
                            <div><strong>{row.ticker}</strong><span>{row.name}</span></div>
                            <small>{row.market_category} · 行业五行 {row.industry_element || "—"}</small>
                            <time dateTime={row.event_date}>{row.event_date}</time>
                            <em>事件归属 {row.event_cycle_year} · {row.event_cycle_pillar}</em>
                          </div>
                        </th>
                        <td>
                          <div className={styles.timeCell}>
                            <span><b>上市</b>{row.listing_date || "—"}<small>{row.listing_time_et || "—"} ET · {row.listing_time_basis || "代理待核"}</small></span>
                            <span><b>起运</b>{luckStart.date}<small>{luckStart.time} ET</small></span>
                          </div>
                        </td>
                        <td>
                          <div className={styles.baziCell}><strong>{row.bazi || "—"}</strong><small>{row.identity_note || row.identity_audit_status || "身份口径待核"}</small></div>
                        </td>
                        <td>
                          <div className={styles.godMetricCell}>
                            <span className={styles.algorithmGod}>{row.algorithm_main_god}</span>
                            <MetricLine metric={row.full_history_fit.algorithm} />
                            <small>全样本 {pct(row.full_history_fit.algorithm.full_accuracy)}</small>
                          </div>
                        </td>
                        <td className={styles.inSampleCell}>
                          <div className={styles.godMetricCell}>
                            <div>
                              <span className={styles.sampleGod}>{row.full_history_fit.selected_main_god}</span>
                              <em className={row.full_history_fit.replacement_applied ? styles.replaced : styles.retained}>
                                {row.full_history_fit.replacement_applied ? "样本内替换" : "保留原神"}
                              </em>
                            </div>
                            <MetricLine metric={row.full_history_fit.selected} />
                            <small>{fitStatusLabel(row.full_history_fit)}</small>
                          </div>
                        </td>
                        <td className={styles.causalCell}>
                          <div className={styles.godMetricCell}>
                            <div>
                              <span className={styles.causalGod}>{row.event_prefix_fit.selected_main_god}</span>
                              <em className={row.event_prefix_fit.replacement_applied ? styles.replaced : styles.retained}>
                                {row.event_prefix_fit.replacement_applied ? "事件前替换" : "事件前保留"}
                              </em>
                            </div>
                            <MetricLine metric={row.event_prefix_fit.selected} />
                            <small>事件前年样本 {integer(row.event_prefix_fit.algorithm.samples)} · {fitStatusLabel(row.event_prefix_fit)}</small>
                          </div>
                        </td>
                        <td><PredictionChip projection={row.algorithm_event} /></td>
                        <td className={styles.inSampleCell}><PredictionChip projection={row.full_history_event} annotation="样本内" /></td>
                        <td className={styles.causalCell}>
                          <PredictionChip projection={row.causal_event} annotation={row.event_prefix_fit.replacement_applied ? "因果逆推神" : "原算法神"} />
                          <span className={`${styles.outcomeChip} ${styles[causalHit]}`}>
                            {causalHit === "hit" ? "年K命中" : causalHit === "miss" ? "年K背离" : causalHit === "neutral" ? "中性不计普通命中" : "年K待完成"}
                          </span>
                        </td>
                        <td>
                          <div className={styles.actualCell}>
                            <strong className={row.event_actual_complete ? directionClass(row.event_actual_direction) : styles.muted}>
                              {row.event_actual_complete ? signedPct(row.event_actual_return_pct) : "—"}
                            </strong>
                            <span>{row.event_actual_complete ? directionLabel(row.event_actual_direction) : "年K不完整"}</span>
                            <small>{row.event_cycle_year} 立春周期</small>
                          </div>
                        </td>
                        <td>
                          <div className={styles.tenXCell}>
                            <strong>{row.strict_high_multiple === null ? "—" : `${row.strict_high_multiple.toFixed(2)}×`}</strong>
                            <span>{row.days_to_10x === null ? "达到天数未知" : `${integer(row.days_to_10x)} 天达到`}</span>
                            <small>{row.first_10x_date || "—"}</small>
                            <em className={row.causal_event.direction === "up" ? styles.captured : styles.notCaptured}>
                              {row.causal_event.direction === "up" ? "十倍样本看涨覆盖" : "未给出明确看涨"}
                            </em>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className={styles.expandedRow}>
                          <td colSpan={12}><HistoryLedger row={row} /></td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            {!visible.length && <div className={styles.emptyState}>没有符合当前筛选条件的股票。</div>}
          </div>

          <div className={styles.pagination} aria-label="分页">
            <button type="button" onClick={() => setPage(1)} disabled={safePage === 1}>首页</button>
            <button type="button" onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage === 1}>← 上一页</button>
            <span>第 <strong>{safePage}</strong> / {totalPages} 页</span>
            <button type="button" onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage === totalPages}>下一页 →</button>
            <button type="button" onClick={() => setPage(totalPages)} disabled={safePage === totalPages}>末页</button>
          </div>
        </section>

        <section className={styles.methodPanel} id="method">
          <div className={styles.methodIntro}>
            <span className={styles.eyebrow}>HOW TO READ</span>
            <h2>同一只股票，为什么显示三种事件年预测？</h2>
            <p>三列回答的是三个不同问题，不能把它们合并成一个“优化后准确率”。</p>
          </div>
          <div className={styles.methodGrid}>
            <article><b>01</b><h3>算法主神</h3><p>{data.rules.algorithm_main_god}。它不读取股票历史K线，是三套结果的冻结基准。</p></article>
            <article><b>02</b><h3>全历史样本内逆推</h3><p>穷举十天干，在整段已知历史上选神并回算同一段K线。可以解释数据，但存在明显样本内拟合。</p></article>
            <article><b>03</b><h3>事件前因果主神</h3><p>{data.rules.event_prefix_rule}。历史不足或候选未通过三门槛时，自动保留算法主神。</p></article>
            <article><b>04</b><h3>两个“命中”口径</h3><p>年K方向命中比较预测与立春周期收盘方向；十倍看涨覆盖只检查模型是否给出看涨，并不代表预测了十倍幅度。</p></article>
          </div>
          <div className={styles.formulaRow}>
            <strong>{data.rules.annual_formula}</strong>
            <span>方向阈值：分数 ≥ +1 看涨；−1 &lt; 分数 &lt; +1 中性；分数 ≤ −1 看跌</span>
            <span>逆推门槛：N≥{data.rules.minimum_samples}，实际涨/跌各≥{data.rules.minimum_up_years}</span>
          </div>
          <footer>
            <span>Schema {data.schema_version}</span>
            <span>Data cutoff {data.data_cutoff}</span>
            <span>Generated {data.generated_at}</span>
            <strong>研究回测 · 非投资建议</strong>
          </footer>
        </section>
      </div>
    </main>
  );
}
