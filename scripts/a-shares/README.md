# A 股冻结模型计算

页面入口：`/fortune-market-backtest-1999/a-shares/`。

本目录保存 A 股计算器及独立结果校验器。评分、行运加权、历史逆推筛选和命中率计算与原美股主页面相同；模型权重没有根据 A 股结果调优。

输入为已准备好的本地目录：`model_input.json`（逐股起盘与行运表）、`calendar.json`（1990—2035上海节气边界）、`coverage.json`、`summary.json` 和 `prices/*.json.gz`（未中间取整的乘法复权日线）。原始约 3GB 行情留在本地，网站发布全量计算结果。

```sh
ASHARE_INPUT_DIR=/absolute/path/to/a_share_fortune_inputs node scripts/a-shares/build_web_data.mjs
python3 scripts/a-shares/validate_results.py public/data/a-shares --origins public/data/a-shares/listing_origins.json.gz
npm run check:pages
npm run build:pages
```

历史与未来分开保存在每只股票的 `annual/monthly` 和 `forecasts`。未来信号仅用冻结原主用神；历史改进主用神属于样本内拟合。原美股兼容字段 `time_et/start_et/end_et` 在 A 股分区表示 `Asia/Shanghai` 当地民用时间，非美东时间。

网页数据位于 `public/data/a-shares`，每只股票一个 gzip JSON，并有十个年度的全市场未来信号文件。完整性和独立复算结果见该目录的校验文件。
