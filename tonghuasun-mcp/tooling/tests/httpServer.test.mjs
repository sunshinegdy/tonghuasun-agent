import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMarketHttpServer } from "../dist/httpServer.js";

test("本机 REST 鉴权及 MCP 工具/资源发现", async () => {
  const market = {
    securityDirectoryRefreshedAtUtc: "2026-08-25T00:00:00Z",
    search: async () => [],
    snapshot: async () => [],
    candles: async () => ({
      security: { market: "SH", code: "600519", fullCode: "600519.SH", name: "贵州茅台", type: "stock", currency: "CNY" },
      period: "1d", adjustment: "forward", bars: [{ timestampUtc: "2026-08-25T07:00:00Z", label: "2026-08-25", open: 1, high: 2, low: 1, close: 2, volume: 1, amount: 2 }],
      pointCount: 1, source: "ifind", fetchedAtUtc: "2026-08-25T08:00:00Z",
    }),
  };
  const server = createMarketHttpServer({ market, localAccessToken: "local-token", widgetPath: new URL("../src/ui/candleChart.html", import.meta.url).pathname, hasRefreshToken: () => true });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/catalog`)).status, 401);
    assert.equal((await fetch(`${base}/catalog`, { headers: { "X-Tonghuasun-Codex-Token": "local-token" } })).status, 200);

    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { "X-Tonghuasun-Codex-Token": "local-token" } },
    }));
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(tool => tool.name), [
      "ths_search_securities", "ths_quote_snapshot", "ths_quote_candles", "ths_chart_candle_data",
    ]);
    const resources = await client.listResources();
    assert.equal(resources.resources[0].uri, "ui://tonghuasun-agent/candle-chart-v1.html");
    await client.close();
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
