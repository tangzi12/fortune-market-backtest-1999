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
