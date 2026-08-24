# tonghuasun-agent

让 Codex、Claude Code、WorkBuddy 和 DeepSeek Harness 使用你电脑上的同花顺。

## 开始使用

- [Codex 安装说明](./codex/README.md)
- [Claude Code 安装说明](./claude-code/README.md)
- [WorkBuddy 安装说明](./workbuddy/README.md)
- [DeepSeek Harness 安装说明](./deepseek-harness/README.md)

## 可以做什么

- 查询证券资料、行情和 K 线
- 查看账户、持仓、委托与成交信息
- 接收实时行情并使用盯盘界面
- 在明确开启后使用交易工具

四个 Agent 入口连接同一个本机同花顺服务，功能与本机配置保持一致。

## 使用要求

- Windows 10 或 Windows 11
- 已安装同花顺远航版
- 使用实时行情、账户或交易功能时，同花顺需要保持登录并正常运行

交易工具默认关闭。启用后，下单、撤单和改单仍需用户确认。项目不会把本机
访问令牌写入公开仓库或发行模板。

## 项目结构

```text
tonghuasun-agent/
  codex/               # Codex 插件
  claude-code/         # Claude Code 插件
  workbuddy/           # WorkBuddy 插件
  deepseek-harness/    # DeepSeek Harness 插件
  tonghuasun-mcp/      # 同花顺本机服务、配置器和 SDK
  docs/                # 架构文档
  Build-Distribution.ps1
```

## 构建发行包

在 Windows PowerShell 中执行：

```powershell
.\Build-Distribution.ps1
```

构建完成后，`artifacts/` 中会生成 Codex、Claude Code、WorkBuddy 和 DeepSeek Harness 的安装包。

## 支持项目

<p align="center">
  <a href="./assets/support/support-banner.png">
    <img src="./assets/support/support-banner.png" alt="如果这个项目对你有帮助，欢迎打赏支持" width="100%">
  </a>
</p>

如果这个项目对你有帮助，欢迎打赏支持。打赏完全自愿，不影响项目功能、
许可证或问题反馈的处理。

## 许可证

本项目为独立开发项目，不是同花顺官方产品。Agent 入口、配置器、传输桥和 SDK
依据 AGPL-3.0-only 开源；C# 开发的同花顺本机插件暂时闭源。完整说明见
[`tonghuasun-mcp/legal`](./tonghuasun-mcp/legal/)。
