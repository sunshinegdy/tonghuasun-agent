import assert from "node:assert/strict";
import test from "node:test";
import { IfindClient, flattenIfindRows } from "../dist/ifindClient.js";

test("展开 iFinD 列式 tables 响应", () => {
  const rows = flattenIfindRows({
    errorcode: 0,
    tables: [{
      thscode: "600519.SH",
      time: ["2026-08-24", "2026-08-25"],
      table: { open: [1400, 1410], close: [1415, 1420] },
    }],
  });
  assert.deepEqual(rows, [
    { thscode: "600519.SH", time: "2026-08-24", open: 1400, close: 1415 },
    { thscode: "600519.SH", time: "2026-08-25", open: 1410, close: 1420 },
  ]);
});

test("鉴权失败时仅刷新一次 access token 且不会暴露 refresh token", async () => {
  const calls = [];
  const responses = [
    { access_token: "access-one" },
    { errorcode: -101, errmsg: "token invalid" },
    { access_token: "access-two" },
    { errorcode: 0, tables: [] },
  ];
  const client = new IfindClient({
    readRefreshToken: () => "refresh-secret",
    now: () => 1_000,
    sleep: async () => {},
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), headers: init.headers, body: init.body });
      return new Response(JSON.stringify(responses.shift()), { status: 200 });
    },
  });

  await client.realtimeQuotes(["600519.SH"]);
  assert.equal(calls.length, 4);
  assert.equal(calls[0].headers.refresh_token, "refresh-secret");
  assert.equal(calls[1].headers.access_token, "access-one");
  assert.equal(calls[2].headers.refresh_token, "refresh-secret");
  assert.equal(calls[3].headers.access_token, "access-two");
  assert.ok(calls.every(call => !String(call.body).includes("refresh-secret")));
});
