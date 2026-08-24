import assert from "node:assert/strict";
import test from "node:test";
import {
  appendStructuredContentTextFallback,
  isStructuredContentTextCompatibilityEnabled,
} from "../dist/toolResultCompatibility.js";

test("仅在 WorkBuddy 显式开启时追加 structuredContent 文本", () => {
  const result = {
    content: [{ type: "text", text: "找到 1 个证券候选项。" }],
    structuredContent: {
      totalCount: 1,
      items: [{ fullCode: "600519.SH", name: "贵州茅台" }],
    },
  };

  assert.equal(appendStructuredContentTextFallback(result, false), result);

  const compatible = appendStructuredContentTextFallback(result, true);
  assert.notEqual(compatible, result);
  assert.equal(compatible.content.length, 2);
  assert.equal(compatible.content[0].text, "找到 1 个证券候选项。");
  assert.match(compatible.content[1].text, /^同花顺结构化结果\(JSON\)：\n/);
  assert.match(compatible.content[1].text, /600519\.SH/);
  assert.deepEqual(compatible.structuredContent, result.structuredContent);
});

test("兼容文本追加操作可重复执行而不会产生重复块", () => {
  const initial = {
    content: [],
    structuredContent: { ok: true },
  };
  const once = appendStructuredContentTextFallback(initial, true);
  const twice = appendStructuredContentTextFallback(once, true);

  assert.equal(twice, once);
  assert.equal(twice.content.length, 1);
});

test("识别 WorkBuddy MCP 文本兼容开关", () => {
  for (const value of ["1", "true", "TRUE", "structured-json", " structured-json "]) {
    assert.equal(isStructuredContentTextCompatibilityEnabled(value), true);
  }
  for (const value of [undefined, "", "0", "false", "structured"] ) {
    assert.equal(isStructuredContentTextCompatibilityEnabled(value), false);
  }
});
