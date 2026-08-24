# 第三方组件声明

本项目使用但不取得下列第三方项目的所有权。再分发构建产物时必须保留其许可证
和适用的版权声明。

| 组件 | 用途 | 许可证 | 来源 |
|---|---|---|---|
| Lightweight Charts 5.2.1 | K 线和行情图表 | Apache-2.0 | https://github.com/tradingview/lightweight-charts |
| TradingView fancy-canvas | 图表画布依赖 | MIT | https://github.com/tradingview/fancy-canvas |
| esbuild | 前端与配置器构建 | MIT | https://github.com/evanw/esbuild |
| TypeScript | TypeScript 编译器 | Apache-2.0 | https://github.com/microsoft/TypeScript |
| node-postgres (`pg`) | PostgreSQL 客户端 | MIT | https://github.com/brianc/node-postgres |
| Npgsql 7.0.7 | 原生组件的 PostgreSQL 客户端 | PostgreSQL | https://github.com/npgsql/npgsql |
| Microsoft.Extensions.Logging.Abstractions 6.0.0 | 日志抽象 | MIT | https://github.com/dotnet/runtime |
| System.Runtime.CompilerServices.Unsafe 6.0.0 | .NET 运行支持 | MIT | https://github.com/dotnet/runtime |

Node.js 与 Python 的完整传递依赖及版本以各模块锁文件为准。官方发行流水线应生成
依赖物料清单，并把实际随包分发组件的许可证文本一并归档。
