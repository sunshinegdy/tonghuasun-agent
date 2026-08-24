import {
  existsSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const LEGACY_STATE_NAMES = [
  "YWNjb3VudC5kYXQ=",
  "ZW50aXRsZW1lbnQuanNvbg==",
  "dXNhZ2U=",
].map((encoded) => Buffer.from(encoded, "base64").toString("utf8"));
/**
 * 将旧商业版本留下的账户、授权和额度状态移出活动目录。
 *
 * 历史发布包、安装备份和插件缓存都可能承担回滚职责，因此不再通过扫描
 * DLL 文本标记来递归删除。精确命中的旧状态会移动到可恢复的归档目录。
 */
export function removeLegacyCommercialState(
  productHome: string,
  _pluginRoot: string,
  _preservedPaths: readonly string[] = [],
): string[] {
  const resolvedProductHome = resolve(productHome);
  const archiveRoot = join(
    resolvedProductHome,
    "legacy-state-backups",
    `${createTimestamp()}-${process.pid}`,
  );
  const archivedSources: string[] = [];

  for (const name of LEGACY_STATE_NAMES) {
    archiveExactTarget(
      resolvedProductHome,
      join(resolvedProductHome, name),
      join(archiveRoot, name),
      archivedSources,
    );
  }

  return archivedSources;
}

function archiveExactTarget(
  allowedRoot: string,
  sourcePath: string,
  archivePath: string,
  archivedSources: string[],
): void {
  const resolvedAllowedRoot = resolve(allowedRoot);
  const resolvedSource = resolve(sourcePath);
  const resolvedArchive = resolve(archivePath);
  assertWithinRoot(resolvedAllowedRoot, resolvedSource);
  assertWithinRoot(resolvedAllowedRoot, resolvedArchive);
  if (!existsSync(resolvedSource)) return;

  mkdirSync(resolve(resolvedArchive, ".."), { recursive: true });
  renameSync(resolvedSource, resolvedArchive);
  archivedSources.push(resolvedSource);
}

function assertWithinRoot(allowedRoot: string, targetPath: string): void {
  const relativeTarget = relative(allowedRoot, targetPath);
  if (!relativeTarget || relativeTarget.startsWith(`..${sep}`) || relativeTarget === "..") {
    throw new Error(`拒绝处理插件目录之外的旧版状态：${targetPath}`);
  }
}

function createTimestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
