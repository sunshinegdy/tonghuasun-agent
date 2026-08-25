import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { asServiceError } from "./errors.js";
import type { MarketService } from "./marketService.js";
import { ADJUSTMENTS, PERIODS, SECURITY_TYPES, VERSION, type CandleSeries } from "./types.js";

export const CANDLE_UI_URI = "ui://tonghuasun-agent/candle-chart-v1.html";
const UI_MIME_TYPE = "text/html;profile=mcp-app";

export function createMarketMcpServer(market: MarketService, widgetPath: string): McpServer {
  const server = new McpServer(
    { name: "tonghuasun-agent", version: VERSION },
    { capabilities: { tools: {}, resources: {} }, instructions: "仅提供 iFinD 行情、证券搜索和 K 线查询，不提供账户或交易功能。" },
  );

  server.registerResource(
    "tonghuasun-candle-chart",
    CANDLE_UI_URI,
    { title: "同花顺 K 线图", description: "证券 K 线、成交量和移动平均线。", mimeType: UI_MIME_TYPE },
    async () => ({
      contents: [{
        uri: CANDLE_UI_URI,
        mimeType: UI_MIME_TYPE,
        text: readFileSync(widgetPath, "utf8"),
        _meta: { ui: { prefersBorder: true } },
      }],
    }),
  );

  server.registerTool(
    "ths_search_securities",
    {
      title: "搜索证券",
      description: "按代码或中文名称搜索 A 股、主要指数、ETF 和场内基金。名称存在歧义时返回候选项。",
      inputSchema: {
        query: z.string().min(1).describe("证券代码或中文名称"),
        types: z.array(z.enum(SECURITY_TYPES)).optional().describe("可选证券类型过滤"),
        limit: z.number().int().min(1).max(20).default(10),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ query, types, limit }) => handleTool(async () => {
      const items = await market.search(query, types, limit);
      return {
        content: [{
          type: "text" as const,
          text: items.length
            ? items.map(item => `${item.name}（${item.fullCode}，${item.type}）`).join("\n")
            : `没有找到证券：${query}`,
        }],
        structuredContent: { totalCount: items.length, items },
      };
    }),
  );

  server.registerTool(
    "ths_quote_snapshot",
    {
      title: "查询实时行情",
      description: "按需查询最多 50 个证券的最新价、昨收、开高低、涨跌幅、成交量和成交额。",
      inputSchema: {
        securities: z.union([z.string().min(1), z.array(z.string().min(1)).min(1).max(50)]),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ securities }) => handleTool(async () => {
      const items = await market.snapshot(securities);
      return {
        content: [{ type: "text" as const, text: items.map(formatQuote).join("\n") }],
        structuredContent: { totalCount: items.length, items, source: "ifind" },
      };
    }),
  );

  const candleInputSchema = {
    security: z.string().min(1).describe("证券完整代码、纯数字代码或中文名称"),
    period: z.enum(PERIODS).default("1d"),
    adjustment: z.enum(ADJUSTMENTS).default("forward"),
    start: z.string().datetime({ offset: true }).optional(),
    end: z.string().datetime({ offset: true }).optional(),
    limit: z.number().int().min(1).max(5_000).default(160),
  };

  server.registerTool(
    "ths_quote_candles",
    {
      title: "查询并显示 K 线",
      description: "查询分钟或日周月 K 线，并显示可交互 K 线图、成交量和 MA5/10/20。",
      inputSchema: candleInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      _meta: {
        ui: { resourceUri: CANDLE_UI_URI },
        "openai/outputTemplate": CANDLE_UI_URI,
      },
    },
    async (args) => handleTool(async () => candleToolResult(await market.candles(args.security, args), true)),
  );

  server.registerTool(
    "ths_chart_candle_data",
    {
      title: "刷新 K 线图数据",
      description: "供 K 线组件手动刷新或切换周期使用。",
      inputSchema: candleInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => handleTool(async () => candleToolResult(await market.candles(args.security, args), false)),
  );

  return server;
}

async function handleTool<T>(callback: () => Promise<T>): Promise<T | {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
}> {
  try {
    return await callback();
  } catch (error) {
    const mapped = asServiceError(error);
    return {
      isError: true,
      content: [{ type: "text", text: mapped.message }],
      structuredContent: { ok: false, error: { code: mapped.code, message: mapped.message, details: mapped.details } },
    };
  }
}

function candleToolResult(series: CandleSeries, includeWidget: boolean) {
  const chartData = toChartData(series);
  return {
    content: [{
      type: "text" as const,
      text: `${series.security.name}（${series.security.fullCode}）${periodLabel(series.period)}，${series.pointCount} 根，${adjustmentLabel(series.adjustment)}。`,
    }],
    structuredContent: { ...series, chartData },
    ...(includeWidget ? { _meta: { chartData } } : {}),
  };
}

function toChartData(series: CandleSeries) {
  const bars = series.bars.map(bar => ({
    time: Math.floor(Date.parse(bar.timestampUtc) / 1_000),
    label: bar.label,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    amount: bar.amount,
  }));
  const latest = bars.at(-1)!;
  const previous = bars.at(-2);
  const change = previous ? latest.close - previous.close : null;
  const changePercent = previous && previous.close !== 0 ? change! / previous.close * 100 : null;
  return {
    schemaVersion: 1,
    chartType: "candlestick",
    security: series.security,
    period: series.period,
    periodLabel: periodLabel(series.period),
    adjustment: series.adjustment,
    requestedLimit: series.pointCount,
    pointCount: series.pointCount,
    fetchedAtUtc: series.fetchedAtUtc,
    latest: { ...latest, change, changePercent },
    bars,
  };
}

function formatQuote(item: Awaited<ReturnType<MarketService["snapshot"]>>[number]): string {
  const price = item.latest === null ? "—" : item.latest.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  const percent = item.changePercent === null ? "—" : `${item.changePercent >= 0 ? "+" : ""}${item.changePercent.toFixed(2)}%`;
  return `${item.security.name}（${item.security.fullCode}） ${price} ${percent}`;
}

function periodLabel(period: CandleSeries["period"]): string {
  return ({
    "1m": "1 分钟", "5m": "5 分钟", "15m": "15 分钟", "30m": "30 分钟", "60m": "60 分钟",
    "1d": "日 K", "1w": "周 K", "1mo": "月 K",
  })[period];
}

function adjustmentLabel(value: CandleSeries["adjustment"]): string {
  return value === "forward" ? "前复权" : value === "backward" ? "后复权" : "不复权";
}
