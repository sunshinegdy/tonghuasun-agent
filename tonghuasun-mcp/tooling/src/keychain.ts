import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";
import { KEYCHAIN_SERVICE } from "./config.js";
import { ServiceError } from "./errors.js";

export type KeychainRunner = (
  executable: string,
  args: readonly string[],
  options: { encoding?: BufferEncoding; stdio?: "inherit" | "pipe" },
) => string | Buffer | null;

const defaultRunner: KeychainRunner = (executable, args, options) =>
  execFileSync(executable, [...args], options as Parameters<typeof execFileSync>[2]) as string | Buffer | null;

export function keychainAccount(): string {
  return userInfo().username;
}

export function promptAndStoreRefreshToken(runner: KeychainRunner = defaultRunner): void {
  if (process.platform !== "darwin") {
    throw new ServiceError("not_configured", "该配置器仅支持 macOS。", 400);
  }
  // -w 作为最后一个无值参数时由 security 自己进行隐藏输入，token 不进入 Node 或进程参数。
  runner(
    "/usr/bin/security",
    ["add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", keychainAccount(), "-w"],
    { stdio: "inherit" },
  );
}

export function readRefreshToken(runner: KeychainRunner = defaultRunner): string {
  try {
    const output = runner(
      "/usr/bin/security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", keychainAccount(), "-w"],
      { encoding: "utf8", stdio: "pipe" },
    );
    const token = String(output ?? "").trim();
    if (!token) throw new Error("empty keychain value");
    return token;
  } catch {
    throw new ServiceError("not_configured", "macOS 钥匙串中没有 iFinD refresh token，请运行 configure。", 503);
  }
}

export function hasRefreshToken(runner: KeychainRunner = defaultRunner): boolean {
  try {
    return readRefreshToken(runner).length > 0;
  } catch {
    return false;
  }
}

export function deleteRefreshToken(runner: KeychainRunner = defaultRunner): void {
  try {
    runner(
      "/usr/bin/security",
      ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", keychainAccount()],
      { stdio: "pipe" },
    );
  } catch {
    // 已不存在时卸载仍视为成功。
  }
}
