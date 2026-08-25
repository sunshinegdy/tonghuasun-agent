# macOS 同花顺 iFinD 行情服务

本目录包含 `0.3.0` 的 Node 行情服务、配置器、MCP 代理、K 线组件和 Python SDK。

## 本机接口

- MCP：`http://127.0.0.1:17180/mcp`
- REST 健康检查：`http://127.0.0.1:17180/health`
- REST 目录：`http://127.0.0.1:17180/catalog`
- REST 行情：`/api/v2/quotes/snapshot`
- REST K线：`/api/v2/quotes/candle`

除健康检查外，接口都需要本机随机访问令牌。Python SDK 和 Codex 代理自动读取令牌，不要手工复制或公开。

## 目录

- `tooling/`：TypeScript 源码、构建与测试。
- `distribution/`：构建后的脚本、UI、技能和 Python SDK。
- `legal/`：许可、隐私和第三方声明。
