import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SecurityResolver } from "../dist/securityResolver.js";

test("证券目录不可用时中文股票名回退到官方智能选股", async () => {
  const root = mkdtempSync(join(tmpdir(), "ths-security-fallback-"));
  try {
    const resolver = new SecurityResolver({
      allAStockDirectory: async () => { throw new Error("report unavailable"); },
      searchStocks: async () => ({ errorcode: 0, tables: [{ table: { thscode: ["600519.SH"], security_name: ["贵州茅台"] } }] }),
      searchFunds: async () => ({ errorcode: 0, tables: [] }),
    }, join(root, "master.json"), () => Date.parse("2026-08-25T01:00:00Z"));
    assert.equal((await resolver.resolve("贵州茅台")).fullCode, "600519.SH");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
