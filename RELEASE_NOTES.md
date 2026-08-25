# 0.3.0 更新说明

这是一次不兼容的 macOS 原生重构。

## 新增

- 使用同花顺 iFinD 官方 HTTP API 查询实时行情和 K 线。
- 支持 A 股、主要指数、ETF 与场内基金搜索。
- 支持 1/5/15/30/60 分钟及日/周/月 K 线。
- 支持前复权、不复权和后复权。
- 使用 macOS Keychain 保存 refresh token，使用 LaunchAgent 管理本机 Node 服务。
- Codex MCP Apps K 线图支持手动刷新、周期切换、成交量和 MA5/10/20。

## 移除

- Windows 同花顺远航版、`happ.exe` 和闭源 DLL。
- 账户、持仓、委托、成交与交易工具。
- Level-2、逐笔、订阅、新闻、公告和问财能力。
- Windows PowerShell 构建与安装链。

## 兼容性

- 版本升级为 `0.3.0`。
- 只验证 Apple Silicon macOS、Node.js 24、Codex 和 Python SDK。
- Python SDK 只保留 `search`、`snapshot`、`candles`、`records` 与 `to_dataframe`。
