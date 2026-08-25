import io
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from tonghuasun_codex import ApiError, Client, ConnectionConfig


class FakeResponse:
    status = 200

    def __init__(self, value: object) -> None:
        self.buffer = io.BytesIO(json.dumps(value).encode("utf-8"))

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self) -> bytes:
        return self.buffer.read()


class ClientTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = Client(ConnectionConfig(
            base_url="http://127.0.0.1:17180",
            access_token="local-token",
            product_home=Path("."),
        ))

    @patch("tonghuasun_codex.client.urlopen")
    def test_snapshot_uses_fixed_local_api(self, urlopen) -> None:
        urlopen.return_value = FakeResponse({
            "ok": True,
            "data": {"items": [{"security": {"fullCode": "600519.SH", "name": "贵州茅台"}, "latest": 1420}]},
        })
        value = self.client.snapshot(["贵州茅台", "000300.SH"])
        self.assertEqual(value["items"][0]["latest"], 1420)
        request = urlopen.call_args.args[0]
        self.assertEqual(request.headers["X-tonghuasun-codex-token"], "local-token")
        self.assertEqual(json.loads(request.data)["securities"], ["贵州茅台", "000300.SH"])

    @patch("tonghuasun_codex.client.urlopen")
    def test_candles_defaults_to_forward_adjusted_daily(self, urlopen) -> None:
        urlopen.return_value = FakeResponse({"ok": True, "data": {"security": {}, "bars": []}})
        self.client.candles("600519.SH")
        payload = json.loads(urlopen.call_args.args[0].data)
        self.assertEqual(payload["period"], "1d")
        self.assertEqual(payload["adjustment"], "forward")
        self.assertEqual(payload["limit"], 160)

    @patch("tonghuasun_codex.client.urlopen")
    def test_api_error_keeps_code_and_trace(self, urlopen) -> None:
        urlopen.return_value = FakeResponse({
            "ok": False,
            "traceId": "trace-1",
            "error": {"code": "quota_exceeded", "message": "额度不足。"},
        })
        with self.assertRaises(ApiError) as context:
            self.client.snapshot("600519.SH")
        self.assertEqual(context.exception.code, "quota_exceeded")
        self.assertEqual(context.exception.trace_id, "trace-1")

    def test_records_supports_quotes_and_candles(self) -> None:
        quote_records = Client.records({
            "items": [{
                "security": {"market": "SH", "code": "600519", "fullCode": "600519.SH", "name": "贵州茅台"},
                "latest": 1420,
            }],
        })
        self.assertEqual(quote_records[0]["securityName"], "贵州茅台")
        self.assertEqual(quote_records[0]["latest"], 1420)

        candle_records = Client.records({
            "security": {"market": "SH", "code": "600519", "fullCode": "600519.SH", "name": "贵州茅台"},
            "bars": [{"timestampUtc": "2026-08-25T07:00:00Z", "close": 1420}],
        })
        self.assertEqual(candle_records[0]["fullCode"], "600519.SH")
        self.assertEqual(candle_records[0]["close"], 1420)


if __name__ == "__main__":
    unittest.main()
