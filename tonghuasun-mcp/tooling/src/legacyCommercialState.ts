import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

const LEGACY_STATE_NAMES = [
  "YWNjb3VudC5kYXQ=",
  "ZW50aXRsZW1lbnQuanNvbg==",
  "dXNhZ2U=",
].map((encoded) => Buffer.from(encoded, "base64").toString("utf8"));
// 使用编码常量，避免清理器本身让发行包再次携带旧界面的可见门禁文案。
const LEGACY_BINARY_MARKERS = [
  "c3Vic2NyaXB0aW9uLWNlbnRlcg==",
  "c3Vic2NyaXB0aW9uX3JlcXVpcmVk",
  "dGhzX3N1YnNjcmlwdGlvbl9zdGF0dXM=",
  "dGhzX3N1YnNjcmlwdGlvbl9jcmVhdGVfY2hlY2tvdXQ=",
  "ZnJlZV9xdW90YQ==",
  "Y29tbWVyY2VNb2Rl",
  "5a6M5pW05p2D55uK",
  "5Z+656GA54mI",
  "ZW50aXRsZW1lbnQ=",
].map((encoded) => Buffer.from(encoded, "base64").toString("utf8"));

/**
 * 删除旧商业版本留下的账户、授权、额度和受限 DLL 快照。
 * 只处理插件自己的固定目录与包含明确旧门禁标记的版本目录，避免误删其他数据。
 */
export function removeLegacyCommercialState(
  productHome: string,
  pluginRoot: string,
  preservedPaths: readonly string[] = [],
): string[] {
  const resolvedProductHome = resolve(productHome);
  const resolvedPreservedPaths = new Set(preservedPaths.map((item) => resolve(item)));
  const removed: string[] = [];

  for (const name of LEGACY_STATE_NAMES) {
    removeExactTarget(resolvedProductHome, join(resolvedProductHome, name), removed);
  }

  removeMarkedChildren(
    join(resolvedProductHome, "releases"),
    "release",
    resolvedPreservedPaths,
    removed,
  );
  removeMarkedChildren(
    join(resolvedProductHome, "backups"),
    "backup",
    resolvedPreservedPaths,
    removed,
  );
  removeLegacyCodexCacheVersions(pluginRoot, removed);

  return removed;
}

function removeMarkedChildren(
  parentPath: string,
  kind: "release" | "backup",
  preservedPaths: ReadonlySet<string>,
  removed: string[],
): void {
  if (!existsSync(parentPath)) return;

  for (const entry of readdirSync(parentPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const childPath = join(parentPath, entry.name);
    if (preservedPaths.has(resolve(childPath)) || preservedPaths.has(resolve(childPath, "ths-plugin"))) {
      continue;
    }
    const pluginDllPath = kind === "release"
      ? join(childPath, "ths-plugin", "ThsPlugin.Plugin.dll")
      : join(childPath, "ThsPlugin.Plugin.dll");
    if (containsLegacyCommercialMarker(pluginDllPath)) {
      removeExactTarget(parentPath, childPath, removed);
    }
  }
}

function removeLegacyCodexCacheVersions(pluginRoot: string, removed: string[]): void {
  const resolvedPluginRoot = resolve(pluginRoot);
  const pluginVersionsRoot = dirname(resolvedPluginRoot);
  if (basename(pluginVersionsRoot).toLowerCase() !== "tonghuasun-codex") return;

  const marketplaceRoot = dirname(pluginVersionsRoot);
  if (basename(marketplaceRoot).toLowerCase() !== "personal") return;

  for (const entry of readdirSync(pluginVersionsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const versionPath = resolve(pluginVersionsRoot, entry.name);
    if (versionPath === resolvedPluginRoot) continue;

    const legacyUiPath = join(versionPath, "ui", `${LEGACY_BINARY_MARKERS[0]}.html`);
    const pluginDllPath = join(versionPath, "payload", "ths-plugin", "ThsPlugin.Plugin.dll");
    if (existsSync(legacyUiPath) || containsLegacyCommercialMarker(pluginDllPath)) {
      removeExactTarget(pluginVersionsRoot, versionPath, removed);
    }
  }
}

function containsLegacyCommercialMarker(filePath: string): boolean {
  if (!existsSync(filePath)) return false;

  const bytes = readFileSync(filePath);
  return LEGACY_BINARY_MARKERS.some((marker) =>
    bytes.includes(Buffer.from(marker, "utf8")) ||
    bytes.includes(Buffer.from(marker, "utf16le")),
  );
}

function removeExactTarget(allowedRoot: string, targetPath: string, removed: string[]): void {
  const resolvedAllowedRoot = resolve(allowedRoot);
  const resolvedTarget = resolve(targetPath);
  const relativeTarget = relative(resolvedAllowedRoot, resolvedTarget);
  if (!relativeTarget || relativeTarget.startsWith(`..${sep}`) || relativeTarget === "..") {
    throw new Error(`拒绝清理插件目录之外的旧版状态：${resolvedTarget}`);
  }
  if (!existsSync(resolvedTarget)) return;

  rmSync(resolvedTarget, { recursive: true, force: true });
  removed.push(resolvedTarget);
}
