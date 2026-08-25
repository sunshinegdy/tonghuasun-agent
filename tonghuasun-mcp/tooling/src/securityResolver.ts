import { existsSync, readFileSync } from "node:fs";
import type { IfindClient } from "./ifindClient.js";
import { flattenIfindRows } from "./ifindClient.js";
import { securityMasterPath, writePrivateJson } from "./config.js";
import { ServiceError } from "./errors.js";
import type { MarketCode, Security, SecurityType } from "./types.js";

type DirectoryFile = {
  schemaVersion: 1;
  refreshedAtUtc: string;
  stocks: Security[];
  fundCache: Array<{ cachedAtUtc: string; security: Security }>;
};

const DAY_MS = 24 * 60 * 60 * 1_000;
const FUND_CACHE_MS = 30 * DAY_MS;

const INDEX_SECURITIES: Security[] = [
  index("000001.SH", "上证指数", ["上证综指"]),
  index("000016.SH", "上证50", ["上证50指数"]),
  index("000300.SH", "沪深300", ["沪深300指数"]),
  index("000688.SH", "科创50", ["科创50指数"]),
  index("000905.SH", "中证500", ["中证500指数"]),
  index("000852.SH", "中证1000", ["中证1000指数"]),
  index("399001.SZ", "深证成指", ["深证指数"]),
  index("399006.SZ", "创业板指", ["创业板指数"]),
  index("899050.BJ", "北证50", ["北证50指数"]),
];

export class SecurityResolver {
  private file: DirectoryFile;

  constructor(
    private readonly ifind: Pick<IfindClient, "allAStockDirectory" | "searchFunds" | "searchStocks">,
    private readonly path = securityMasterPath(),
    private readonly now: () => number = Date.now,
  ) {
    this.file = loadDirectory(path) ?? {
      schemaVersion: 1,
      refreshedAtUtc: "",
      stocks: [],
      fundCache: [],
    };
  }

  get refreshedAtUtc(): string | null {
    return this.file.refreshedAtUtc || null;
  }

  async search(query: string, types?: SecurityType[], limit = 10): Promise<Security[]> {
    const normalizedQuery = normalize(query);
    if (!normalizedQuery) throw new ServiceError("invalid_request", "证券查询不能为空。", 400);
    let directoryError: unknown = null;
    try {
      await this.ensureStockDirectory();
    } catch (error) {
      directoryError = error;
    }
    const allowed = new Set<SecurityType>(types?.length ? types : ["stock", "index", "etf", "fund"]);
    const candidates = this.allSecurities()
      .filter(item => allowed.has(item.type))
      .map(item => ({ item, score: matchScore(item, normalizedQuery) }))
      .filter(candidate => candidate.score > 0)
      .sort((left, right) => right.score - left.score || left.item.fullCode.localeCompare(right.item.fullCode));

    if (candidates.length === 0 && !looksLikeCode(query)) {
      if (allowed.has("stock")) await this.searchOnline(query, "stock");
      if (allowed.has("etf") || allowed.has("fund")) await this.searchOnline(query, "fund");
      const online = this.searchLocal(normalizedQuery, allowed, limit);
      if (online.length > 0) return online;
    }
    if (candidates.length === 0 && looksLikeNumericCode(query)) {
      return inferredNumericSecurities(query.trim()).filter(item => allowed.has(item.type)).slice(0, limit);
    }
    const local = dedupe(candidates.map(candidate => candidate.item)).slice(0, limit);
    if (local.length === 0 && directoryError) throw directoryError;
    return local;
  }

  async resolve(query: string): Promise<Security> {
    const trimmed = query.trim().toUpperCase();
    if (/^\d{6}\.(SH|SZ|BJ)$/.test(trimmed)) {
      return this.allSecurities().find(item => item.fullCode === trimmed) ?? securityFromFullCode(trimmed);
    }
    const matches = await this.search(query, undefined, 20);
    if (matches.length === 0) {
      throw new ServiceError("security_not_found", `没有找到证券：${query}`, 404);
    }
    const exact = matches.filter(item => exactMatch(item, normalize(query)));
    if (exact.length === 1) return exact[0]!;
    if (matches.length === 1) return matches[0]!;
    throw new ServiceError("ambiguous_security", `证券名称或代码存在歧义：${query}`, 409, {
      candidates: matches.map(item => ({ fullCode: item.fullCode, name: item.name, type: item.type })),
    });
  }

  private searchLocal(query: string, allowed: Set<SecurityType>, limit: number): Security[] {
    return dedupe(this.allSecurities()
      .filter(item => allowed.has(item.type))
      .map(item => ({ item, score: matchScore(item, query) }))
      .filter(candidate => candidate.score > 0)
      .sort((left, right) => right.score - left.score || left.item.fullCode.localeCompare(right.item.fullCode))
      .map(candidate => candidate.item)).slice(0, limit);
  }

  private allSecurities(): Security[] {
    const cutoff = this.now() - FUND_CACHE_MS;
    const funds = this.file.fundCache
      .filter(entry => Date.parse(entry.cachedAtUtc) >= cutoff)
      .map(entry => entry.security);
    return dedupe([...INDEX_SECURITIES, ...this.file.stocks, ...funds]);
  }

  private async ensureStockDirectory(): Promise<void> {
    const refreshedAt = Date.parse(this.file.refreshedAtUtc);
    if (Number.isFinite(refreshedAt) && this.now() - refreshedAt < DAY_MS && this.file.stocks.length > 0) return;
    try {
      const date = shanghaiDate(new Date(this.now())).replaceAll("-", "");
      const response = await this.ifind.allAStockDirectory(date);
      const stocks = dedupe(flattenIfindRows(response)
        .map(row => securityFromRow(row, "stock"))
        .filter((item): item is Security => item !== null));
      if (stocks.length === 0) throw new ServiceError("no_data", "iFinD 未返回 A 股证券目录。", 502);
      this.file.stocks = stocks;
      this.file.refreshedAtUtc = new Date(this.now()).toISOString();
      this.persist();
    } catch (error) {
      if (this.file.stocks.length > 0) return;
      throw error;
    }
  }

  private async searchOnline(query: string, type: "stock" | "fund"): Promise<void> {
    const response = type === "stock" ? await this.ifind.searchStocks(query) : await this.ifind.searchFunds(query);
    const found = dedupe(flattenIfindRows(response)
      .map(row => securityFromRow(row, type))
      .filter((item): item is Security => item !== null));
    const cachedAtUtc = new Date(this.now()).toISOString();
    const byCode = new Map(this.file.fundCache.map(entry => [entry.security.fullCode, entry]));
    for (const security of found) byCode.set(security.fullCode, { cachedAtUtc, security });
    this.file.fundCache = [...byCode.values()]
      .filter(entry => Date.parse(entry.cachedAtUtc) >= this.now() - FUND_CACHE_MS);
    this.persist();
  }

  private persist(): void {
    writePrivateJson(this.path, this.file);
  }
}

function loadDirectory(path: string): DirectoryFile | null {
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as DirectoryFile;
    return value?.schemaVersion === 1 && Array.isArray(value.stocks) && Array.isArray(value.fundCache)
      ? value
      : null;
  } catch {
    return null;
  }
}

function securityFromRow(row: Record<string, unknown>, fallbackType: "stock" | "fund"): Security | null {
  const fullCode = findFullCode(row);
  if (!fullCode) return null;
  const name = findName(row, fullCode) || fullCode;
  const inferred = securityFromFullCode(fullCode, fallbackType);
  return { ...inferred, name };
}

function findFullCode(row: Record<string, unknown>): string | null {
  const preferred = ["thscode", "THSCODE", "fullCode", "full_code", "p03291_f002", "p03425_f002"];
  for (const key of preferred) {
    const code = normalizeFullCode(row[key]);
    if (code) return code;
  }
  for (const value of Object.values(row)) {
    const code = normalizeFullCode(value);
    if (code) return code;
  }
  return null;
}

function normalizeFullCode(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim().toUpperCase();
  if (/^\d{6}\.(SH|SZ|BJ)$/.test(text)) return text;
  if (/^\d{6}$/.test(text)) return inferredNumericSecurities(text)[0]?.fullCode ?? null;
  return null;
}

function findName(row: Record<string, unknown>, code: string): string | null {
  for (const key of ["security_name", "securityName", "secName", "name", "证券简称", "p03291_f003", "p03425_f003"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim() && value.trim() !== code) return value.trim();
  }
  for (const value of Object.values(row)) {
    if (typeof value === "string" && /[\u3400-\u9fff]/.test(value) && !/^\d{4}-\d{2}-\d{2}/.test(value)) {
      return value.trim();
    }
  }
  return null;
}

function securityFromFullCode(fullCode: string, fallbackType?: "stock" | "fund"): Security {
  const [code, suffix] = fullCode.split(".") as [string, MarketCode];
  return {
    market: suffix,
    code,
    fullCode,
    name: fullCode,
    type: inferType(code, suffix, fallbackType),
    currency: "CNY",
  };
}

function inferredNumericSecurities(raw: string): Security[] {
  const code = raw.trim();
  if (!/^\d{6}$/.test(code)) return [];
  const matches: Security[] = [];
  const seeded = INDEX_SECURITIES.filter(item => item.code === code);
  matches.push(...seeded);
  if (/^(600|601|603|605|688|689)/.test(code)) matches.push(securityFromFullCode(`${code}.SH`, "stock"));
  else if (/^(000|001|002|003|300|301)/.test(code)) matches.push(securityFromFullCode(`${code}.SZ`, "stock"));
  else if (/^(4|8|9)/.test(code)) matches.push(securityFromFullCode(`${code}.BJ`, "stock"));
  else if (/^399/.test(code)) matches.push(securityFromFullCode(`${code}.SZ`));
  else if (/^(510|511|512|513|515|516|517|518|560|561|562|563|588)/.test(code)) {
    matches.push(securityFromFullCode(`${code}.SH`, "fund"));
  } else if (/^159/.test(code)) matches.push(securityFromFullCode(`${code}.SZ`, "fund"));
  return dedupe(matches);
}

function inferType(code: string, market: MarketCode, fallback?: "stock" | "fund"): SecurityType {
  if (INDEX_SECURITIES.some(item => item.fullCode === `${code}.${market}`) || market === "SZ" && code.startsWith("399")) {
    return "index";
  }
  if (fallback === "fund" || /^(159|510|511|512|513|515|516|517|518|560|561|562|563|588)/.test(code)) {
    return "etf";
  }
  return fallback ?? "stock";
}

function matchScore(item: Security, query: string): number {
  const fields = [item.fullCode, item.code, item.name, ...(item.aliases ?? [])].map(normalize);
  if (fields.some(value => value === query)) return 100;
  if (fields.some(value => value.startsWith(query))) return 80;
  if (fields.some(value => value.includes(query))) return 60;
  return 0;
}

function exactMatch(item: Security, query: string): boolean {
  return [item.fullCode, item.code, item.name, ...(item.aliases ?? [])].map(normalize).includes(query);
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

function looksLikeCode(value: string): boolean {
  return /^\s*\d{6}(?:\.(?:SH|SZ|BJ))?\s*$/i.test(value);
}

function looksLikeNumericCode(value: string): boolean {
  return /^\s*\d{6}\s*$/.test(value);
}

function dedupe(items: Security[]): Security[] {
  const values = new Map<string, Security>();
  for (const item of items) {
    const current = values.get(item.fullCode);
    values.set(item.fullCode, current && current.name !== current.fullCode ? current : item);
  }
  return [...values.values()];
}

function index(fullCode: string, name: string, aliases: string[]): Security {
  const [code, market] = fullCode.split(".") as [string, MarketCode];
  return { market, code, fullCode, name, aliases, type: "index", currency: "CNY" };
}

function shanghaiDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}
