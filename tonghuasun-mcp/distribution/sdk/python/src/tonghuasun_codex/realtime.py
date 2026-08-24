from __future__ import annotations

import inspect
import json
import uuid
from collections.abc import AsyncIterator, Sequence
from typing import Any

from .discovery import ConnectionConfig, discover_connection
from .errors import RealtimeError


class RealtimeClient:
    def __init__(self, connection: ConnectionConfig) -> None:
        self.connection = connection

    @classmethod
    def discover(cls, product_home: str | None = None) -> "RealtimeClient":
        return cls(discover_connection(product_home))

    async def stream(
        self,
        codes: Sequence[str],
        *,
        kind: str = "realtime",
        market: str = "cn-a",
        fields: Sequence[str] | None = None,
        max_items: int = 100,
        wait_timeout_ms: int = 15_000,
        heartbeat_ms: int = 15_000,
    ) -> AsyncIterator[dict[str, Any]]:
        try:
            import websockets
        except ImportError as error:
            raise RealtimeError(
                '实时订阅需要安装可选依赖：pip install "tonghuasun-codex[realtime]"',
                code="missing_dependency",
            ) from error

        normalized_codes = [code.strip() for code in codes if code.strip()]
        if not normalized_codes:
            raise ValueError("codes 不能为空。")

        request_id = uuid.uuid4().hex
        headers = {"X-Tonghuasun-Codex-Token": self.connection.access_token}
        connect_parameters = inspect.signature(websockets.connect).parameters
        header_name = "additional_headers" if "additional_headers" in connect_parameters else "extra_headers"

        async with websockets.connect(
            self.connection.websocket_url,
            **{header_name: headers},
        ) as socket:
            await socket.send(
                json.dumps(
                    {
                        "action": "subscribe",
                        "requestId": request_id,
                        "kind": kind,
                        "market": market,
                        "codes": normalized_codes,
                        "fields": list(fields or []),
                        "maxItems": max_items,
                        "waitTimeoutMs": wait_timeout_ms,
                        "heartbeatMs": heartbeat_ms,
                    },
                    ensure_ascii=False,
                )
            )

            try:
                async for raw_message in socket:
                    message = json.loads(raw_message)
                    if not isinstance(message, dict):
                        continue
                    if message.get("type") == "error":
                        raise RealtimeError(
                            str(message.get("message") or "同花顺实时订阅失败。"),
                            code=str(message.get("code") or "realtime_error"),
                        )
                    if message.get("type") == "data":
                        yield message
            finally:
                if socket.close_code is None:
                    await socket.send(
                        json.dumps(
                            {"action": "close", "requestId": uuid.uuid4().hex},
                            ensure_ascii=False,
                        )
                    )
