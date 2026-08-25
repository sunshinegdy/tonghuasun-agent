from __future__ import annotations

from typing import Any


class TonghuasunError(RuntimeError):
    """SDK 基础异常。"""


class ConfigurationError(TonghuasunError):
    """本机插件尚未配置或配置文件无效。"""


class ApiError(TonghuasunError):
    def __init__(
        self,
        message: str,
        *,
        code: str = "api_error",
        status: int | None = None,
        trace_id: str = "",
        details: Any = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.trace_id = trace_id
        self.details = details
