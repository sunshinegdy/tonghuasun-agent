import { setTimeout as delay } from "node:timers/promises";
import { ServiceError, mapIfindFailure } from "./errors.js";
import { readRefreshToken } from "./keychain.js";

export const IFIND_BASE_URL = "https://quantapi.51ifind.com";

type FetchLike = typeof fetch;
type SleepLike = (milliseconds: number) => Promise<unknown>;

export type IfindClientOptions = {
  fetchImpl?: FetchLike;
  readRefreshToken?: () => string;
  now?: () => number;
  sleep?: SleepLike;
};

export class StartRateLimiter {
  private tail: Promise<void> = Promise.resolve();
  private globalNextAt = 0;
  private readonly endpointNextAt = new Map<string, number>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly sleep: SleepLike = delay,
    private readonly globalIntervalMs = 63,
    private readonly endpointIntervalMs = 125,
  ) {}

  async wait(endpoint: string): Promise<void> {
    const previous = this.tail;
    let release = () => {};
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous.catch(() => {});
    try {
      const current = this.now();
      const waitUntil = Math.max(this.globalNextAt, this.endpointNextAt.get(endpoint) ?? 0);
      if (waitUntil > current) await this.sleep(waitUntil - current);
      const startedAt = this.now();
      this.globalNextAt = startedAt + this.globalIntervalMs;
      this.endpointNextAt.set(endpoint, startedAt + this.endpointIntervalMs);
    } finally {
      release();
    }
  }
}

export class IfindClient {
  private readonly fetchImpl: FetchLike;
  private readonly refreshTokenReader: () => string;
  private readonly now: () => number;
  private readonly limiter: StartRateLimiter;
  private accessToken: { value: string; refreshAfter: number } | null = null;

  constructor(options: IfindClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.refreshTokenReader = options.readRefreshToken ?? readRefreshToken;
    this.now = options.now ?? Date.now;
    this.limiter = new StartRateLimiter(this.now, options.sleep ?? delay);
  }

  async realtimeQuotes(codes: string[]): Promise<unknown> {
    return this.request("/api/v1/real_time_quotation", {
      codes: codes.join(","),
      indicators: "preClose,open,high,low,latest,latestAmount,latestVolume",
    }, 15_000);
  }

  async historyQuotes(
    code: string,
    period: "D" | "W" | "M",
    cps: 1 | 2 | 3,
    startDate: string,
    endDate: string,
  ): Promise<unknown> {
    return this.request("/api/v1/cmd_history_quotation", {
      codes: code,
      indicators: "open,high,low,close,volume,amount",
      startdate: startDate,
      enddate: endDate,
      functionpara: { Interval: period, CPS: cps, Fill: "Omit", Currency: "MHB" },
    }, 30_000);
  }

  async highFrequency(
    code: string,
    interval: 1 | 5 | 15 | 30 | 60,
    cps: "no" | "forward1" | "backward1",
    startTime: string,
    endTime: string,
  ): Promise<unknown> {
    return this.request("/api/v1/high_frequency", {
      codes: code,
      indicators: "open,high,low,close,volume,amount",
      starttime: startTime,
      endtime: endTime,
      functionpara: {
        Interval: String(interval),
        CPS: cps,
        Fill: "Original",
        Timeformat: "LocalTime",
        Limitstart: "09:15:00",
        Limitend: "15:15:00",
      },
    }, 30_000);
  }

  async allAStockDirectory(date: string): Promise<unknown> {
    return this.request("/api/v1/data_pool", {
      reportname: "p03425",
      functionpara: { date, blockname: "001005010", iv_type: "allcontract" },
      outputpara: "p03291_f001,p03291_f002,p03291_f003,p03291_f004",
    }, 30_000);
  }

  async searchFunds(query: string): Promise<unknown> {
    return this.searchByName(query, "fund");
  }

  async searchStocks(query: string): Promise<unknown> {
    return this.searchByName(query, "stock");
  }

  private async searchByName(query: string, type: "stock" | "fund"): Promise<unknown> {
    return this.request("/api/v1/smart_stock_picking", {
      searchstring: query,
      searchtype: type,
    }, 30_000);
  }

  private async request(path: string, body: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    let refreshed = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const token = await this.getAccessToken(refreshed);
        const response = await this.post(path, body, timeoutMs, {
          "access_token": token,
          "ifindlang": "cn",
        });
        if (hasIfindError(response.value)) {
          const mapped = mapIfindFailure(response.value, response.status);
          if (mapped.code === "ifind_auth_failed" && !refreshed) {
            refreshed = true;
            this.accessToken = null;
            continue;
          }
          throw mapped;
        }
        if (!response.ok) throw mapIfindFailure(response.value, response.status);
        return response.value;
      } catch (error) {
        const mapped = error instanceof ServiceError ? error : null;
        if (mapped && !["upstream_unavailable", "rate_limited"].includes(mapped.code)) throw mapped;
        if (attempt === 2) {
          throw mapped ?? new ServiceError("upstream_unavailable", "无法连接 iFinD 行情接口。", 502);
        }
        await delay(attempt === 0 ? 250 : 1_000);
      }
    }
    throw new ServiceError("upstream_unavailable", "iFinD 请求失败。", 502);
  }

  private async getAccessToken(forceRefresh: boolean): Promise<string> {
    if (!forceRefresh && this.accessToken && this.accessToken.refreshAfter > this.now()) {
      return this.accessToken.value;
    }
    const refreshToken = this.refreshTokenReader();
    const response = await this.post("/api/v1/get_access_token", {}, 15_000, {
      "refresh_token": refreshToken,
    });
    if (!response.ok || hasIfindError(response.value)) {
      throw mapIfindFailure(response.value, response.status === 200 ? 401 : response.status);
    }
    const accessToken = findString(response.value, ["access_token", "accessToken"]);
    if (!accessToken) {
      throw new ServiceError("ifind_auth_failed", "iFinD 未返回有效 access token。", 401);
    }
    this.accessToken = {
      value: accessToken,
      refreshAfter: this.now() + 6 * 24 * 60 * 60 * 1_000,
    };
    return accessToken;
  }

  private async post(
    path: string,
    body: Record<string, unknown>,
    timeoutMs: number,
    extraHeaders: Record<string, string>,
  ): Promise<{ ok: boolean; status: number; value: unknown }> {
    if (!path.startsWith("/api/v1/")) {
      throw new ServiceError("internal_error", "拒绝访问非 iFinD API 路径。", 500);
    }
    await this.limiter.wait(path);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(`${IFIND_BASE_URL}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...extraHeaders,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let value: unknown = {};
      try {
        value = text ? JSON.parse(text) : {};
      } catch {
        value = { message: text || `HTTP ${response.status}` };
      }
      return { ok: response.ok, status: response.status, value };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(
        "upstream_unavailable",
        error instanceof Error && error.name === "AbortError"
          ? "iFinD 请求超时。"
          : "无法连接 iFinD 行情接口。",
        502,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export function flattenIfindRows(value: unknown): Array<Record<string, unknown>> {
  const root = asRecord(value);
  if (!root) return [];
  const candidate = root.tables ?? root.data;
  const sources = Array.isArray(candidate) ? candidate : candidate ? [candidate] : [root];
  const rows: Array<Record<string, unknown>> = [];
  for (const source of sources) {
    const record = asRecord(source);
    if (!record) continue;
    const table = record.table ?? record.data;
    if (Array.isArray(table)) {
      for (let index = 0; index < table.length; index++) {
        const item = asRecord(table[index]);
        if (item) rows.push({ ...baseColumns(record, index), ...item });
      }
      continue;
    }
    const columns = asRecord(table) ?? record;
    const count = Math.max(1, ...Object.values(columns).map(value => Array.isArray(value) ? value.length : 1));
    for (let index = 0; index < count; index++) {
      const row = baseColumns(record, index);
      for (const [key, column] of Object.entries(columns)) {
        if (["table", "data", "perf", "datatype", "inputParams"].includes(key)) continue;
        row[key] = Array.isArray(column) ? column[index] : column;
      }
      rows.push(row);
    }
  }
  return rows;
}

function baseColumns(record: Record<string, unknown>, index: number): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of ["thscode", "code", "time", "security_name", "securityName"]) {
    const value = record[key];
    if (value !== undefined) result[key] = Array.isArray(value) ? value[index] : value;
  }
  return result;
}

function hasIfindError(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) return false;
  const code = record.errorcode ?? record.errorCode;
  return code !== undefined && String(code) !== "0";
}

function findString(value: unknown, keys: string[], depth = 0): string | null {
  if (depth > 5) return null;
  if (Array.isArray(value)) {
    for (const nested of value) {
      const found = findString(nested, keys, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  for (const key of keys) {
    const found = record[key];
    if (typeof found === "string" && found.trim()) return found.trim();
  }
  for (const nested of Object.values(record)) {
    const found = findString(nested, keys, depth + 1);
    if (found) return found;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
