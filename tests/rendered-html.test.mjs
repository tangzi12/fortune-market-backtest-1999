import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the finished backtest shell and metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /<title>年运历史回测 · 命理信号 × 真实K线<\/title>/);
  assert.match(html, /property="og:image" content="\/og\.png"/);
  assert.match(html, /正在装载历史回测/);
  assert.match(html, /连接股票索引、年运与节气月运数据/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships the verified dataset, explicit period counts, and light theme", async () => {
  const [summaryText, indexText, layout, packageJson, styles] = await Promise.all([
    readFile(new URL("../public/data/summary.json", import.meta.url), "utf8"),
    readFile(new URL("../public/data/index.json", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const summary = JSON.parse(summaryText);
  const stockIndex = JSON.parse(indexText);

  assert.equal(summary.coverage.stock_count_with_prices, 518);
  assert.equal(stockIndex.stock_count, 518);
  assert.equal(stockIndex.stocks.length, 518);
  const dash = stockIndex.stocks.find((stock) => stock.ticker === "DASH");
  const ddog = stockIndex.stocks.find((stock) => stock.ticker === "DDOG");
  assert.deepEqual(
    [dash.annual_complete_periods, dash.annual_samples, dash.annual_neutral_periods, dash.annual_hits],
    [5, 1, 4, 0],
  );
  assert.deepEqual(
    [ddog.annual_complete_periods, ddog.annual_samples, ddog.annual_neutral_periods, ddog.annual_hits],
    [6, 4, 2, 3],
  );
  assert.match(styles, /--bg:\s*#f8f9fb/);
  assert.match(styles, /--panel:\s*#ffffff/);
  assert.match(layout, /images:\s*\[\{ url: "\/og\.png", width: 1200, height: 630/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await access(new URL("../public/og.png", import.meta.url));
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await access(projectRoot);
});

test("publishes every first-luck start time and keeps the UI terminology aligned", async () => {
  const [indexText, pageSource, summaryText, metaText] = await Promise.all([
    readFile(new URL("../public/data/index.json", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/data/summary.json", import.meta.url), "utf8"),
    readFile(new URL("../public/data/stocks/META.json", import.meta.url), "utf8"),
  ]);
  const stockIndex = JSON.parse(indexText);
  const summary = JSON.parse(summaryText);
  const meta = JSON.parse(metaText);
  const firstLuckPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

  assert.equal(stockIndex.stocks.length, 518);
  const detailStocks = await Promise.all(stockIndex.stocks.map(async (stock) => {
    assert.match(String(stock.first_luck_start_et ?? ""), firstLuckPattern, `${stock.ticker} index first_luck_start_et`);
    const detail = JSON.parse(await readFile(new URL(`../public/data/${stock.data_path}`, import.meta.url), "utf8"));
    return { indexStock: stock, detailStock: detail.stock };
  }));
  for (const { indexStock, detailStock } of detailStocks) {
    assert.match(String(detailStock.first_luck_start_et ?? ""), firstLuckPattern, `${indexStock.ticker} detail first_luck_start_et`);
    assert.equal(indexStock.first_luck_start_et, detailStock.first_luck_start_et, `${indexStock.ticker} first-luck time must match`);
  }

  const listingColumn = pageSource.indexOf("<th>上市时间 ET</th>");
  const firstLuckColumn = pageSource.indexOf("<th>起运时间 ET</th>");
  const baziColumn = pageSource.indexOf("<th>上市时刻推算八字</th>");
  assert.ok(listingColumn >= 0 && listingColumn < firstLuckColumn && firstLuckColumn < baziColumn, "first-luck column must immediately follow listing time");
  assert.match(pageSource, /<th>上市时间 ET<\/th><th>起运时间 ET<\/th><th>上市时刻推算八字<\/th>/);
  assert.match(pageSource, /行运（起运前小运、起运后大运）/);
  assert.match(pageSource, /<em>60% 行运<\/em>/);
  assert.match(pageSource, /<em>36% 行运<\/em>/);
  assert.match(pageSource, /luckKindLabel\(segment\[3\]\)/);

  assert.match(summary.methodology.pre_luck_rule, /第1年取上市八字时柱/);
  assert.match(summary.methodology.luck_transition, /回测年仍按立春切分/);
  const meta2013 = meta.annual.find((row) => row.year === 2013);
  const meta2018 = meta.annual.find((row) => row.year === 2018);
  assert.deepEqual(meta2013.calculation.segments.map((segment) => [segment[0], segment[3]]), [
    ["庚午", "小运"],
    ["辛未", "小运"],
  ]);
  assert.equal(meta2013.total_score, 0.377522503334);
  assert.deepEqual(meta2018.calculation.segments.map((segment) => [segment[0], segment[3]]), [
    ["乙亥", "小运"],
    ["丙午", "大运"],
  ]);
  assert.equal(meta2018.total_score, -1.865127716095);
});

test("only replaces the algorithm main god when every annual improvement gate passes", async () => {
  const [indexText, pageSource, styles, costText, metaText, summaryText] = await Promise.all([
    readFile(new URL("../public/data/index.json", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../public/data/stocks/COST.json", import.meta.url), "utf8"),
    readFile(new URL("../public/data/stocks/META.json", import.meta.url), "utf8"),
    readFile(new URL("../public/data/summary.json", import.meta.url), "utf8"),
  ]);
  const stockIndex = JSON.parse(indexText);
  const cost = JSON.parse(costText).stock;
  const meta = JSON.parse(metaText).stock;
  const summary = JSON.parse(summaryText);
  const requiredFields = [
    "reverse_main_god",
    "reverse_main_god_label",
    "reverse_fit_score",
    "reverse_annual_full_balanced_accuracy",
    "reverse_annual_hit_rate_excluding_neutral",
    "reverse_annual_full_accuracy",
    "reverse_annual_hits",
    "reverse_annual_neutral_predictions",
    "reverse_annual_explicit_predictions",
    "reverse_annual_direction_coverage",
    "reverse_annual_eligible",
    "reverse_sample_status",
    "reverse_main_god_matches_algorithm",
    "reverse_replacement_applied",
    "reverse_selection_status",
    "reverse_qualified_candidate_count",
    "algorithm_annual_full_balanced_accuracy",
    "algorithm_annual_hit_rate_excluding_neutral",
    "algorithm_annual_full_accuracy",
    "algorithm_annual_hits",
    "algorithm_annual_neutral_predictions",
    "algorithm_annual_explicit_predictions",
    "algorithm_annual_direction_coverage",
  ];

  let sufficient = 0;
  let unavailable = 0;
  let replacements = 0;
  for (const stock of stockIndex.stocks) {
    for (const field of requiredFields) assert.ok(Object.hasOwn(stock, field), `${stock.ticker} missing ${field}`);
    assert.equal(stock.reverse_main_god_label, "K线逆推（样本内）", `${stock.ticker} reverse label`);
    assert.match(String(stock.reverse_sample_status), /^(sufficient|insufficient|no_data)$/, `${stock.ticker} reverse status`);
    assert.match(String(stock.reverse_selection_status), /^(replaced|retained_no_qualified_candidate|retained_insufficient_samples|retained_no_data)$/, `${stock.ticker} selection status`);
    assert.equal(typeof stock.reverse_annual_eligible, "boolean", `${stock.ticker} annual eligibility`);
    assert.match(String(stock.reverse_main_god), /^[甲乙丙丁戊己庚辛壬癸]$/, `${stock.ticker} selected main god`);
    assert.equal(typeof stock.reverse_replacement_applied, "boolean", `${stock.ticker} replacement marker`);
    assert.equal(typeof stock.reverse_qualified_candidate_count, "number", `${stock.ticker} qualified count`);
    if (stock.reverse_fit_score !== null) {
      assert.equal(stock.reverse_fit_score, stock.reverse_annual_hit_rate_excluding_neutral, `${stock.ticker} fit score must be ordinary annual hit rate`);
    }
    if (stock.reverse_annual_explicit_predictions > 0) {
      assert.ok(Math.abs(stock.reverse_annual_hit_rate_excluding_neutral - stock.reverse_annual_hits / stock.reverse_annual_explicit_predictions) < 1e-6, `${stock.ticker} ordinary annual hit rate`);
    }
    if (stock.reverse_annual_directional_samples > 0) {
      assert.ok(Math.abs(stock.reverse_annual_direction_coverage - stock.reverse_annual_explicit_predictions / stock.reverse_annual_directional_samples) < 1e-6, `${stock.ticker} selected coverage`);
      assert.ok(Math.abs(stock.algorithm_annual_direction_coverage - stock.algorithm_annual_explicit_predictions / stock.reverse_annual_directional_samples) < 1e-6, `${stock.ticker} algorithm coverage`);
    }
    if (stock.reverse_sample_status === "sufficient") {
      sufficient += 1;
      assert.equal(stock.reverse_annual_eligible, true, `${stock.ticker} sufficient fit must be annual-eligible`);
      assert.equal(typeof stock.reverse_fit_score, "number", `${stock.ticker} reverse fit score`);
      assert.equal(typeof stock.reverse_annual_full_balanced_accuracy, "number", `${stock.ticker} annual full BA`);
      assert.equal(typeof stock.reverse_main_god_matches_algorithm, "boolean", `${stock.ticker} algorithm comparison`);
      if (stock.reverse_replacement_applied) {
        replacements += 1;
        assert.equal(stock.reverse_selection_status, "replaced", `${stock.ticker} replacement status`);
        assert.notEqual(stock.reverse_main_god, stock.main_god, `${stock.ticker} replacement must change the god`);
        assert.ok(stock.reverse_qualified_candidate_count > 0, `${stock.ticker} must have a qualified candidate`);
        assert.ok(stock.reverse_annual_hit_rate_excluding_neutral > stock.algorithm_annual_hit_rate_excluding_neutral, `${stock.ticker} ordinary hit rate must strictly improve`);
        assert.ok(stock.reverse_annual_full_accuracy + 1e-6 >= stock.algorithm_annual_full_accuracy, `${stock.ticker} full accuracy must not fall`);
        assert.ok(stock.reverse_annual_direction_coverage + 1e-6 >= stock.algorithm_annual_direction_coverage, `${stock.ticker} coverage must not fall`);
      } else {
        assert.equal(stock.reverse_selection_status, "retained_no_qualified_candidate", `${stock.ticker} qualified fallback status`);
        assert.equal(stock.reverse_main_god, stock.main_god, `${stock.ticker} must retain original god`);
        assert.equal(stock.reverse_qualified_candidate_count, 0, `${stock.ticker} fallback must have no qualified candidate`);
      }
    } else {
      unavailable += 1;
      assert.equal(stock.reverse_replacement_applied, false, `${stock.ticker} insufficient data cannot replace`);
      assert.equal(stock.reverse_main_god, stock.main_god, `${stock.ticker} insufficient data retains original god`);
      assert.equal(stock.reverse_selection_status, stock.reverse_sample_status === "no_data" ? "retained_no_data" : "retained_insufficient_samples", `${stock.ticker} insufficient/no-data status`);
    }
  }
  assert.equal(sufficient, 461);
  assert.equal(replacements, 329);
  assert.ok(unavailable > 0, "dataset should retain an explicit insufficient/no-data population");
  assert.equal(summary.reverse_main_god_fit.replacement_count, 329);
  assert.equal(summary.reverse_main_god_fit.retained_count, 189);

  assert.deepEqual(
    [cost.main_god, cost.reverse_main_god, cost.reverse_second_main_god],
    ["壬", "己", "庚"],
  );
  assert.deepEqual(
    [cost.algorithm_annual_hit_rate_excluding_neutral, cost.reverse_annual_hit_rate_excluding_neutral],
    [0.466667, 0.933333],
  );
  assert.deepEqual(
    [cost.algorithm_annual_full_accuracy, cost.reverse_annual_full_accuracy],
    [0.259259, 0.518519],
  );
  assert.deepEqual(
    [cost.algorithm_annual_direction_coverage, cost.reverse_annual_direction_coverage],
    [0.555556, 0.555556],
  );
  const rejectedCostJia = cost.reverse_candidate_ranking.find((candidate) => candidate.main_god === "甲");
  assert.equal(rejectedCostJia.passes_improvement_gate, false);
  assert.equal(rejectedCostJia.passes_ordinary_hit_rate_gate, false);
  assert.equal(rejectedCostJia.passes_full_accuracy_gate, false);
  assert.deepEqual(
    [meta.main_god, meta.reverse_main_god, meta.reverse_second_main_god],
    ["癸", "丁", "己"],
  );

  const algorithmColumn = pageSource.indexOf("原主用神<small>命理算法选定 · 年运普通命中</small>");
  const reverseColumn = pageSource.indexOf("改进筛选结果<small>三门槛通过才替换 · full BA仅诊断/破平</small>");
  const annualColumn = pageSource.indexOf("<th>原主用神年运普通命中<br />（排除中性）</th>");
  assert.ok(algorithmColumn >= 0 && algorithmColumn < reverseColumn && reverseColumn < annualColumn, "main-god comparison columns must stay adjacent");
  assert.match(pageSource, /原主用神 · 命理算法/);
  assert.match(pageSource, /普通年运命中率必须严格高于原主用神/);
  assert.match(pageSource, /全样本准确率不得下降/);
  assert.match(pageSource, /方向覆盖率不得下降/);
  assert.match(pageSource, /无候选全部通过时，明确保留原主用神/);
  assert.match(pageSource, /样本不足/);
  assert.match(pageSource, /reverse_second_main_god/);
  assert.match(pageSource, /reverse_fit_margin/);
  assert.match(pageSource, /algorithm_annual_full_balanced_accuracy/);
  assert.match(pageSource, /reverse_annual_hit_rate_excluding_neutral/);
  assert.match(pageSource, /algorithm_annual_hit_rate_excluding_neutral/);
  assert.match(pageSource, /reverse_annual_direction_coverage/);
  assert.match(pageSource, /algorithm_annual_direction_coverage/);
  assert.match(pageSource, /数据泄漏与过拟合警示/);
  assert.match(pageSource, /不是预测结果/);
  assert.match(pageSource, /full BA（full balanced accuracy）/);
  assert.match(pageSource, /只作平衡性诊断与同分破平/);
  assert.match(pageSource, /月运不参与/);
  assert.match(pageSource, /完整年样本 N≥8，且实际上涨、下跌各≥3/);
  assert.match(pageSource, /<option value="reverse_fit">改进结果年运普通命中率↓<\/option>/);
  assert.match(pageSource, /未找到同时通过三项门槛的改进候选/);
  assert.match(styles, /\.sample-table-panel table, \.full-table table \{ min-width: 1740px; \}/);
  assert.match(styles, /\.reverse-god-chip/);
  assert.match(styles, /\.method-leakage-warning/);
});
