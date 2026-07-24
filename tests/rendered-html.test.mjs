import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { gunzipSync } from "node:zlib";

const projectRoot = new URL("../", import.meta.url);

async function readMaybeGzipText(url) {
  const payload = await readFile(url);
  return url.pathname.endsWith(".gz")
    ? gunzipSync(payload).toString("utf8")
    : payload.toString("utf8");
}

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
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

test("serves an independent V2 magnitude route without replacing V0", async () => {
  const [response, rootResponse] = await Promise.all([render("/v2-magnitude"), render("/")]);
  assert.equal(response.status, 200);
  assert.equal(rootResponse.status, 200);
  const [html, rootHtml] = await Promise.all([response.text(), rootResponse.text()]);
  assert.match(html, /正在装载 V2 时间外回测/);
  assert.match(rootHtml, /年运历史回测 · 命理信号 × 真实K线/);
  const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(pageSource, /href="v2-magnitude\/">V2 幅度回测/);
  const staticV2Html = await readFile(new URL("../github-pages/v2-magnitude/index.html", import.meta.url), "utf8");
  assert.match(staticV2Html, /V2 幅度回测 · 同股跨年排序与12个月MFE/);
  await access(new URL("../github-pages/v2-magnitude/main.tsx", import.meta.url));
});

test("serves the complete frozen 191-event M0 prediction ledger", async () => {
  const [response, rootResponse, dataText, pageSource, staticHtml] = await Promise.all([
    render("/tenbagger-m0"),
    render("/"),
    readFile(new URL("../public/data/tenbagger-m0/index.json", import.meta.url), "utf8"),
    readFile(new URL("../app/tenbagger-m0/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../github-pages/tenbagger-m0/index.html", import.meta.url), "utf8"),
  ]);
  assert.equal(response.status, 200);
  assert.equal(rootResponse.status, 200);
  const [html, rootHtml] = await Promise.all([response.text(), rootResponse.text()]);
  assert.match(html, /正在装载191只十倍股预测/);
  assert.match(rootHtml, /十倍股 191/);
  assert.match(staticHtml, /191只一年十倍股 · M0年度预测全表/);
  assert.match(pageSource, /缺少股票年运数据/);
  assert.match(pageSource, /完整历史不足 8 年/);
  assert.match(pageSource, /new URL\(relativePath, document\.baseURI\)/);
  await access(new URL("../github-pages/tenbagger-m0/main.tsx", import.meta.url));

  const data = JSON.parse(dataText);
  assert.equal(data.schema_version, "tenbagger-m0-web-1.0.0");
  assert.equal(data.events.length, 191);
  assert.equal(new Set(data.events.map((row) => row.symbol)).size, 191);
  assert.equal(data.scope.payload_matched_events, 127);
  assert.equal(data.scope.m0_eligible_events, 47);
  assert.equal(data.results.prediction_up, 12);
  assert.equal(data.results.prediction_neutral, 21);
  assert.equal(data.results.prediction_down, 14);
  assert.equal(data.events.filter((row) => row.m0_eligible).length, 47);
  assert.equal(data.events.filter((row) => row.m0_eligible && row.m0_prediction_label === "up").length, 12);
  assert.equal(data.events.filter((row) => row.m0_eligible && row.m0_prediction_label === "neutral").length, 21);
  assert.equal(data.events.filter((row) => row.m0_eligible && row.m0_prediction_label === "down").length, 14);
  assert.equal(data.events.filter((row) => !row.m0_eligible && row.m0_prediction_label !== null).length, 0);
  assert.equal(data.events.filter((row) => row.history_status === "missing_stock_annual_payload").length, 64);
  assert.equal(data.events.filter((row) => row.annual_actual_complete === true).length, 122);
  assert.ok(data.events.every((row) => row.market_category && row.industry_element));
  assert.ok(!data.source_freeze.source_path);
});

test("publishes an auditable V2-alpha rolling magnitude backtest in an isolated data namespace", async () => {
  const [summaryText, indexText, schemaText, v0SummaryText, v0IndexText, source] = await Promise.all([
    readFile(new URL("../public/data/v2-magnitude/summary.json", import.meta.url), "utf8"),
    readFile(new URL("../public/data/v2-magnitude/index.json", import.meta.url), "utf8"),
    readFile(new URL("../public/data/v2-magnitude/feature-schema.json", import.meta.url), "utf8"),
    readFile(new URL("../public/data/summary.json", import.meta.url), "utf8"),
    readFile(new URL("../public/data/index.json", import.meta.url), "utf8"),
    readFile(new URL("../scripts/build_v2_magnitude_backtest.py", import.meta.url), "utf8"),
  ]);
  const summary = JSON.parse(summaryText);
  const index = JSON.parse(indexText);
  const schema = JSON.parse(schemaText);
  const v0Summary = JSON.parse(v0SummaryText);
  const v0Index = JSON.parse(v0IndexText);

  assert.equal(summary.model_status, "experimental_sequence_proxy_fallback");
  assert.equal(summary.full_v2_typed_state_available, false);
  assert.equal(summary.training_eligible_as_full_v2, false);
  assert.ok(summary.scope.strict_oos_rows > 30000);
  assert.ok(summary.scope.strict_oos_stocks > 2400);
  assert.equal(summary.evaluation.scored_rows, summary.scope.strict_oos_rows);
  assert.equal(summary.evaluation.direction.samples, summary.scope.strict_oos_rows);
  assert.equal(index.stock_count, summary.scope.strict_oos_stocks);
  assert.equal(index.stocks.length, index.stock_count);
  assert.equal(schema.feature_count, summary.scope.feature_count);
  assert.ok(schema.features.length > 100);

  for (const fold of summary.evaluation.folds) {
    assert.ok(fold.train_year_max < fold.test_year, JSON.stringify(fold));
  }
  assert.match(summary.training_protocol.main_god_source, /不使用K线逆推主用神/);
  assert.equal(summary.training_protocol.price_features_used, false);
  assert.match(source, /DEFAULT_OUTPUT\s*=.*"v2-magnitude"/);
  assert.doesNotMatch(source, /reverse_main_god|reverse_fit_score/);

  for (const ticker of ["AAPL", "META", "MSFT", "NVDA"]) {
    const stock = index.stocks.find((row) => row.ticker === ticker);
    assert.ok(stock, ticker);
    const payload = JSON.parse(await readMaybeGzipText(new URL(`../public/data/v2-magnitude/${stock.payload}`, import.meta.url)));
    assert.equal(payload.stock.ticker, ticker);
    assert.ok(payload.periods.length > 0);
    for (const period of payload.periods.filter((row) => row.v2_magnitude)) {
      assert.ok(period.v2_magnitude.trained_through_year < period.year, `${ticker} ${period.year}`);
    }
  }

  assert.equal(v0Index.stock_count, 2519);
  assert.equal(v0Summary.coverage.stock_count_with_prices, 2519);
  assert.ok(!("v2_magnitude" in v0Summary), "V0 summary must not be overwritten by V2");
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

  assert.equal(summary.coverage.stock_count_with_prices, stockIndex.stock_count);
  assert.equal(summary.coverage.stock_count_requested, summary.coverage.stock_count_with_prices);
  assert.equal(stockIndex.stocks.length, stockIndex.stock_count);
  assert.ok(stockIndex.stock_count > 2400, "expanded union should contain the Russell proxy universe");
  assert.equal(summary.universe.russell2000_proxy_count, 1954);
  assert.equal(summary.universe.russell2000_proxy_count, summary.coverage.index_counts["Russell 2000"]);
  assert.equal(summary.universe.holdings_date, "2026-07-17");
  assert.ok(stockIndex.stocks.some((stock) => stock.index_membership.includes("Russell 2000")));
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
  assert.match(layout, /大麻板块联合池/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await access(new URL("../public/og.png", import.meta.url));
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await access(projectRoot);
});

test("publishes the audited cannabis theme pool without overwriting index identity", async () => {
  const [summaryText, indexText, manifestText, policyText, grusfText, incrText] = await Promise.all([
    readFile(new URL("../public/data/summary.json", import.meta.url), "utf8"),
    readFile(new URL("../public/data/index.json", import.meta.url), "utf8"),
    readFile(new URL("../public/data/sources/cannabis_universe_2026-07-21.json", import.meta.url), "utf8"),
    readFile(new URL("../public/data/sources/cannabis_price_quality_policy_2026-07-22.json", import.meta.url), "utf8"),
    readMaybeGzipText(new URL("../public/data/stocks/GRUSF.json.gz", import.meta.url)),
    readMaybeGzipText(new URL("../public/data/stocks/INCR.json.gz", import.meta.url)),
  ]);
  const summary = JSON.parse(summaryText);
  const stockIndex = JSON.parse(indexText);
  const manifest = JSON.parse(manifestText);
  const policy = JSON.parse(policyText);
  const grusf = JSON.parse(grusfText);
  const incr = JSON.parse(incrText);
  const cannabis = stockIndex.stocks.filter((stock) => stock.theme_membership.includes("大麻板块"));
  const byTicker = new Map(stockIndex.stocks.map((stock) => [stock.ticker, stock]));

  assert.equal(stockIndex.stock_count, 2519);
  assert.equal(cannabis.length, 49);
  assert.equal(cannabis.filter((stock) => stock.security_type === "stock").length, 43);
  assert.equal(cannabis.filter((stock) => stock.security_type === "etf").length, 6);
  assert.equal(cannabis.filter((stock) => String(stock.listing_market).startsWith("OTC")).length, 20);
  assert.equal(stockIndex.universe.theme_counts["大麻板块"], 49);
  assert.equal(summary.coverage.theme_counts["大麻板块"], 49);
  assert.equal(summary.universe.cannabis_count, 49);
  assert.equal(summary.universe.cannabis_added_count, 47);
  assert.equal(summary.universe.cannabis_overlap_count, 2);
  assert.equal(summary.universe.cannabis_etf_count, 6);
  assert.equal(summary.universe.cannabis_otc_count, 20);
  assert.equal(manifest.metadata.included_count, 49);

  for (const ticker of ["SNDL", "MSOS", "MJ", "YOLO", "CNBS", "WEED", "MSOX"]) {
    assert.ok(byTicker.get(ticker)?.theme_membership.includes("大麻板块"), `${ticker} theme membership`);
    await access(new URL(`../public/data/stocks/${ticker}.json.gz`, import.meta.url));
  }
  assert.equal(byTicker.get("MSOS").security_type, "etf");
  assert.equal(byTicker.get("SNDL").security_type, "stock");
  for (const ticker of ["IIPR", "REFI"]) {
    assert.match(byTicker.get(ticker).index_membership, /Russell 2000/);
    assert.deepEqual(byTicker.get(ticker).theme_membership, ["大麻板块"]);
  }

  assert.equal(byTicker.get("LOVE").name, "LOVESAC COMPANY");
  assert.deepEqual(byTicker.get("LOVE").theme_membership, []);
  assert.equal(byTicker.get("LOVFF").name, "Cannara Biotech Inc.");
  assert.deepEqual(byTicker.get("LOVFF").theme_membership, ["大麻板块"]);
  for (const ticker of ["CWBHF", "LOVFF", "GLAS", "TRLV"]) {
    assert.ok(byTicker.get(ticker)?.theme_membership.includes("大麻板块"), `${ticker} normalized ticker`);
  }
  for (const oldTicker of ["CWEB", "TCNNF", "GLASF", "AKAN", "GNLN"]) {
    assert.ok(!byTicker.get(oldTicker)?.theme_membership.includes("大麻板块"), `${oldTicker} must not be tagged`);
  }

  assert.equal(summary.universe.cannabis_source_snapshots.length, 6);
  for (const source of summary.universe.cannabis_source_snapshots) {
    assert.match(source.path, /^data\/sources\//);
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    await access(new URL(`../public/${source.path}`, import.meta.url));
  }
  assert.ok(summary.universe.cannabis_source_snapshots.some((source) => source.id === "CANNABIS_PRICE_QUALITY"));
  assert.ok(summary.universe.cannabis_excluded.some((row) => row.ticker === "CBSTF"));
  assert.ok(summary.universe.cannabis_excluded.some((row) => row.ticker === "AKAN"));
  assert.ok(summary.universe.cannabis_excluded.some((row) => row.ticker === "GNLN"));
  assert.equal(policy.ticker_policies.GRUSF.valid_from, "2019-05-14");
  assert.equal(policy.ticker_policies.INCR.valid_from, "2021-09-01");
  assert.equal(grusf.stock.listing_date, "2018-11-26");
  assert.equal(grusf.stock.raw_first_price_date, "2010-10-15");
  assert.equal(grusf.stock.effective_price_start_date, "2019-05-14");
  assert.equal(incr.stock.listing_date, "2019-02-11");
  assert.equal(incr.stock.effective_price_start_date, "2021-09-01");
  for (const detail of [grusf, incr]) {
    assert.ok(detail.annual.some((row) => row.exclusion_reason === "left_censored_by_price_quality_policy"));
    assert.ok(detail.monthly.some((row) => row.exclusion_reason === "left_censored_by_price_quality_policy"));
    assert.ok(detail.annual.filter((row) => row.complete).every((row) => row.period_kline[7] >= detail.stock.price_quality_valid_from));
    assert.ok(detail.monthly.filter((row) => row.complete).every((row) => row.period_kline[7] >= detail.stock.price_quality_valid_from));
  }
  assert.equal(byTicker.get("RYM").price_quality_status, "retained_observed_move");
  assert.equal(byTicker.get("AYRWF").price_quality_status, "retained_observed_move");
  assert.equal(summary.data_quality.price_quality_censored_tickers.length, 2);
});

test("publishes every first-luck start time and keeps the UI terminology aligned", async () => {
  const [indexText, pageSource, summaryText, metaText] = await Promise.all([
    readFile(new URL("../public/data/index.json", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/data/summary.json", import.meta.url), "utf8"),
    readMaybeGzipText(new URL("../public/data/stocks/META.json.gz", import.meta.url)),
  ]);
  const stockIndex = JSON.parse(indexText);
  const summary = JSON.parse(summaryText);
  const meta = JSON.parse(metaText);
  const firstLuckPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

  assert.ok(stockIndex.stocks.length > 2400);
  for (const stock of stockIndex.stocks) {
    assert.match(String(stock.first_luck_start_et ?? ""), firstLuckPattern, `${stock.ticker} index first_luck_start_et`);
    const detail = JSON.parse(await readMaybeGzipText(new URL(`../public/data/${stock.data_path}`, import.meta.url)));
    assert.match(String(detail.stock.first_luck_start_et ?? ""), firstLuckPattern, `${stock.ticker} detail first_luck_start_et`);
    assert.equal(stock.first_luck_start_et, detail.stock.first_luck_start_et, `${stock.ticker} first-luck time must match`);
  }

  const listingColumn = pageSource.indexOf("<th>命理起盘/上市代理 ET</th>");
  const firstLuckColumn = pageSource.indexOf("<th>起运时间 ET</th>");
  const baziColumn = pageSource.indexOf("<th>命理起盘时刻推算八字</th>");
  assert.ok(listingColumn >= 0 && listingColumn < firstLuckColumn && firstLuckColumn < baziColumn, "first-luck column must immediately follow listing time");
  assert.match(pageSource, /<th>命理起盘\/上市代理 ET<\/th><th>起运时间 ET<\/th><th>命理起盘时刻推算八字<\/th>/);
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
    readMaybeGzipText(new URL("../public/data/stocks/COST.json.gz", import.meta.url)),
    readMaybeGzipText(new URL("../public/data/stocks/META.json.gz", import.meta.url)),
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
      if (stock.reverse_sample_status === "no_data") {
        assert.equal(stock.reverse_annual_directional_samples, 0, `${stock.ticker} no-data status requires zero directional samples`);
      }
      assert.equal(stock.reverse_replacement_applied, false, `${stock.ticker} insufficient data cannot replace`);
      assert.equal(stock.reverse_main_god, stock.main_god, `${stock.ticker} insufficient data retains original god`);
      assert.equal(stock.reverse_selection_status, stock.reverse_sample_status === "no_data" ? "retained_no_data" : "retained_insufficient_samples", `${stock.ticker} insufficient/no-data status`);
    }
  }
  assert.ok(sufficient > 461, "expanded universe should add sufficient-sample stocks beyond the 518-stock baseline");
  assert.ok(replacements > 0, "expanded universe should evaluate replacement candidates");
  assert.ok(unavailable > 0, "dataset should retain an explicit insufficient/no-data population");
  assert.equal(sufficient + unavailable, stockIndex.stocks.length);
  assert.equal(summary.reverse_main_god_fit.replacement_count, replacements);
  assert.equal(summary.reverse_main_god_fit.retained_count, stockIndex.stocks.length - replacements);

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
  assert.match(pageSource, /<option value="Russell 2000">Russell 2000（IWM代理）<\/option>/);
  assert.match(pageSource, /<option value="大麻板块">大麻板块<\/option>/);
  assert.match(pageSource, /全部指数 \/ 主题/);
  assert.match(pageSource, /<th>指数 \/ 主题<\/th>/);
  assert.match(pageSource, /theme_membership/);
  assert.match(pageSource, /security_type/);
  assert.match(pageSource, /DecompressionStream/);
  assert.match(pageSource, /大麻板块联合池/);
  assert.match(pageSource, /IWM 可交易股票持仓代理/);
  assert.match(pageSource, /未找到同时通过三项门槛的改进候选/);
  assert.match(styles, /\.sample-table-panel table, \.full-table table \{ min-width: 1740px; \}/);
  assert.match(styles, /\.reverse-god-chip/);
  assert.match(styles, /\.method-leakage-warning/);
});
