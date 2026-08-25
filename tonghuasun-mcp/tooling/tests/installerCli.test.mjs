import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const installerPath = resolve("..", "distribution", "scripts", "configure.mjs");

test("macOS 配置预检不写本机状态也不输出凭据", () => {
  const root = mkdtempSync(join(tmpdir(), "tonghuasun-installer-check-"));
  try {
    const result = run(["configure", "--check", "--json"], root);
    assert.equal(result.status, 0, result.stderr);
    const body = JSON.parse(result.stdout);
    assert.equal(body.ok, true);
    assert.equal(body.check, true);
    assert.equal(body.platform, "darwin");
    assert.ok(!result.stdout.includes("localAccessToken"));
    assert.ok(!result.stdout.includes("refresh_token"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("status 在未配置时返回安全的只读状态", () => {
  const root = mkdtempSync(join(tmpdir(), "tonghuasun-installer-status-"));
  try {
    const result = run(["status", "--json"], root);
    assert.equal(result.status, 0, result.stderr);
    const body = JSON.parse(result.stdout);
    assert.equal(body.configured, false);
    assert.equal(body.running, false);
    assert.ok(!result.stdout.includes("localAccessToken"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function run(args, home) {
  return spawnSync(process.execPath, [installerPath, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, TONGHUASUN_AGENT_HOME: home },
    encoding: "utf8",
  });
}
