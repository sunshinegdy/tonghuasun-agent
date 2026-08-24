import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const adapterRoot = resolve("..", "..", "openclaw");

test("OpenClaw 使用 Agent Plugins 1.0.0 清单", () => {
  const manifest = JSON.parse(readFileSync(resolve(adapterRoot, "plugin.json"), "utf8"));

  assert.equal(
    manifest.$schema,
    "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  );
  assert.equal(manifest.name, "tonghuasun-agent");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(
    Object.keys(manifest).sort(),
    [
      "$schema",
      "author",
      "description",
      "homepage",
      "keywords",
      "license",
      "name",
      "repository",
      "version",
    ].sort(),
  );
});

test("OpenClaw MCP 仅使用标准 PLUGIN_ROOT 变量", () => {
  const mcpText = readFileSync(resolve(adapterRoot, "mcp.json"), "utf8");
  const mcp = JSON.parse(mcpText);
  const server = mcp.mcpServers.tonghuasun;

  assert.equal(mcp.$schema, "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
  assert.deepEqual(Object.keys(mcp).sort(), ["$schema", "mcpServers"]);
  assert.deepEqual(Object.keys(mcp.mcpServers), ["tonghuasun"]);
  assert.deepEqual(Object.keys(server).sort(), ["args", "command", "cwd", "type"]);
  assert.equal(server.type, "stdio");
  assert.equal(server.command, "node");
  assert.deepEqual(server.args, ["${PLUGIN_ROOT}/scripts/tonghuasun-mcp-proxy.mjs"]);
  assert.equal(server.cwd, "${PLUGIN_ROOT}");
  assert.doesNotMatch(mcpText, /\$\{(?:CLAUDE|CODEBUDDY|CODEX|ZCODE)_PLUGIN_ROOT\}/);
});

test("OpenClaw 入口不混入会改变插件识别优先级的清单", () => {
  for (const path of [
    "openclaw.plugin.json",
    ".mcp.json",
    ".codex-plugin",
    ".claude-plugin",
    ".codebuddy-plugin",
    ".zcode-plugin",
  ]) {
    assert.equal(existsSync(resolve(adapterRoot, path)), false, path);
  }
});
