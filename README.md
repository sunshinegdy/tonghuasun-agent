# 同花顺 Agent for macOS

这是一个独立开发项目，不是同花顺官方产品。

版本 `0.3.0` 在 macOS 上通过用户自己的同花顺 iFinD HTTP API 权限，为 Codex 和 Python 提供：

- A 股、主要指数、ETF 和场内基金搜索；
- 按需实时行情；
- 1/5/15/30/60 分钟及日/周/月 K 线；
- 前复权、不复权和后复权；
- K 线、成交量和 MA5/10/20 交互图表。

项目不提供账户、持仓、委托、成交、交易、Level-2、逐笔、新闻、公告或问财能力。

## 环境要求

- Apple Silicon Mac；当前开发环境为 macOS 26.5.2。
- Node.js 24 或更高版本。
- iFinD 数据接口账号和 refresh token。macOS 可以使用 iFinD HTTP API，不需要 Windows 客户端。
- Codex 桌面版；Python SDK 需要 Python 3.10 或更高版本。

iFinD refresh token 可在[网页版超级命令](https://quantapi.10jqka.com.cn/gwstatic/static/ds_web/super-command-web/index.html#/AccountDetails)的账号详情中获取。不要把 token 提交到仓库、Issue 或聊天。

## 构建

```bash
cd tonghuasun-mcp/tooling
npm install
npm test
cd ../..
node Build-Distribution.mjs
```

产物：

```text
artifacts/
├── tonghuasun-agent-codex-macos-0.3.0.zip
└── tonghuasun_codex-0.3.0-py3-none-any.whl
```

## 配置

安装 Codex ZIP 后，在插件目录运行：

```bash
node scripts/configure.mjs configure --check --json
node scripts/configure.mjs configure --json
node scripts/configure.mjs status --json
```

首次配置时，macOS 钥匙串会隐藏输入 refresh token。配置器不会把 refresh token 写入命令行、配置文件或发行包。

## 使用示例

- “查看贵州茅台、沪深300和沪深300ETF的最新行情。”
- “显示贵州茅台最近 160 个交易日的前复权日 K 线。”
- “查看 510300.SH 最近 5 个交易日的 5 分钟 K 线。”
- “搜索名称中包含新能源的 A 股和 ETF。”

Python：

```python
from tonghuasun_codex import Client

ths = Client.discover()
print(ths.snapshot(["贵州茅台", "000300.SH", "510300.SH"]))
print(ths.candles("600519.SH", period="1d", adjustment="forward", limit=160))
```

## 本机数据

Node 行情服务由 `launchd` 管理，只监听 `127.0.0.1:17180`。本机配置位于：

```text
~/Library/Application Support/TonghuasunAgent/
```

refresh token 存在 macOS Keychain；本机服务使用独立随机访问令牌保护 REST/MCP 接口。

## 其他 Agent

仓库暂时保留 Claude Code、WorkBuddy、ZCode、OpenClaw 和 DeepSeek Harness 的旧适配源码，但 `0.3.0` 不构建、不测试也不发布这些入口。

## 许可

公开源码采用 AGPL-3.0-only。行情数据和 API 权限仍受同花顺 iFinD、交易所及用户账号协议约束。详情见 [`tonghuasun-mcp/legal`](./tonghuasun-mcp/legal/)。
