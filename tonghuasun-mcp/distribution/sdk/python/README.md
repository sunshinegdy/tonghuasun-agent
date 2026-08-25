# 同花顺 iFinD macOS Python SDK

SDK 连接 `launchd` 管理的本机行情服务，不直接保存 iFinD 凭据。

## 安装

```bash
python3 -m pip install tonghuasun_codex-0.3.0-py3-none-any.whl
```

## 使用

```python
from tonghuasun_codex import Client

ths = Client.discover()

matches = ths.search("贵州茅台")
quotes = ths.snapshot(["600519.SH", "000300.SH", "510300.SH"])
daily = ths.candles("600519.SH", period="1d", adjustment="forward", limit=160)
minutes = ths.candles("510300.SH", period="5m", limit=240)

rows = Client.records(daily)
frame = Client.to_dataframe(daily)  # 需要 pandas 扩展
```

支持周期：`1m`、`5m`、`15m`、`30m`、`60m`、`1d`、`1w`、`1mo`。

支持复权：`forward`、`none`、`backward`。

SDK 不包含账户、交易、Level-2、订阅、新闻、公告或问财接口。
