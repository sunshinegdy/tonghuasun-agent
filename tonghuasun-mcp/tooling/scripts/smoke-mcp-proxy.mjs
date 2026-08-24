import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const proxyArgument = process.argv[2];
if (!proxyArgument) {
  console.error("用法：node scripts/smoke-mcp-proxy.mjs <MCP 代理路径>");
  process.exit(2);
}

const proxyPath = resolve(proxyArgument);
const client = new Client({ name: "tonghuasun-package-smoke", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [proxyPath],
  cwd: dirname(dirname(proxyPath)),
  stderr: "pipe",
});

try {
  await client.connect(transport);
  const result = await client.listTools();
  const toolNames = result.tools.map((tool) => tool.name).sort();
  if (toolNames.length === 0) {
    throw new Error("MCP 代理没有返回任何工具。");
  }
  console.log(JSON.stringify({
    toolCount: toolNames.length,
    hasStockBrief: toolNames.includes("ths_stock_brief"),
  }));
} finally {
  await client.close();
}
