---
name: configure-ths
description: 配置、检查、修复或卸载 tonghuasun-agent 的本地同花顺插件映射与 MCP 端点。适用于 Codex、Claude Code、WorkBuddy 和 DeepSeek Harness。用户提到首次安装、同花顺安装路径、MCP 连接失败、端口冲突、插件升级、修复映射或卸载时使用。
---

# 配置同花顺

插件根目录是本 `SKILL.md` 所在目录向上两级。配置器位于插件根目录的 `scripts/configure.mjs`。

## 工作流

1. 先执行只读检查：

   ```powershell
   node <插件根目录>\scripts\configure.mjs status --json
   ```

2. 首次配置或修复时，确认同花顺已经正常退出，再执行：

   ```powershell
   node <插件根目录>\scripts\configure.mjs configure --json
   ```

3. 如果自动检测失败，只询问用户同花顺安装目录，然后执行：

   ```powershell
   node <插件根目录>\scripts\configure.mjs configure --ths-path "<安装目录>" --json
   ```

4. 配置完成后请用户启动同花顺。再次执行 `status --json`，确认 `endpointPublished=true`、端点端口与 `mcpUrl` 一致且映射全部健康。
5. 验证成功后，根据 `startupGuide` 用简短中文介绍 MCP、REST API、OpenAPI 和实时 WebSocket 的用途与地址。说明这些入口只监听本机且需要本机访问令牌，但不要输出令牌。

## 交易工具总开关

- 交易 MCP 工具默认关闭。只有用户明确要求启用下单、撤单、改单或账户切换时，才在宿主正常退出后执行：

  ```powershell
  node <插件根目录>\scripts\configure.mjs configure --enable-trade-tools true --json
  ```

- 用户要求停用交易能力时执行同一命令并传入 `false`。
- `status --json` 的 `config.enableTradeTools` 用于核对当前状态；不要直接编辑产品配置文件。
- 开启总开关不等于授权某笔交易。每笔交易仍必须经过 MCP App 预览、一次性凭证和同花顺桌面原生最终确认。
- 自动化 REST 交易写接口由独立开关控制，默认保持关闭。只有用户明确要求无人值守 REST 交易并理解风险时，才传入 `--enable-automated-trade-api true`；启用 MCP 交易工具时不要顺带开启它。

## 操作约束

- 不强制结束 `happ.exe`；检测到宿主运行时，让用户先正常退出。
- 默认使用 `--mode auto`：优先创建逐文件符号链接；权限不足时自动降级为受控复制。
- 默认固定使用 `17180`。端口冲突时先查明占用者；用户选择其他端口后通过 `--port` 修改。配置器会同步运行时配置和插件 `.mcp.json`，同花顺插件不会静默漂移端口。
- 用户要求卸载时先执行状态检查，再运行 `uninstall --json`。卸载器只移除可确认由本插件管理的文件，并保留版本目录以便恢复。
- 不直接编辑 `%LOCALAPPDATA%\TonghuasunCodex\config.json`，统一通过配置器变更。
