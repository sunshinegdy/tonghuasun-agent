# 隐私政策

更新日期：2026 年 8 月 25 日

本政策说明 tonghuasun-agent `0.3.0` 如何处理数据。项目不是同花顺官方产品。

## 本机数据

项目在 `~/Library/Application Support/TonghuasunAgent` 保存端口、本机随机访问令牌、
运行端点、版本化服务和证券名称缓存。本机 REST 与 MCP 服务只监听回环地址。

iFinD refresh token 存放在 macOS Keychain，不写入项目配置、日志或发行包。iFinD
access token 只在行情服务内存中缓存。普通卸载保留钥匙串和证券目录缓存，用户选择
`uninstall --purge` 时才清理全部本机数据。

## 网络传输

用户查询证券、实时行情或 K 线时，本机服务向 `https://quantapi.51ifind.com` 发送
证券代码、指标、周期和时间范围，并使用用户自己的 iFinD 权限鉴权。项目不提供账户、
持仓或交易功能。

Codex 或其他模型服务如何处理用户输入和工具返回值，由相应服务的隐私政策约束。

## 日志与安全

日志可以记录版本、端口、错误类别和不含凭据的诊断信息，不应记录 refresh token、
access token 或本机随机访问令牌。任何系统都不能保证绝对安全。

安全问题请通过 [GitHub 私密安全报告](https://github.com/zhuyifang/tonghuasun-agent/security/advisories/new) 提交。
