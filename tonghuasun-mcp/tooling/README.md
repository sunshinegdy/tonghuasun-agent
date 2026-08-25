# macOS iFinD 行情服务构建工具

## 构建与测试

```bash
npm install
npm test
```

构建输出：

- `distribution/scripts/configure.mjs`
- `distribution/scripts/market-server.mjs`
- `distribution/scripts/tonghuasun-mcp-proxy.mjs`
- `distribution/ui/candle-chart.html`

## 完整发行

```bash
npm run build:release
```

该命令执行 Node 测试、Codex ZIP 打包和 Python wheel 构建，并输出每个产物的 SHA-256。

## 配置预检

```bash
node ../distribution/scripts/configure.mjs configure --check --json
```

预检不会写配置、钥匙串或 LaunchAgent。
