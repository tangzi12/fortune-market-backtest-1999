# 年运历史回测

这是一个把固定命理规则与真实复权年 K、节气月 K 对照的研究网页。股票池覆盖当前 S&P 500、Nasdaq-100、以 iShares IWM 当前可交易股票持仓作为代理的 Russell 2000 股票，以及独立大麻板块联合池。

线上版本：

- GitHub Pages: <https://tangzi12.github.io/fortune-market-backtest-1999/>
- Sites: <https://fortune-market-backtest-1999.zixiangtang89.chatgpt.site>

## 数据口径

- 行情区间：1999-01-01 至 2026-07-10；未结束的 2026 年运不进入完整样本命中率。
- 大盘股票池：2026-07-17 的 S&P 500 与 Nasdaq-100 当前成分。
- Russell 2000 代理：[iShares IWM 官方最新持仓 CSV](https://www.ishares.com/us/products/239710/ishares-russell-2000-etf/latest-holdings.csv)，快照日期 2026-07-17；仓库同时保存[冻结快照](public/data/sources/iwm_holdings_2026-07-17.csv)。
- IWM 只保留股票型、有效代码、NASDAQ/NYSE/NYSE American、价格大于零，并经 Nasdaq Trader 当前上市目录确认的唯一持仓；没有正常交易行情的 CVR、退市残余及已知会制造虚假 K 线方向的价格异常不计算。
- IWM 是当前持仓代理，不是 FTSE Russell 授权的正式成分文件。使用当前股票回看历史会产生幸存者偏差与前视选择偏差。
- 新增 Russell 代理股票的上市日期来自 Yahoo `firstTradeDate`，上市时刻采用当日常规开盘，统一标记为低置信度“行情起点代理”。
- 大麻板块使用独立 `theme_membership` 标签；个股原有 S&P 500、Nasdaq-100 或 Russell 2000 标签保留，不用主题标签覆盖指数归属。
- 大麻联合池冻结于 2026-07-21，共 49 只（43 只股票、6 只 ETF，其中 20 只 OTC）。它使用 MSOS、YOLO、MJ、CNBS 的当前非零底层敞口，再补充仍挂牌、以大麻/CBD/专门大麻金融为核心业务的证券；标准化清单见 [`public/data/sources/cannabis_universe_2026-07-21.json`](public/data/sources/cannabis_universe_2026-07-21.json)。
- OTC 证券保留并单独标记；`CWEB→CWBHF`、`LOVE→LOVFF`、`GLASF→GLAS`、`TCNNF→TRLV` 已规范化，避免撞码或重复。已转为电信资产的 AKAN 和数字资产财库的 GNLN 不再标记为当前大麻股；现金、国债、重复掉期腿、零值遗留和无 Yahoo 日 K 的证券也不进入回测，排除原因全部保留在清单。
- 命理起盘日与可信 K 线起点分开：经核实的空壳、RTO 或 de-SPAC 证券以当前经营主体首日/身份重置日起盘，换码转板不重置八字。GRUSF 和 INCR 的旧壳/漏记资本合并历史已从方向回测中截断；完整策略见 [`public/data/sources/cannabis_price_quality_policy_2026-07-22.json`](public/data/sources/cannabis_price_quality_policy_2026-07-22.json)。RYM 与 AYRWF 的已核实极端涨跌作为真实行情保留，个股页显示风险提示。

## 本地运行

要求 Node.js `>=22.13.0`。

```bash
npm install
npm run build:v2
npm run dev
npm test
npm run build:pages
```

网页读取 `public/data/index.json`、`public/data/summary.json` 和按需解压的 `public/data/stocks/*.json.gz`。gzip 只降低静态传输与部署体积，不删减任何年运、月运或 K 线字段。GitHub Pages 静态构建输出到 `dist-pages/`；Sites 构建输出到 `dist/`。

## 独立 V2 幅度回测

V0 年运方向页保持原样；新入口 `/v2-magnitude/` 使用隔离的数据目录
`public/data/v2-magnitude/`。当前可执行版本是明确标注的
`sequence-proxy fallback`：以同股跨年幅度排序、滚动 12 个月 MFE 和中性年份强制择向为
目标，按年份做扩展窗口时间外回测。它尚未使用未冻结的完整
`node_state + typed_event_state`，因此不能标作完整 V2。

重新生成数据：

```bash
python3 scripts/build_v2_magnitude_backtest.py
```

脚本只写入 `public/data/v2-magnitude/`，不会改写 V0 数据。页面同时展示永久看涨基准、
同股排序、倍数事件捕获、时间切片和防泄漏说明；结果不优于基准时也按原值显示。

## 191只一年十倍股 M0 全表

独立入口 `/tenbagger-m0/` 逐只列出冻结的191个“一年十倍”事件。页面不会只保留可计算
或命中的股票：47只正式合格样本的看涨、中性、看跌结果，以及64只缺年运数据和80只
历史资格不足的原因都原样披露。这里的十倍标签是事后严格低点至未来365日盘中高点，
并不等于立春年收盘涨十倍。

从研究产物重新生成浏览器数据：

```bash
python3 scripts/build_tenbagger_m0_page_data.py
```

脚本只写入 `public/data/tenbagger-m0/`，并移除源文件中的本机绝对路径。正式M0预测只使用
事件所属立春年之前的完整年K；页面中的实际年K和同股排名仅用于事后核对。

## 191只股票主用神重跑

独立入口 `/tenbagger-main-god/` 按 S&P 500 页面相同的主用神规则与替换门槛，对全部
191只股票重新计算年运。先使用“日干 × 月令”算出的算法主神；只有候选主神至少有
8个完整年度、实际上涨和下跌各不少于3年，且排除中性的普通命中率严格提高，同时
full BA、方向覆盖率均不降低时，才允许替换。

页面把两种结果明确分开：

- “全历史逆推”复刻原 S&P 500 格式，属于样本内解释，不能作为事件发生前的预测成绩；
- “事件前逆推”只使用十倍事件所属年以前已经完成的年K，才是无未来信息的因果口径。

重新生成输入、运行独立回测并生成网页数据：

```bash
python3 scripts/build_tenbagger_main_god_input.py
FORTUNE_OUTPUT_DIR=tmp/tenbagger_main_god/web-data \
FORTUNE_QUERY_START=1970-01-01 \
FORTUNE_CUTOFF_DATE=2026-07-10 \
FORTUNE_SKIP_REGRESSION_CHECKS=1 \
node ../../research/build_fortune_backtest_web_data.mjs
python3 scripts/build_tenbagger_main_god_page_data.py
```

191只股票均有独立行情载荷；其中177只具有完整的十倍事件所属立春年K，可进入当年方向
核对。上市身份仍有28只使用已核验候选日期、163只使用现存研究代理，因此页面逐只披露
身份来源与置信度。

## 研究边界

页面中的“历史 K 线改进主用神”在同一批历史年 K 上选择并报告结果，属于样本内拟合，存在数据泄漏与多重比较偏差。它不是独立预测成绩，也不构成投资建议或收益承诺。
