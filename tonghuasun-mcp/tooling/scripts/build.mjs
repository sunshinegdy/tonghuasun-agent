import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = resolve(projectRoot, "..", "distribution");

rmSync(resolve(projectRoot, "dist"), { recursive: true, force: true });
execFileSync(process.execPath, [resolve(projectRoot, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"], {
  cwd: projectRoot,
  stdio: "inherit",
  windowsHide: true
});

mkdirSync(resolve(pluginRoot, "scripts"), { recursive: true });
mkdirSync(resolve(pluginRoot, "ui"), { recursive: true });
rmSync(resolve(pluginRoot, "mcp"), { recursive: true, force: true });

await buildCandleChartWidget();
await bundle("src/installer.ts", resolve(pluginRoot, "scripts", "configure.mjs"));
await bundle("src/mcpProxy.ts", resolve(pluginRoot, "scripts", "tonghuasun-mcp-proxy.mjs"));
await bundle("src/marketServer.ts", resolve(pluginRoot, "scripts", "market-server.mjs"));

async function buildCandleChartWidget() {
  await buildWidget({
    entryPoint: "src/ui/candleChart.ts",
    htmlName: "candleChart.html",
    cssName: "candleChart.css",
    outputName: "candle-chart.html",
    emptyError: "K 线组件构建结果为空。",
    templateError: "K 线组件 HTML 模板缺少构建占位符。"
  });
}

async function buildWidget(options) {
  const result = await build({
    absWorkingDir: projectRoot,
    entryPoints: [options.entryPoint],
    bundle: true,
    platform: "browser",
    format: "iife",
    target: ["chrome120", "edge120", "safari17"],
    minify: true,
    sourcemap: false,
    legalComments: "eof",
    write: false,
    logLevel: "info"
  });
  const script = result.outputFiles[0]?.text;
  if (!script) {
    throw new Error(options.emptyError);
  }

  const template = readFileSync(resolve(projectRoot, "src", "ui", options.htmlName), "utf8");
  const styles = readFileSync(resolve(projectRoot, "src", "ui", options.cssName), "utf8");
  if (!template.includes("/*__WIDGET_CSS__*/") || !template.includes("/*__WIDGET_SCRIPT__*/")) {
    throw new Error(options.templateError);
  }

  const html = template
    .replace("/*__WIDGET_CSS__*/", styles)
    .replace("/*__WIDGET_SCRIPT__*/", script.replaceAll("</script", "<\\/script"));
  writeFileSync(resolve(pluginRoot, "ui", options.outputName), html, "utf8");
}

async function bundle(entryPoint, outfile) {
  await build({
    absWorkingDir: projectRoot,
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    minify: true,
    sourcemap: false,
    legalComments: "eof",
    logLevel: "info"
  });
}
