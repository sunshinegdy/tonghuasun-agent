import assert from "node:assert/strict";
import test from "node:test";
import { MarketService } from "../dist/marketService.js";

const security = {
  market: "SH", code: "600519", fullCode: "600519.SH", name: "贵州茅台", type: "stock", currency: "CNY",
};

test("标准化实时行情并计算缺失的涨跌值", async () => {
  const service = new MarketService({
    realtimeQuotes: async () => ({
      errorcode: 0,
      tables: [{ thscode: "600519.SH", time: ["2026-08-25 10:00:00"], table: {
        latest: [1420], preClose: [1400], open: [1405], high: [1425], low: [1398], volume: [123], amount: [456],
      } }],
    }),
    historyQuotes: async () => ({}),
    highFrequency: async () => ({}),
  }, {
    refreshedAtUtc: null,
    resolve: async () => security,
    search: async () => [security],
  }, () => Date.parse("2026-08-25T02:00:00Z"));

  const [quote] = await service.snapshot("贵州茅台");
  assert.equal(quote.latest, 1420);
  assert.equal(quote.change, 20);
  assert.equal(Number(quote.changePercent.toFixed(4)), 1.4286);
  assert.equal(quote.timestampUtc, "2026-08-25T02:00:00.000Z");
});

test("映射全部 K 线周期和复权并排序去重裁剪", async () => {
  const calls = [];
  const response = {
    errorcode: 0,
    tables: [{ thscode: "600519.SH", time: ["2026-08-25", "2026-08-24", "2026-08-25"], table: {
      open: [10, 9, 10], high: [12, 11, 12], low: [9, 8, 9], close: [11, 10, 11], volume: [100, 90, 100], amount: [1000, 900, 1000],
    } }],
  };
  const service = new MarketService({
    realtimeQuotes: async () => ({}),
    historyQuotes: async (...args) => { calls.push(["history", ...args]); return response; },
    highFrequency: async (...args) => { calls.push(["minute", ...args]); return response; },
  }, {
    refreshedAtUtc: null,
    resolve: async () => security,
    search: async () => [security],
  }, () => Date.parse("2026-08-25T08:00:00Z"));

  for (const period of ["1m", "5m", "15m", "30m", "60m", "1d", "1w", "1mo"]) {
    const series = await service.candles("600519.SH", {
      period, adjustment: "forward", start: "2026-08-20T00:00:00+08:00", end: "2026-08-25T16:00:00+08:00", limit: 2,
    });
    assert.equal(series.bars.length, 2);
    assert.ok(series.bars[0].timestampUtc < series.bars[1].timestampUtc);
  }
  assert.deepEqual(calls.filter(call => call[0] === "minute").map(call => call[2]), [1, 5, 15, 30, 60]);
  assert.deepEqual(calls.filter(call => call[0] === "history").map(call => call[2]), ["D", "W", "M"]);
  assert.ok(calls.every(call => call[3] === (call[0] === "minute" ? "forward1" : 2)));
});
