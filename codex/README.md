# 在 Codex 中使用同花顺 iFinD 行情

本插件仅支持 macOS，提供证券搜索、实时行情和 K 线，不提供账户或交易能力。

## 安装

1. 运行 `node Build-Distribution.mjs`。
2. 在 Codex Plugins 页面安装 `artifacts/tonghuasun-agent-codex-macos-0.3.0.zip`。
3. 新建任务并让 Codex“配置同花顺插件”。
4. macOS 钥匙串提示时输入自己的 iFinD refresh token。
5. 配置完成后新建任务以加载四个行情工具。

## 手工检查

```bash
node scripts/configure.mjs configure --check --json
node scripts/configure.mjs configure --json
node scripts/configure.mjs status --json
```

不要在命令行参数、聊天或文件中粘贴 refresh token；配置器会让 macOS `security` 命令直接隐藏输入。

## 使用示例

- `查看贵州茅台和沪深300的最新行情。`
- `显示 600519.SH 最近160个交易日的前复权日K线。`
- `查看 510300.SH 最近一周的5分钟K线。`

项目不是同花顺官方产品，数据权限和额度取决于用户自己的 iFinD 账号。
