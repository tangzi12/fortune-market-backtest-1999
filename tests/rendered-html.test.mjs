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
    [5, 2, 3, 0],
  );
  assert.deepEqual(
    [ddog.annual_complete_periods, ddog.annual_samples, ddog.annual_neutral_periods, ddog.annual_hits],
    [6, 1, 5, 0],
  );
  assert.match(styles, /--bg:\s*#f8f9fb/);
  assert.match(styles, /--panel:\s*#ffffff/);
  assert.match(layout, /images:\s*\[\{ url: "\/og\.png", width: 1200, height: 630/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await access(new URL("../public/og.png", import.meta.url));
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await access(projectRoot);
});
