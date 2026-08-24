# 同花顺 MCP 构建工具

本目录用于构建安装配置器、MCP 传输桥和交互界面资源。本机 MCP 服务由加载进
`happ.exe` 的同花顺插件提供，不需要单独启动 Node.js 服务。

## 构建与测试

```powershell
cd .\tonghuasun-mcp\tooling
npm install
npm test
```

构建结果会写入：

- `tonghuasun-mcp/distribution/scripts/`
- `tonghuasun-mcp/distribution/ui/`

## 端口和访问令牌

配置器会把首选端口和随机生成的本机访问令牌保存在
`%LOCALAPPDATA%\TonghuasunCodex`。不要手工复制、公开或提交访问令牌。

修改端口或更新插件后，需要重启同花顺，并在 Agent 中新建任务或会话。

## 交易工具

交易工具默认关闭。只有用户明确需要时才应开启；启用后仍需完成界面确认和
同花顺桌面确认。
