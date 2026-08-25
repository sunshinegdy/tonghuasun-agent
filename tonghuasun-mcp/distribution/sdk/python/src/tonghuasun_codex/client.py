from __future__ import annotations

import json
from typing import Any, Literal, Mapping, Sequence
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .discovery import ConnectionConfig, discover_connection
from .errors import ApiError

SecurityType = Literal["stock", "index", "etf", "fund"]
CandlePeriod = Literal["1m", "5m", "15m", "30m", "60m", "1d", "1w", "1mo"]
Adjustment = Literal["forward", "none", "backward"]


class Client:
    def __init__(self, connection: ConnectionConfig, *, timeout: float = 30.0) -> None:
        self.connection = connection
        self.timeout = timeout

    @classmethod
    def discover(
        cls,
        product_home: str | None = None,
        *,
        timeout: float = 30.0,
    ) -> "Client":
        return cls(discover_connection(product_home), timeout=timeout)

    def request(
        self,
        method: str,
        path: str,
        payload: Mapping[str, Any] | None = None,
        *,
        unwrap: bool = True,
    ) -> Any:
        body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = Request(
            self.connection.base_url + "/" + path.lstrip("/"),
            data=body,
            method=method.upper(),
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "X-Tonghuasun-Codex-Token": self.connection.access_token,
                "User-Agent": "tonghuasun-codex-python/0.3.0",
            },
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                status = response.status
                raw = response.read()
        except HTTPError as error:
            raw = error.read()
            self._raise_api_error(raw, status=error.code, fallback=str(error))
        except URLError as error:
            raise ApiError(
                f"无法连接 macOS 同花顺行情服务：{error.reason}",
                code="connection_error",
            ) from error

        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ApiError("本机行情服务返回了无法解析的 JSON。", code="invalid_response", status=status) from error
        if not isinstance(value, dict):
            return value
        if value.get("ok") is False:
            self._raise_envelope_error(value, status=status)
        return value.get("data") if unwrap and "data" in value else value

    def health(self) -> dict[str, Any]:
        return self.request("GET", "/health")

    def catalog(self) -> dict[str, Any]:
        return self.request("GET", "/catalog")

    def search(
        self,
        query: str,
        *,
        types: Sequence[SecurityType] | None = None,
        limit: int = 10,
    ) -> dict[str, Any]:
        return self.request(
            "POST",
            "/api/v2/securities/search",
            {"query": query, "types": list(types or []), "limit": limit},
        )

    def snapshot(self, securities: str | Sequence[str]) -> dict[str, Any]:
        return self.request(
            "POST",
            "/api/v2/quotes/snapshot",
            {"securities": [securities] if isinstance(securities, str) else list(securities)},
        )

    def candles(
        self,
        security: str,
        *,
        period: CandlePeriod = "1d",
        adjustment: Adjustment = "forward",
        start: str | None = None,
        end: str | None = None,
        limit: int = 160,
    ) -> dict[str, Any]:
        return self.request(
            "POST",
            "/api/v2/quotes/candle",
            {
                "security": security,
                "period": period,
                "adjustment": adjustment,
                "start": start,
                "end": end,
                "limit": limit,
            },
        )

    @staticmethod
    def records(response_data: Mapping[str, Any]) -> list[dict[str, Any]]:
        security = response_data.get("security")
        security_values = security if isinstance(security, dict) else {}
        bars = response_data.get("bars")
        if isinstance(bars, list):
            return [
                {
                    "market": security_values.get("market"),
                    "code": security_values.get("code"),
                    "fullCode": security_values.get("fullCode"),
                    "securityName": security_values.get("name"),
                    **bar,
                }
                for bar in bars
                if isinstance(bar, dict)
            ]

        items = response_data.get("items")
        if not isinstance(items, list):
            return []
        records: list[dict[str, Any]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            item_security = item.get("security") if isinstance(item.get("security"), dict) else {}
            records.append(
                {
                    "market": item_security.get("market"),
                    "code": item_security.get("code"),
                    "fullCode": item_security.get("fullCode"),
                    "securityName": item_security.get("name"),
                    **{key: value for key, value in item.items() if key != "security"},
                }
            )
        return records

    @staticmethod
    def to_dataframe(response_data: Mapping[str, Any]):
        try:
            import pandas as pd
        except ImportError as error:
            raise RuntimeError('请先安装 pandas 扩展：pip install "tonghuasun-codex[pandas]"') from error
        return pd.DataFrame(Client.records(response_data))

    @staticmethod
    def _raise_api_error(raw: bytes, *, status: int, fallback: str) -> None:
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ApiError(fallback, status=status) from None
        if isinstance(value, dict):
            Client._raise_envelope_error(value, status=status)
        raise ApiError(fallback, status=status)

    @staticmethod
    def _raise_envelope_error(value: Mapping[str, Any], *, status: int) -> None:
        error = value.get("error")
        details = error if isinstance(error, dict) else {}
        code = str(details.get("code") or error or "api_error")
        message = str(details.get("message") or value.get("message") or "同花顺行情请求失败。")
        raise ApiError(
            message,
            code=code,
            status=status,
            trace_id=str(value.get("traceId") or ""),
            details=details.get("details") if details else dict(value),
        )
