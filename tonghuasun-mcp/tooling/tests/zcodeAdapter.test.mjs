import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const adapterRoot = resolve("..", "..", "zcode");

test("ZCode 使用原生插件清单和 MCP 根变量", () => {
  const manifestPath = resolve(adapterRoot, ".zcode-plugin", "plugin.json");
  const mcpPath = resolve(adapterRoot, ".mcp.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const mcpText = readFileSync(mcpPath, "utf8");

  assert.equal(manifest.name, "tonghuasun-agent");
  assert.equal(manifest.skills, "skills");
  assert.equal(manifest.mcpServers, ".mcp.json");
  assert.match(mcpText, /\$\{ZCODE_PLUGIN_ROOT\}/);
  assert.doesNotMatch(mcpText, /\$\{(?:CLAUDE|CODEBUDDY|CODEX)_PLUGIN_ROOT\}/);
});

test("ZCode 入口不混入其他宿主清单", () => {
  assert.equal(existsSync(resolve(adapterRoot, ".codex-plugin")), false);
  assert.equal(existsSync(resolve(adapterRoot, ".claude-plugin")), false);
  assert.equal(existsSync(resolve(adapterRoot, ".codebuddy-plugin")), false);
});
