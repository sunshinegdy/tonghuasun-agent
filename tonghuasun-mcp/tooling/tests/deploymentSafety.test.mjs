import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDeploymentPlan, createRetirementPlan } from "../dist/deploymentSafety.js";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("拒绝覆盖未登记的同名文件", () => {
  const root = mkdtempSync(join(tmpdir(), "tonghuasun-deployment-conflict-"));
  try {
    const pluginDirectory = join(root, "PluginSdks");
    mkdirSync(pluginDirectory, { recursive: true });
    writeFileSync(join(pluginDirectory, "ThsPlugin.Plugin.dll"), "other-plugin");

    const plan = createDeploymentPlan(
      [{ fileName: "ThsPlugin.Plugin.dll", sha256: sha256("new-plugin") }],
      pluginDirectory,
      [],
    );

    assert.equal(plan[0].action, "conflict");
    assert.match(plan[0].reason, /不属于当前安装配置/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("只允许替换登记且内容未变化的托管文件", () => {
  const root = mkdtempSync(join(tmpdir(), "tonghuasun-deployment-managed-"));
  try {
    const pluginDirectory = join(root, "PluginSdks");
    const destinationPath = join(pluginDirectory, "ThsPlugin.Plugin.dll");
    mkdirSync(pluginDirectory, { recursive: true });
    writeFileSync(destinationPath, "managed-plugin");
    const mapping = {
      fileName: "ThsPlugin.Plugin.dll",
      sourcePath: join(root, "release", "ThsPlugin.Plugin.dll"),
      destinationPath,
      sha256: sha256("managed-plugin"),
      mode: "copy",
    };

    assert.equal(createDeploymentPlan([mapping], pluginDirectory, [mapping])[0].action, "replace-managed");
    writeFileSync(destinationPath, "user-modified-plugin");
    assert.equal(createDeploymentPlan([mapping], pluginDirectory, [mapping])[0].action, "conflict");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("升级时只移除未修改的旧版托管文件", () => {
  const root = mkdtempSync(join(tmpdir(), "tonghuasun-deployment-retirement-"));
  try {
    const pluginDirectory = join(root, "PluginSdks");
    mkdirSync(pluginDirectory, { recursive: true });
    const managedPath = join(pluginDirectory, "Retired.Dependency.dll");
    const modifiedPath = join(pluginDirectory, "custom.dll");
    writeFileSync(managedPath, "old-managed");
    writeFileSync(modifiedPath, "user-modified");

    const plan = createRetirementPlan(
      [{ fileName: "ThsPlugin.Plugin.dll", sha256: sha256("new-plugin") }],
      pluginDirectory,
      [
        {
          fileName: "Retired.Dependency.dll",
          sourcePath: join(root, "release", "Retired.Dependency.dll"),
          destinationPath: managedPath,
          sha256: sha256("old-managed"),
          mode: "copy",
        },
        {
          fileName: "custom.dll",
          sourcePath: join(root, "release", "custom.dll"),
          destinationPath: modifiedPath,
          sha256: sha256("old-original"),
          mode: "copy",
        },
      ],
    );

    assert.equal(plan[0].action, "remove-managed");
    assert.equal(plan[1].action, "preserve-modified");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
