import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SecurityResolver } from "../dist/securityResolver.js";

test("支持中文名称、完整代码、主要指数和歧义候选", async () => {
  const root = mkdtempSync(join(tmpdir(), "ths-security-resolver-"));
  try {
    const resolver = new SecurityResolver({
      allAStockDirectory: async () => ({
        errorcode: 0,
        tables: [{ table: {
          thscode: ["600519.SH", "000001.SZ"],
          security_name: ["贵州茅台", "平安银行"],
        } }],
      }),
      searchStocks: async () => ({ errorcode: 0, tables: [] }),
      searchFunds: async () => ({ errorcode: 0, tables: [] }),
    }, join(root, "master.json"), () => Date.parse("2026-08-25T01:00:00Z"));

    assert.equal((await resolver.resolve("贵州茅台")).fullCode, "600519.SH");
    assert.equal((await resolver.resolve("000300.SH")).name, "沪深300");
    await assert.rejects(() => resolver.resolve("000001"), error => {
      assert.equal(error.code, "ambiguous_security");
      assert.equal(error.details.candidates.length, 2);
      return true;
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ETF 名称未命中时使用官方基金搜索并缓存", async () => {
  const root = mkdtempSync(join(tmpdir(), "ths-security-fund-"));
  let fundCalls = 0;
  try {
    const resolver = new SecurityResolver({
      allAStockDirectory: async () => ({ errorcode: 0, tables: [{ table: { thscode: ["600519.SH"], security_name: ["贵州茅台"] } }] }),
      searchStocks: async () => ({ errorcode: 0, tables: [] }),
      searchFunds: async () => {
        fundCalls += 1;
        return { errorcode: 0, tables: [{ table: { thscode: ["510300.SH"], security_name: ["沪深300ETF"] } }] };
      },
    }, join(root, "master.json"), () => Date.parse("2026-08-25T01:00:00Z"));
    assert.equal((await resolver.resolve("沪深300ETF")).fullCode, "510300.SH");
    assert.equal((await resolver.resolve("沪深300ETF")).fullCode, "510300.SH");
    assert.equal(fundCalls, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
