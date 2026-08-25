import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  StreamableHTTPServerTransport,
  type StreamableHTTPServerTransportOptions,
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { LOCAL_TOKEN_HEADER } from "./config.js";
import { asServiceError, ServiceError } from "./errors.js";
import type { MarketService } from "./marketService.js";
import { createMarketMcpServer } from "./mcpServer.js";
import { SECURITY_TYPES, VERSION, type ApiEnvelope, type CandlePeriod, type Adjustment, type SecurityType } from "./types.js";

export type MarketHttpServerOptions = {
  market: MarketService;
  localAccessToken: string;
  widgetPath: string;
  hasRefreshToken: () => boolean;
};

export function createMarketHttpServer(options: MarketHttpServerOptions): Server {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/health" && request.method === "GET") {
        return sendJson(response, 200, success({
          status: "ok",
          version: VERSION,
          provider: "ifind",
          refreshTokenConfigured: options.hasRefreshToken(),
          securityDirectoryRefreshedAtUtc: options.market.securityDirectoryRefreshedAtUtc,
        }));
      }
      requireLocalToken(request, options.localAccessToken);
      if (url.pathname === "/mcp") {
        if (request.method !== "POST") {
          return sendJson(response, 405, {
            jsonrpc: "2.0",
            error: { code: -32000, message: "Method not allowed." },
            id: null,
          });
        }
        return handleMcp(request, response, options);
      }
      if (request.method === "GET" && url.pathname === "/catalog") {
        return sendJson(response, 200, success({
          provider: "ifind",
          tools: ["ths_search_securities", "ths_quote_snapshot", "ths_quote_candles", "ths_chart_candle_data"],
          securityTypes: SECURITY_TYPES,
          periods: ["1m", "5m", "15m", "30m", "60m", "1d", "1w", "1mo"],
          adjustments: ["forward", "none", "backward"],
        }));
      }
      if (request.method === "POST" && url.pathname === "/api/v2/securities/search") {
        const body = await readJsonBody(request);
        const query = stringField(body, "query");
        const types = arrayField(body, "types") as SecurityType[] | undefined;
        const limit = optionalInteger(body, "limit") ?? 10;
        const items = await options.market.search(query, types, limit);
        return sendJson(response, 200, success({ items, totalCount: items.length }));
      }
      if (request.method === "POST" && url.pathname === "/api/v2/quotes/snapshot") {
        const body = await readJsonBody(request);
        const securities = body.securities ?? body.codes;
        if (typeof securities !== "string" && !Array.isArray(securities)) {
          throw new ServiceError("invalid_request", "securities 必须是证券字符串或数组。", 400);
        }
        const items = await options.market.snapshot(securities as string | string[]);
        return sendJson(response, 200, success({ items, totalCount: items.length, source: "ifind" }));
      }
      if (request.method === "POST" && url.pathname === "/api/v2/quotes/candle") {
        const body = await readJsonBody(request);
        const security = stringField(body, "security");
        const series = await options.market.candles(security, {
          period: optionalString(body, "period") as CandlePeriod | undefined,
          adjustment: optionalString(body, "adjustment") as Adjustment | undefined,
          start: optionalString(body, "start"),
          end: optionalString(body, "end"),
          limit: optionalInteger(body, "limit"),
        });
        return sendJson(response, 200, success(series));
      }
      return sendJson(response, 404, failure(new ServiceError("invalid_request", "接口不存在。", 404)));
    } catch (error) {
      const mapped = asServiceError(error);
      return sendJson(response, mapped.status, failure(mapped));
    }
  });
}

async function handleMcp(request: IncomingMessage, response: ServerResponse, options: MarketHttpServerOptions): Promise<void> {
  const mcp = createMarketMcpServer(options.market, options.widgetPath);
  // SDK 1.28 与 exactOptionalPropertyTypes 的声明存在已知偏差；运行时明确使用无会话模式。
  const transport = new StreamableHTTPServerTransport(
    { sessionIdGenerator: undefined } as unknown as StreamableHTTPServerTransportOptions,
  );
  try {
    await mcp.connect(transport as Parameters<typeof mcp.connect>[0]);
    await transport.handleRequest(request, response);
  } catch (error) {
    if (!response.headersSent) {
      sendJson(response, 500, {
        jsonrpc: "2.0",
        error: { code: -32603, message: asServiceError(error).message },
        id: null,
      });
    }
  } finally {
    await Promise.allSettled([transport.close(), mcp.close()]);
  }
}

function requireLocalToken(request: IncomingMessage, expected: string): void {
  const provided = request.headers[LOCAL_TOKEN_HEADER.toLowerCase()];
  const value = Array.isArray(provided) ? provided[0] : provided;
  if (!value || !safeEqual(value, expected)) {
    throw new ServiceError("permission_denied", "本机访问令牌无效。", 401);
  }
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 1_048_576) throw new ServiceError("invalid_request", "请求体不能超过 1 MiB。", 413);
    chunks.push(buffer);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new ServiceError("invalid_request", "请求体必须是 JSON 对象。", 400);
  }
}

function success<T>(data: T): ApiEnvelope<T> {
  return { ok: true, traceId: randomUUID(), data };
}

function failure(error: ServiceError): ApiEnvelope<never> {
  return {
    ok: false,
    traceId: randomUUID(),
    error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) },
  };
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  if (response.writableEnded) return;
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new ServiceError("invalid_request", `${key} 必须是非空字符串。`, 400);
  }
  return value;
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new ServiceError("invalid_request", `${key} 必须是字符串。`, 400);
  return value;
}

function optionalInteger(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value)) throw new ServiceError("invalid_request", `${key} 必须是整数。`, 400);
  return value as number;
}

function arrayField(body: Record<string, unknown>, key: string): string[] | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
    throw new ServiceError("invalid_request", `${key} 必须是字符串数组。`, 400);
  }
  return value as string[];
}
