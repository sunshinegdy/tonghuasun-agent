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

test("配置器支持显式轮换本机访问令牌", () => {
  const script = readFileSync(resolve("..", "distribution", "scripts", "configure.mjs"), "utf8");
  assert.match(script, /--rotate-token/);
  assert.match(script, /localAccessTokenRotated/);
});

test("MCP 传输桥从本机产品配置发现端点和令牌", () => {
  const script = readFileSync(resolve("..", "distribution", "scripts", "tonghuasun-mcp-proxy.mjs"), "utf8");
  assert.match(script, /TonghuasunCodex/);
  assert.match(script, /endpoint\.json/);
  assert.match(script, /localAccessToken/);
  assert.doesNotMatch(script, /CONFIGURE_REQUIRED/);
});
