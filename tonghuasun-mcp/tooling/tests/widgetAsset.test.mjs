import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const widgetPath = resolve("..", "distribution", "ui", "candle-chart.html");

test("K 线组件构建为自包含 HTML", () => {
  const html = readFileSync(widgetPath, "utf8");
  assert.match(html, /同花顺 K 线/);
  assert.match(html, /ths_chart_candle_data/);
  assert.doesNotMatch(html, /__WIDGET_(CSS|SCRIPT)__/);
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.doesNotMatch(html, /<(?:script|link)[^>]+(?:src|href)=["']https?:/i);
});

test("配置器使用 macOS Keychain 并包含本机市场服务", () => {
  const script = readFileSync(resolve("..", "distribution", "scripts", "configure.mjs"), "utf8");
  assert.match(script, /com\.tonghuasun-agent\.ifind\.refresh-token/);
  assert.match(script, /market-server\.mjs/);
  assert.doesNotMatch(script, /refreshToken\s*:/);
});

test("MCP 传输桥从本机产品配置发现端点和令牌", () => {
  const script = readFileSync(resolve("..", "distribution", "scripts", "tonghuasun-mcp-proxy.mjs"), "utf8");
  assert.match(script, /Application Support/);
  assert.match(script, /endpoint\.json/);
  assert.match(script, /localAccessToken/);
  assert.doesNotMatch(script, /LOCALAPPDATA/);
  assert.doesNotMatch(script, /CONFIGURE_REQUIRED/);
});
