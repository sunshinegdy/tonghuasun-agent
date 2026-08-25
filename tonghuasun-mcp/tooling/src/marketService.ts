import type { IfindClient } from "./ifindClient.js";
import { flattenIfindRows } from "./ifindClient.js";
import type { SecurityResolver } from "./securityResolver.js";
import { ServiceError } from "./errors.js";
import type {
  Adjustment,
  CandleBar,
  CandlePeriod,
  CandleSeries,
  QuoteSnapshot,
  Security,
  SecurityType,
} from "./types.js";
import { ADJUSTMENTS, PERIODS, SECURITY_TYPES } from "./types.js";

type CandleOptions = {
  period?: CandlePeriod | undefined;
  adjustment?: Adjustment | undefined;
  start?: string | undefined;
  end?: string | undefined;
  limit?: number | undefined;
};

type CacheEntry<T> = { expiresAt: number; value: T };

export class MarketService {
  private readonly snapshotCache = new Map<string, CacheEntry<QuoteSnapshot[]>>();
  private readonly candleCache = new Map<string, CacheEntry<CandleSeries>>();

  constructor(
    private readonly ifind: Pick<IfindClient, "realtimeQuotes" | "historyQuotes" | "highFrequency">,
    private readonly resolver: SecurityResolver,
    private readonly now: () => number = Date.now,
  ) {}

  get securityDirectoryRefreshedAtUtc(): string | null {
    return this.resolver.refreshedAtUtc;
  }

  async search(query: string, types?: SecurityType[], limit = 10): Promise<Security[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new ServiceError("invalid_request", "证券搜索 limit 必须是 1 到 20 的整数。", 400);
    }
    if (types?.some(type => !SECURITY_TYPES.includes(type))) {
      throw new ServiceError("invalid_request", "包含不支持的证券类型。", 400);
    }
    return this.resolver.search(query, types, limit);
  }

  async snapshot(inputs: string | string[]): Promise<QuoteSnapshot[]> {
    const requested = typeof inputs === "string" ? [inputs] : inputs;
    if (requested.length < 1 || requested.length > 50) {
      throw new ServiceError("invalid_request", "实时行情一次必须查询 1 到 50 个证券。", 400);
    }
    if (requested.some(value => typeof value !== "string" || !value.trim())) {
      throw new ServiceError("invalid_request", "证券代码或名称必须是非空字符串。", 400);
    }
    const securities = await Promise.all(requested.map(value => this.resolver.resolve(value)));
    const key = securities.map(item => item.fullCode).sort().join(",");
    const cached = readCache(this.snapshotCache, key, this.now());
    if (cached) return cached;
    const response = await this.ifind.realtimeQuotes(securities.map(item => item.fullCode));
    const rows = flattenIfindRows(response);
    const fetchedAtUtc = new Date(this.now()).toISOString();
    const missing: string[] = [];
    const items = securities.flatMap((security, index) => {
      const row = findRow(rows, security.fullCode, index);
      if (!row) {
        missing.push(security.fullCode);
        return [];
      }
      return [quoteFromRow(row, security, fetchedAtUtc)];
    });
    if (missing.length > 0) {
      throw new ServiceError("no_data", `iFinD 未返回证券行情：${missing.join(", ")}`, 404, { missing });
    }
    this.snapshotCache.set(key, { expiresAt: this.now() + 2_000, value: items });
    return items;
  }

  async candles(input: string, options: CandleOptions = {}): Promise<CandleSeries> {
    const security = await this.resolver.resolve(input);
    const period = options.period ?? "1d";
    const adjustment = options.adjustment ?? "forward";
    const limit = options.limit ?? 160;
    if (!Number.isInteger(limit) || limit < 1 || limit > 5_000) {
      throw new ServiceError("invalid_request", "K 线 limit 必须是 1 到 5000 的整数。", 400);
    }
    if (!PERIODS.includes(period)) throw new ServiceError("invalid_request", `不支持的 K 线周期：${period}`, 400);
    if (!ADJUSTMENTS.includes(adjustment)) throw new ServiceError("invalid_request", `不支持的复权方式：${adjustment}`, 400);
    const window = resolveWindow(period, limit, options.start, options.end, this.now());
    const key = [security.fullCode, period, adjustment, window.start.toISOString(), window.end.toISOString(), limit].join("|");
    const cached = readCache(this.candleCache, key, this.now());
    if (cached) return cached;

    const response = isMinutePeriod(period)
      ? await this.ifind.highFrequency(
          security.fullCode,
          minuteInterval(period),
          minuteAdjustment(adjustment),
          formatShanghaiDateTime(window.start),
          formatShanghaiDateTime(window.end),
        )
      : await this.ifind.historyQuotes(
          security.fullCode,
          historyInterval(period),
          historyAdjustment(adjustment),
          formatShanghaiDate(window.start),
          formatShanghaiDate(window.end),
        );

    const bars = normalizeBars(flattenIfindRows(response), period).slice(-limit);
    if (bars.length === 0) {
      throw new ServiceError("no_data", `iFinD 未返回 ${security.fullCode} 的 ${period} K 线。`, 404);
    }
    const series: CandleSeries = {
      security,
      period,
      adjustment,
      bars,
      pointCount: bars.length,
      source: "ifind",
      fetchedAtUtc: new Date(this.now()).toISOString(),
    };
    const current = !options.end || window.end.getTime() >= startOfShanghaiDay(this.now());
    this.candleCache.set(key, {
      expiresAt: this.now() + (current ? 30_000 : 24 * 60 * 60 * 1_000),
      value: series,
    });
    return series;
  }
}

function quoteFromRow(row: Record<string, unknown>, original: Security, fetchedAtUtc: string): QuoteSnapshot {
  const name = stringValue(row, ["security_name", "securityName", "secName", "name"]);
  const security = name ? { ...original, name } : original;
  const latest = numberValue(row, ["latest", "new", "close"]);
  const previousClose = numberValue(row, ["preClose", "prevClose", "previousClose", "pre_close"]);
  const directChange = numberValue(row, ["change", "rise_amount", "changeAmount"]);
  const directPercent = numberValue(row, ["changeRatio", "changePercent", "rise_percentage", "pctChange"]);
  const change = directChange ?? (latest !== null && previousClose !== null ? latest - previousClose : null);
  const changePercent = directPercent ?? (
    change !== null && previousClose !== null && previousClose !== 0 ? change / previousClose * 100 : null
  );
  const timestamp = valueFor(row, ["tradeTime", "date_time", "timestamp", "time"]);
  return {
    security,
    timestampUtc: parseIfindTimestamp(timestamp, false)?.toISOString() ?? fetchedAtUtc,
    previousClose,
    open: numberValue(row, ["open"]),
    high: numberValue(row, ["high"]),
    low: numberValue(row, ["low"]),
    latest,
    change,
    changePercent,
    volume: numberValue(row, ["latestVolume", "volume", "vol", "transaction_volume"]),
    amount: numberValue(row, ["latestAmount", "amount", "amt", "transaction_amount"]),
    source: "ifind",
    fetchedAtUtc,
  };
}

function normalizeBars(rows: Array<Record<string, unknown>>, period: CandlePeriod): CandleBar[] {
  const values = new Map<number, CandleBar>();
  for (const row of rows) {
    const open = numberValue(row, ["open"]);
    const high = numberValue(row, ["high"]);
    const low = numberValue(row, ["low"]);
    const close = numberValue(row, ["close", "latest", "new"]);
    if ([open, high, low, close].some(value => value === null)) continue;
    const timestamp = parseIfindTimestamp(valueFor(row, ["time", "tradeTime", "date_time", "timestamp"]), !isMinutePeriod(period));
    if (!timestamp) continue;
    values.set(timestamp.getTime(), {
      timestampUtc: timestamp.toISOString(),
      label: formatBarLabel(timestamp, period),
      open: open!,
      high: high!,
      low: low!,
      close: close!,
      volume: numberValue(row, ["volume", "vol", "transaction_volume"]) ?? 0,
      amount: numberValue(row, ["amount", "amt", "transaction_amount"]) ?? 0,
    });
  }
  return [...values.values()].sort((left, right) => left.timestampUtc.localeCompare(right.timestampUtc));
}

function resolveWindow(period: CandlePeriod, limit: number, start: string | undefined, end: string | undefined, now: number) {
  const endDate = end ? parseInputDate(end, "end") : new Date(now);
  let startDate: Date;
  if (start) {
    startDate = parseInputDate(start, "start");
  } else if (isMinutePeriod(period)) {
    const barsPerDay = 240 / minuteInterval(period);
    const tradingDays = Math.ceil(limit / barsPerDay);
    const calendarDays = Math.min(365, Math.ceil(tradingDays * 7 / 5 * 1.2) + 3);
    startDate = new Date(endDate.getTime() - calendarDays * 24 * 60 * 60 * 1_000);
  } else {
    const barsPerYear = period === "1d" ? 242 : period === "1w" ? 52 : 12;
    const calendarDays = Math.min(5 * 365, Math.ceil(limit / barsPerYear * 365 * 1.2) + 7);
    startDate = new Date(endDate.getTime() - calendarDays * 24 * 60 * 60 * 1_000);
  }
  if (startDate >= endDate) throw new ServiceError("invalid_request", "K 线开始时间必须早于结束时间。", 400);
  return { start: startDate, end: endDate };
}

function parseInputDate(value: string, field: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new ServiceError("invalid_request", `K 线 ${field} 必须是有效的 RFC3339 时间。`, 400);
  }
  return parsed;
}

function parseIfindTimestamp(value: unknown, endOfDay: boolean): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "number") {
    if (Number.isInteger(value) && value >= 10_000_000 && value <= 99_999_999) {
      return parseIfindTimestamp(String(value), endOfDay);
    }
    const milliseconds = value > 10_000_000_000 ? value : value * 1_000;
    const parsed = new Date(milliseconds);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  const normalized = /^\d{4}-?\d{2}-?\d{2}$/.test(text)
    ? `${normalizeDateText(text)}T${endOfDay ? "15:00:00" : "00:00:00"}+08:00`
    : /(?:Z|[+-]\d{2}:?\d{2})$/.test(text)
      ? text.replace(" ", "T")
      : `${text.replace(" ", "T")}+08:00`;
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function normalizeDateText(value: string): string {
  const digits = value.replaceAll("-", "");
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function formatBarLabel(value: Date, period: CandlePeriod): string {
  const options: Intl.DateTimeFormatOptions = isMinutePeriod(period)
    ? { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }
    : { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" };
  return new Intl.DateTimeFormat("zh-CN", options).format(value).replaceAll("/", "-");
}

function findRow(rows: Array<Record<string, unknown>>, fullCode: string, fallbackIndex: number): Record<string, unknown> | null {
  return rows.find(row => String(valueFor(row, ["thscode", "fullCode", "full_code", "code"]) ?? "").toUpperCase() === fullCode)
    ?? rows[fallbackIndex]
    ?? null;
}

function valueFor(row: Record<string, unknown>, aliases: string[]): unknown {
  const wanted = new Set(aliases.map(normalizeKey));
  for (const [key, value] of Object.entries(row)) {
    if (wanted.has(normalizeKey(key))) return value;
  }
  return undefined;
}

function numberValue(row: Record<string, unknown>, aliases: string[]): number | null {
  const value = valueFor(row, aliases);
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value).replaceAll(",", ""));
  return Number.isFinite(number) ? number : null;
}

function stringValue(row: Record<string, unknown>, aliases: string[]): string | null {
  const value = valueFor(row, aliases);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isMinutePeriod(period: CandlePeriod): period is "1m" | "5m" | "15m" | "30m" | "60m" {
  return period.endsWith("m") && period !== "1mo";
}

function minuteInterval(period: "1m" | "5m" | "15m" | "30m" | "60m"): 1 | 5 | 15 | 30 | 60 {
  return Number(period.slice(0, -1)) as 1 | 5 | 15 | 30 | 60;
}

function historyInterval(period: CandlePeriod): "D" | "W" | "M" {
  if (period === "1d") return "D";
  if (period === "1w") return "W";
  if (period === "1mo") return "M";
  throw new ServiceError("invalid_request", `不支持的历史 K 线周期：${period}`, 400);
}

function historyAdjustment(value: Adjustment): 1 | 2 | 3 {
  return value === "none" ? 1 : value === "forward" ? 2 : 3;
}

function minuteAdjustment(value: Adjustment): "no" | "forward1" | "backward1" {
  return value === "none" ? "no" : value === "forward" ? "forward1" : "backward1";
}

function formatShanghaiDate(value: Date): string {
  return dateParts(value).date;
}

function formatShanghaiDateTime(value: Date): string {
  const parts = dateParts(value);
  return `${parts.date} ${parts.time}`;
}

function dateParts(value: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const find = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "00";
  return {
    date: `${find("year")}-${find("month")}-${find("day")}`,
    time: `${find("hour")}:${find("minute")}:${find("second")}`,
  };
}

function startOfShanghaiDay(now: number): number {
  const date = formatShanghaiDate(new Date(now));
  return new Date(`${date}T00:00:00+08:00`).getTime();
}

function readCache<T>(cache: Map<string, CacheEntry<T>>, key: string, now: number): T | null {
  const value = cache.get(key);
  if (!value) return null;
  if (value.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  return value.value;
}
