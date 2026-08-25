export const VERSION = "0.3.0";

export const PERIODS = ["1m", "5m", "15m", "30m", "60m", "1d", "1w", "1mo"] as const;
export type CandlePeriod = (typeof PERIODS)[number];

export const ADJUSTMENTS = ["forward", "none", "backward"] as const;
export type Adjustment = (typeof ADJUSTMENTS)[number];

export const SECURITY_TYPES = ["stock", "index", "etf", "fund"] as const;
export type SecurityType = (typeof SECURITY_TYPES)[number];
export type MarketCode = "SH" | "SZ" | "BJ";

export type Security = {
  market: MarketCode;
  code: string;
  fullCode: string;
  name: string;
  type: SecurityType;
  currency: "CNY";
  aliases?: string[];
};

export type QuoteSnapshot = {
  security: Security;
  timestampUtc: string;
  previousClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  latest: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  amount: number | null;
  source: "ifind";
  fetchedAtUtc: string;
};

export type CandleBar = {
  timestampUtc: string;
  label: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
};

export type CandleSeries = {
  security: Security;
  period: CandlePeriod;
  adjustment: Adjustment;
  bars: CandleBar[];
  pointCount: number;
  source: "ifind";
  fetchedAtUtc: string;
};

export type ProductConfig = {
  schemaVersion: 1;
  preferredPort: number;
  localAccessToken: string;
  releaseVersion: string;
  activeReleasePath: string;
  nodePath: string;
  updatedAtUtc: string;
};

export type RuntimeEndpoint = {
  schemaVersion: 1;
  baseUrl: string;
  mcpUrl: string;
  port: number;
  processId: number;
  pluginVersion: string;
  startedAtUtc: string;
};

export type ApiEnvelope<T> =
  | { ok: true; traceId: string; data: T }
  | { ok: false; traceId: string; error: { code: string; message: string; details?: unknown } };
