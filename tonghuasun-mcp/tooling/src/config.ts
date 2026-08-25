import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ProductConfig, RuntimeEndpoint } from "./types.js";
import { ServiceError } from "./errors.js";

export const LOCAL_TOKEN_HEADER = "X-Tonghuasun-Codex-Token";
export const KEYCHAIN_SERVICE = "com.tonghuasun-agent.ifind.refresh-token";
export const LAUNCH_AGENT_LABEL = "com.tonghuasun-agent.market-server";

export function productHome(): string {
  const overridden = process.env.TONGHUASUN_AGENT_HOME?.trim() || process.env.TONGHUASUN_CODEX_HOME?.trim();
  return overridden
    ? resolve(overridden)
    : join(homedir(), "Library", "Application Support", "TonghuasunAgent");
}

export function configPath(home = productHome()): string {
  return join(home, "config.json");
}

export function endpointPath(home = productHome()): string {
  return join(home, "runtime", "endpoint.json");
}

export function securityMasterPath(home = productHome()): string {
  return join(home, "cache", "security-master.json");
}

export function readConfig(home = productHome(), required = true): ProductConfig | null {
  const value = readJson<ProductConfig>(configPath(home));
  if (!value && required) {
    throw new ServiceError("not_configured", "尚未配置 macOS 同花顺行情服务，请先运行配置器。", 503);
  }
  if (value && (!value.localAccessToken || !Number.isInteger(value.preferredPort))) {
    throw new ServiceError("not_configured", "本机行情服务配置无效，请运行 repair。", 503);
  }
  return value;
}

export function readEndpoint(home = productHome()): RuntimeEndpoint | null {
  return readJson<RuntimeEndpoint>(endpointPath(home));
}

export function writePrivateJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

export function removeEndpointIfOwned(home: string, processId: number): void {
  const path = endpointPath(home);
  const endpoint = readJson<RuntimeEndpoint>(path);
  if (endpoint?.processId === processId) rmSync(path, { force: true });
}

export function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    throw new ServiceError("not_configured", `无法读取本机配置：${path}`, 503, {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
