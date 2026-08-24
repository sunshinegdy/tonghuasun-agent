import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const adapterRoot = resolve("..", "..", "workbuddy");

test("WorkBuddy 使用原生插件清单和 MCP 根变量", () => {
  const manifestPath = resolve(adapterRoot, ".codebuddy-plugin", "plugin.json");
  const mcpPath = resolve(adapterRoot, ".mcp.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const mcpText = readFileSync(mcpPath, "utf8");

  assert.equal(manifest.name, "tonghuasun-agent");
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.match(mcpText, /\$\{CODEBUDDY_PLUGIN_ROOT\}/);
  assert.match(mcpText, /TONGHUASUN_MCP_TEXT_COMPATIBILITY/);
  assert.doesNotMatch(mcpText, /\$\{(?:CLAUDE_)?PLUGIN_ROOT\}/);
});

test("WorkBuddy 入口不保留旧的根级清单", () => {
  assert.equal(existsSync(resolve(adapterRoot, "plugin.json")), false);
  assert.equal(existsSync(resolve(adapterRoot, "mcp.json")), false);
});
