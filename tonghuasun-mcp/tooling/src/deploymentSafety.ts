import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type ExistingMapping = {
  fileName: string;
  sourcePath: string;
  destinationPath: string;
  sha256: string;
  mode: "symlink" | "copy";
};

export type DeploymentFile = {
  fileName: string;
  sha256: string;
};

export type DeploymentPlanItem = {
  fileName: string;
  destinationPath: string;
  action: "create" | "replace-managed" | "conflict";
  reason: string;
};

export type RetirementPlanItem = {
  fileName: string;
  destinationPath: string;
  action: "remove-managed" | "already-absent" | "preserve-modified";
  reason: string;
};

/**
 * 在写入 PluginSdks 前生成完整计划。只有当前配置中登记且内容仍匹配的文件
 * 才视为本安装器所有；未知文件和被用户改过的文件都必须显式 --force。
 */
export function createDeploymentPlan(
  files: readonly DeploymentFile[],
  pluginDirectory: string,
  existingMappings: readonly ExistingMapping[],
): DeploymentPlanItem[] {
  const mappingsByDestination = new Map(
    existingMappings.map((mapping) => [normalizePath(mapping.destinationPath), mapping]),
  );

  return files.map((file) => {
    const destinationPath = join(pluginDirectory, file.fileName);
    if (!existsSync(destinationPath) && !isSymbolicLink(destinationPath)) {
      return {
        fileName: file.fileName,
        destinationPath,
        action: "create",
        reason: "目标文件不存在",
      };
    }

    const mapping = mappingsByDestination.get(normalizePath(destinationPath));
    if (mapping && canManageDestination(mapping)) {
      return {
        fileName: file.fileName,
        destinationPath,
        action: "replace-managed",
        reason: "目标文件由当前安装配置管理且未被修改",
      };
    }

    return {
      fileName: file.fileName,
      destinationPath,
      action: "conflict",
      reason: mapping
        ? "目标文件已偏离安装记录，可能被人工修改或被其他程序替换"
        : "目标文件不属于当前安装配置",
    };
  });
}

/**
 * 找出新载荷不再包含的旧文件。内容仍与安装记录一致时可以安全移除；
 * 用户改过的文件必须保留，避免升级过程误删第三方或人工放置的内容。
 */
export function createRetirementPlan(
  files: readonly DeploymentFile[],
  pluginDirectory: string,
  existingMappings: readonly ExistingMapping[],
): RetirementPlanItem[] {
  const activeDestinations = new Set(
    files.map((file) => normalizePath(join(pluginDirectory, file.fileName))),
  );

  return existingMappings
    .filter((mapping) => !activeDestinations.has(normalizePath(mapping.destinationPath)))
    .map((mapping) => {
      if (!existsSync(mapping.destinationPath) && !isSymbolicLink(mapping.destinationPath)) {
        return {
          fileName: mapping.fileName,
          destinationPath: mapping.destinationPath,
          action: "already-absent",
          reason: "旧版托管文件已不存在",
        };
      }

      if (canManageDestination(mapping)) {
        return {
          fileName: mapping.fileName,
          destinationPath: mapping.destinationPath,
          action: "remove-managed",
          reason: "新版本不再包含该文件，且内容仍与旧安装记录一致",
        };
      }

      return {
        fileName: mapping.fileName,
        destinationPath: mapping.destinationPath,
        action: "preserve-modified",
        reason: "旧文件已被修改或替换，升级时予以保留",
      };
    });
}

export function canManageDestination(mapping: ExistingMapping): boolean {
  if (!existsSync(mapping.destinationPath) && !isSymbolicLink(mapping.destinationPath)) {
    return false;
  }

  if (isSymbolicLink(mapping.destinationPath)) {
    try {
      return resolve(dirname(mapping.destinationPath), readlinkSync(mapping.destinationPath)) === resolve(mapping.sourcePath);
    } catch {
      return false;
    }
  }

  try {
    if (!lstatSync(mapping.destinationPath).isFile()) return false;
    return mapping.mode === "copy" && hashFile(mapping.destinationPath) === mapping.sha256;
  } catch {
    return false;
  }
}

function isSymbolicLink(filePath: string): boolean {
  try {
    return lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

function hashFile(filePath: string): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

function normalizePath(filePath: string): string {
  const normalized = resolve(filePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
