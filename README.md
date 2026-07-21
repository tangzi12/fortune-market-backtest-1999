# 年运历史回测

这是一个把固定命理规则与真实复权年 K、节气月 K 对照的研究网页。股票池覆盖当前 S&P 500、Nasdaq-100，以及以 iShares IWM 当前可交易股票持仓作为代理的 Russell 2000 股票。

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

## 本地运行

要求 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
npm test
npm run build:pages
```

网页读取 `public/data/index.json`、`public/data/summary.json` 和 `public/data/stocks/*.json`。GitHub Pages 静态构建输出到 `dist-pages/`；Sites 构建输出到 `dist/`。

## 研究边界

页面中的“历史 K 线改进主用神”在同一批历史年 K 上选择并报告结果，属于样本内拟合，存在数据泄漏与多重比较偏差。它不是独立预测成绩，也不构成投资建议或收益承诺。
