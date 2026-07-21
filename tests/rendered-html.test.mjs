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

test("labels K-line reverse-engineered main gods as in-sample fits and publishes the audit fields", async () => {
  const [indexText, pageSource, styles] = await Promise.all([
    readFile(new URL("../public/data/index.json", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const stockIndex = JSON.parse(indexText);
  const requiredFields = [
    "reverse_main_god",
    "reverse_main_god_label",
    "reverse_fit_score",
    "reverse_annual_full_balanced_accuracy",
    "reverse_monthly_full_balanced_accuracy",
    "reverse_annual_eligible",
    "reverse_monthly_eligible",
    "reverse_sample_status",
    "reverse_main_god_matches_algorithm",
  ];

  let sufficient = 0;
  let unavailable = 0;
  for (const stock of stockIndex.stocks) {
    for (const field of requiredFields) assert.ok(Object.hasOwn(stock, field), `${stock.ticker} missing ${field}`);
    assert.equal(stock.reverse_main_god_label, "K线逆推（样本内）", `${stock.ticker} reverse label`);
    assert.match(String(stock.reverse_sample_status), /^(sufficient|insufficient|no_data)$/, `${stock.ticker} reverse status`);
    assert.equal(typeof stock.reverse_annual_eligible, "boolean", `${stock.ticker} annual eligibility`);
    assert.equal(typeof stock.reverse_monthly_eligible, "boolean", `${stock.ticker} monthly eligibility`);
    if (stock.reverse_sample_status === "sufficient") {
      sufficient += 1;
      assert.match(String(stock.reverse_main_god), /^[甲乙丙丁戊己庚辛壬癸]$/, `${stock.ticker} reverse main god`);
      assert.equal(typeof stock.reverse_fit_score, "number", `${stock.ticker} reverse fit score`);
      assert.ok(
        typeof stock.reverse_annual_full_balanced_accuracy === "number" || typeof stock.reverse_monthly_full_balanced_accuracy === "number",
        `${stock.ticker} needs at least one eligible full BA horizon`,
      );
      assert.equal(typeof stock.reverse_main_god_matches_algorithm, "boolean", `${stock.ticker} algorithm comparison`);
    } else {
      unavailable += 1;
    }
  }
  assert.ok(sufficient > 0, "dataset should expose eligible in-sample reverse fits");
  assert.ok(unavailable > 0, "dataset should retain an explicit insufficient/no-data population");

  const algorithmColumn = pageSource.indexOf("算法主用神<small>命理算法 · full BA</small>");
  const reverseColumn = pageSource.indexOf("逆推主用神<small>历史K线 · 样本内 · full BA</small>");
  const annualColumn = pageSource.indexOf("<th>年运方向命中</th>");
  assert.ok(algorithmColumn >= 0 && algorithmColumn < reverseColumn && reverseColumn < annualColumn, "main-god comparison columns must stay adjacent");
  assert.match(pageSource, /算法主用神 · 命理算法/);
  assert.match(pageSource, /根据历史K线逆推 · 样本内/);
  assert.match(pageSource, /样本不足/);
  assert.match(pageSource, /reverse_second_main_god/);
  assert.match(pageSource, /reverse_fit_margin/);
  assert.match(pageSource, /algorithm_fit_score/);
  assert.match(pageSource, /结果不稳定 · 冠亚近似并列/);
  assert.match(pageSource, /数据泄漏与过拟合警示/);
  assert.match(pageSource, /不是预测结果/);
  assert.match(pageSource, /年口径门槛为样本 N≥8、实际上涨\/下跌各≥3/);
  assert.match(pageSource, /月口径门槛为样本 N≥36、实际上涨\/下跌各≥12/);
  assert.match(pageSource, /预测中性也计为未命中/);
  assert.match(pageSource, /综合FBA ≤50%/);
  assert.match(pageSource, /未超过50%恒向基准/);
  assert.match(pageSource, /探索值不作为逆推结果展示/);
  assert.match(pageSource, /近似并列/);
  assert.match(pageSource, /样本不足，不计入/);
  assert.match(pageSource, /冠亚领先差＜2个百分点/);
  assert.match(pageSource, /<option value="reverse_fit">K线逆推拟合分 ↓<\/option>/);
  assert.match(styles, /\.sample-table-panel table, \.full-table table \{ min-width: 1660px; \}/);
  assert.match(styles, /\.reverse-god-chip/);
  assert.match(styles, /\.method-leakage-warning/);
});
