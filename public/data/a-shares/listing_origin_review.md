# A 股上市起点复核

- 股票池：5,221 只当前上市的沪深 A 股。
- 上市日期覆盖：5,221 / 5,221。
- 精确首笔成交时刻覆盖：0 / 5,221。
- 时刻口径：Asia/Shanghai 09:30:00 常规开盘代理。
- 日期一致性：5,206 只的上市日等于首个日线日期；15 只需要复核。
- 身份审计：尚未对全市场逐一筛查借壳、吸收合并、前身证券及经营主体重置。

| 代码 | 名称 | 上市日 | 首个行情日 | 上市日－首个行情日（天） | 状态 |
|---|---|---:|---:|---:|---|
| sh.600018 | 上港集团 | 2006-10-26 | 2000-07-19 | 2290 | price_history_precedes_listing |
| sz.000028 | 国药一致 | 1993-08-09 | 1993-06-08 | 62 | price_history_precedes_listing |
| sz.000012 | 南玻A | 1992-02-28 | 1992-01-07 | 52 | price_history_precedes_listing |
| sh.600605 | 汇通能源 | 1992-03-27 | 1992-04-29 | -33 | price_history_starts_after_listing |
| sh.600653 | 申华控股 | 1990-12-19 | 1991-01-08 | -20 | price_history_starts_after_listing |
| sh.600604 | 市北高新 | 1992-03-27 | 1992-04-10 | -14 | price_history_starts_after_listing |
| sh.600606 | 绿地控股 | 1992-03-27 | 1992-04-10 | -14 | price_history_starts_after_listing |
| sz.000514 | 渝开发 | 1993-07-12 | 1993-07-05 | 7 | price_history_precedes_listing |
| sh.600619 | 海立股份 | 1992-11-16 | 1992-11-13 | 3 | price_history_precedes_listing |
| sh.600665 | 天地源 | 1993-07-09 | 1993-07-12 | -3 | price_history_starts_after_listing |
| sh.600651 | 飞乐音响 | 1990-12-19 | 1990-12-21 | -2 | price_history_starts_after_listing |
| sh.600654 | 中安科 | 1990-12-19 | 1990-12-21 | -2 | price_history_starts_after_listing |
| sh.600618 | 氯碱化工 | 1992-11-13 | 1992-11-12 | 1 | price_history_precedes_listing |
| sh.600620 | 天宸股份 | 1992-11-17 | 1992-11-16 | 1 | price_history_precedes_listing |
| sh.600744 | 华银电力 | 1996-09-05 | 1996-09-04 | 1 | price_history_precedes_listing |

回测时保留 `listing_date` 作为起盘日期，并使用 `effective_price_start_date` 作为最早可用行情日。行情早于上市日的记录不得贡献上市前收益。
