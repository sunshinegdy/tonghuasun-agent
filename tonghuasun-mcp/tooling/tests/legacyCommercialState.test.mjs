import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { removeLegacyCommercialState } from "../dist/legacyCommercialState.js";

test("升级时归档旧订阅状态并保留历史发布和插件缓存", () => {
  const root = mkdtempSync(join(tmpdir(), "tonghuasun-legacy-commercial-"));
  const productHome = join(root, "product");
  const pluginRoot = join(root, "plugins", "cache", "personal", "tonghuasun-codex", "0.2.4");
  const oldCache = join(root, "plugins", "cache", "personal", "tonghuasun-codex", "0.2.2");
  const restrictedRelease = join(productHome, "releases", "0.2.1", "ths-plugin");
  const cleanRelease = join(productHome, "releases", "0.2.4", "ths-plugin");
  const restrictedBackup = join(productHome, "backups", "legacy");

  try {
    mkdirSync(join(productHome, "usage"), { recursive: true });
    mkdirSync(restrictedRelease, { recursive: true });
    mkdirSync(cleanRelease, { recursive: true });
    mkdirSync(restrictedBackup, { recursive: true });
    mkdirSync(join(oldCache, "ui"), { recursive: true });
    mkdirSync(pluginRoot, { recursive: true });

    writeFileSync(join(productHome, "account.dat"), "legacy-account");
    writeFileSync(join(productHome, "entitlement.json"), "legacy-entitlement");
    writeFileSync(join(productHome, "usage", "free.json"), "legacy-quota");
    writeFileSync(join(restrictedRelease, "ThsPlugin.Plugin.dll"), "subscription_required");
    writeFileSync(join(cleanRelease, "ThsPlugin.Plugin.dll"), "需要订阅的证券代码列表");
    writeFileSync(join(restrictedBackup, "ThsPlugin.Plugin.dll"), "完整权益");
    writeFileSync(join(oldCache, "ui", "subscription-center.html"), "legacy-ui");

    const removed = removeLegacyCommercialState(productHome, pluginRoot);

    assert.equal(existsSync(join(productHome, "account.dat")), false);
    assert.equal(existsSync(join(productHome, "entitlement.json")), false);
    assert.equal(existsSync(join(productHome, "usage")), false);
    assert.equal(existsSync(join(productHome, "releases", "0.2.1")), true);
    assert.equal(existsSync(join(productHome, "backups", "legacy")), true);
    assert.equal(existsSync(oldCache), true);
    assert.equal(existsSync(cleanRelease), true);
    assert.equal(existsSync(pluginRoot), true);
    assert.equal(removed.length, 3);
    const archiveRoot = join(productHome, "legacy-state-backups");
    const archiveVersions = readdirSync(archiveRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory());
    assert.equal(archiveVersions.length, 1);
    const archivedState = join(archiveRoot, archiveVersions[0].name);
    assert.equal(existsSync(join(archivedState, "account.dat")), true);
    assert.equal(existsSync(join(archivedState, "entitlement.json")), true);
    assert.equal(existsSync(join(archivedState, "usage", "free.json")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("无条件保留本次正在部署的发布目录", () => {
  const root = mkdtempSync(join(tmpdir(), "tonghuasun-current-release-"));
  const productHome = join(root, "product");
  const currentRelease = join(productHome, "releases", "0.2.4", "ths-plugin");

  try {
    mkdirSync(currentRelease, { recursive: true });
    writeFileSync(join(currentRelease, "ThsPlugin.Plugin.dll"), "subscription_required");

    removeLegacyCommercialState(productHome, join(root, "package"), [currentRelease]);
    assert.equal(existsSync(currentRelease), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("普通目录运行配置器时不会清理相邻目录", () => {
  const root = mkdtempSync(join(tmpdir(), "tonghuasun-legacy-scope-"));
  const productHome = join(root, "product");
  const pluginRoot = join(root, "packages", "0.2.4");
  const sibling = join(root, "packages", "0.2.2");

  try {
    mkdirSync(pluginRoot, { recursive: true });
    mkdirSync(join(sibling, "ui"), { recursive: true });
    writeFileSync(join(sibling, "ui", "subscription-center.html"), "legacy-ui");

    removeLegacyCommercialState(productHome, pluginRoot);
    assert.equal(existsSync(sibling), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
