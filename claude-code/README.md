# 在 Claude Code 中使用同花顺

## 安装

在 Claude Code 中执行：

```text
/plugin marketplace add zhuyifang/tonghuasun-agent
/plugin install tonghuasun-agent@tonghuasun-agent
/reload-plugins
```

安装后让 Claude Code“配置同花顺插件”，按提示选择同花顺安装目录。
配置完成后重启同花顺，再在 Claude Code 中执行 `/reload-plugins`。

## 开始使用

可以直接这样提问：

- `查看贵州茅台最近 60 个交易日的日 K 线。`
- `汇总我的账户资产和持仓。`
- `持续盯盘 600519.SH 的逐笔成交。`

## 安全说明

交易工具默认关闭。启用后，下单、撤单和改单仍需用户确认；只查询行情或账户
信息不会触发交易操作。

本项目不是同花顺官方产品。
