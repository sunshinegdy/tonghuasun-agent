---
name: configure-ths
description: 在 macOS 上配置、检查、修复或卸载 tonghuasun-agent 的 iFinD 行情服务。用户提到首次安装、refresh token、MCP 连接失败、端口冲突、服务状态、修复或卸载时使用。
---

# 配置 macOS 同花顺行情服务

插件根目录是本 `SKILL.md` 所在目录向上两级。配置器位于插件根目录的 `scripts/configure.mjs`。

## 工作流

1. 先执行只读预检：

   ```bash
   node <插件根目录>/scripts/configure.mjs configure --check --json
   ```

2. 首次配置执行：

   ```bash
   node <插件根目录>/scripts/configure.mjs configure --json
   ```

   macOS 钥匙串会在终端中隐藏输入 iFinD refresh token。不得要求用户把 token 发到聊天、写入命令行参数或配置文件。

3. 配置后检查：

   ```bash
   node <插件根目录>/scripts/configure.mjs status --json
   ```

   确认 `configured=true`、`running=true`、`keychainConfigured=true` 和 `endpointPublished=true`。

4. 服务异常时执行 `repair --json`；如果 Node.js 路径因 nvm 升级而变化，也用 repair 重写 LaunchAgent。

## 卸载

- 普通卸载保留钥匙串凭据和证券目录缓存：

  ```bash
  node <插件根目录>/scripts/configure.mjs uninstall --json
  ```

- 只有用户明确要求清除全部本机数据时才使用：

  ```bash
  node <插件根目录>/scripts/configure.mjs uninstall --purge --json
  ```

## 能力边界

- 只提供证券搜索、按需实时行情和 K 线。
- 不提供账户、持仓、委托、交易、Level-2、逐笔、新闻、公告或问财工具。
- 行情来自用户自己的 iFinD HTTP API 权限，额度或权限错误应原样解释，不得改用爬虫或其他数据源。
