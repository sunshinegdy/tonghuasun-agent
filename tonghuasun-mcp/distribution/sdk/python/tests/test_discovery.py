import json
import tempfile
import unittest
from pathlib import Path

from tonghuasun_codex.discovery import discover_connection


class DiscoveryTests(unittest.TestCase):
    def test_prefers_runtime_endpoint_and_reads_local_token(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            (home / "runtime").mkdir()
            (home / "config.json").write_text(
                json.dumps({"preferredPort": 17180, "localAccessToken": "secret"}),
                encoding="utf-8",
            )
            (home / "runtime" / "endpoint.json").write_text(
                json.dumps(
                    {
                        "baseUrl": "http://127.0.0.1:17200",
                        "pluginVersion": "1.2.3",
                        "processId": 1234,
                    }
                ),
                encoding="utf-8",
            )

            connection = discover_connection(home)

        self.assertEqual(connection.base_url, "http://127.0.0.1:17200")
        self.assertEqual(connection.websocket_url, "ws://127.0.0.1:17200/api/v2/realtime/ws")
        self.assertEqual(connection.access_token, "secret")
        self.assertEqual(connection.process_id, 1234)


if __name__ == "__main__":
    unittest.main()
