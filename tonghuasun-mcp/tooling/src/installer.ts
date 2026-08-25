import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LAUNCH_AGENT_LABEL,
  configPath,
  endpointPath,
  productHome,
  readConfig,
  readEndpoint,
  writePrivateJson,
} from "./config.js";
import { ServiceError, asServiceError } from "./errors.js";
import { deleteRefreshToken, hasRefreshToken, promptAndStoreRefreshToken } from "./keychain.js";
import { VERSION, type ProductConfig } from "./types.js";

type Options = {
  command: "configure" | "repair" | "status" | "uninstall";
  json: boolean;
  check: boolean;
  purge: boolean;
  port?: number;
};

await main();

async function main(): Promise<void> {
  let json = process.argv.includes("--json");
  try {
    const options = parseArguments(process.argv.slice(2));
    json = options.json;
    const result = options.command === "status"
      ? await status()
      : options.command === "uninstall"
        ? await uninstall(options)
        : await configure(options);
    print(result, json);
  } catch (error) {
    const mapped = asServiceError(error);
    const result = { ok: false, error: { code: mapped.code, message: mapped.message, details: mapped.details } };
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.error(`同花顺 Agent 配置失败 [${mapped.code}]：${mapped.message}`);
    process.exitCode = 1;
  }
}

async function configure(options: Options): Promise<Record<string, unknown>> {
  assertMacAndNode();
  const home = productHome();
  assertSafeProductHome(home);
  const existing = readConfig(home, false);
  const port = normalizePort(options.port ?? existing?.preferredPort ?? 17180);
  const pluginRoot = resolvePluginRoot();
  const sourceServer = join(pluginRoot, "scripts", "market-server.mjs");
  const sourceWidget = join(pluginRoot, "ui", "candle-chart.html");
  for (const path of [sourceServer, sourceWidget]) {
    if (!existsSync(path)) throw new ServiceError("not_configured", `发行包缺少文件：${path}`, 500);
  }
  const releasePath = safeChild(home, join(home, "releases", VERSION));
  const keychainConfigured = hasRefreshToken();
  const portAvailable = await canListen(port);
  if (options.check) {
    return {
      ok: true,
      check: true,
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.version,
      nodePath: process.execPath,
      productHome: home,
      releasePath,
      port,
      portAvailable,
      keychainConfigured,
      nextAction: keychainConfigured
        ? "预检完成，可以运行 configure。"
        : "预检完成；运行 configure 时 macOS 钥匙串会提示输入 iFinD refresh token。",
    };
  }

  stopLaunchAgent();
  if (!await canListen(port)) {
    throw new ServiceError("invalid_request", `本机端口 ${port} 已被其他程序占用。`, 409);
  }
  if (!keychainConfigured) {
    console.error("请输入 iFinD refresh token；输入内容由 macOS security 隐藏处理，不会写入命令行或配置文件。");
    promptAndStoreRefreshToken();
  }
  mkdirSync(join(releasePath, "scripts"), { recursive: true, mode: 0o700 });
  mkdirSync(join(releasePath, "ui"), { recursive: true, mode: 0o700 });
  copyFileSync(sourceServer, join(releasePath, "scripts", "market-server.mjs"));
  copyFileSync(sourceWidget, join(releasePath, "ui", "candle-chart.html"));
  chmodSync(join(releasePath, "scripts", "market-server.mjs"), 0o700);
  chmodSync(join(releasePath, "ui", "candle-chart.html"), 0o600);

  const config: ProductConfig = {
    schemaVersion: 1,
    preferredPort: port,
    localAccessToken: existing?.localAccessToken || randomBytes(32).toString("base64url"),
    releaseVersion: VERSION,
    activeReleasePath: releasePath,
    nodePath: process.execPath,
    updatedAtUtc: new Date().toISOString(),
  };
  writePrivateJson(configPath(home), config);
  const plist = writeLaunchAgent(config, home);
  startLaunchAgent(plist);
  const endpoint = await waitForEndpoint(home, 8_000);
  return {
    ok: true,
    configured: true,
    repaired: options.command === "repair",
    productHome: home,
    releaseVersion: VERSION,
    port,
    baseUrl: endpoint?.baseUrl ?? `http://127.0.0.1:${port}`,
    mcpUrl: endpoint?.mcpUrl ?? `http://127.0.0.1:${port}/mcp`,
    endpointPublished: Boolean(endpoint),
    keychainConfigured: true,
    launchAgent: plist,
    nextAction: endpoint
      ? "配置完成；请在 Codex 中新建任务以加载行情工具。"
      : "配置已写入，但服务尚未发布端点；请运行 status 查看日志路径。",
  };
}

async function status(): Promise<Record<string, unknown>> {
  const home = productHome();
  const config = readConfig(home, false);
  const endpoint = readEndpoint(home);
  const running = endpoint?.processId ? isProcessRunning(endpoint.processId) : false;
  return {
    ok: true,
    configured: Boolean(config),
    running,
    keychainConfigured: hasRefreshToken(),
    productHome: home,
    configPath: configPath(home),
    endpointPath: endpointPath(home),
    endpointPublished: Boolean(endpoint),
    config: config ? {
      schemaVersion: config.schemaVersion,
      preferredPort: config.preferredPort,
      releaseVersion: config.releaseVersion,
      activeReleasePath: config.activeReleasePath,
      nodePath: config.nodePath,
      updatedAtUtc: config.updatedAtUtc,
    } : null,
    endpoint,
    launchAgentPath: launchAgentPath(),
    logs: {
      stdout: join(homedir(), "Library", "Logs", "TonghuasunAgent", "market-server.log"),
      stderr: join(homedir(), "Library", "Logs", "TonghuasunAgent", "market-server.error.log"),
    },
  };
}

async function uninstall(options: Options): Promise<Record<string, unknown>> {
  const home = productHome();
  assertSafeProductHome(home);
  const plan = {
    launchAgentPath: launchAgentPath(),
    configPath: configPath(home),
    runtimePath: join(home, "runtime"),
    releasesPath: join(home, "releases"),
    cachePath: join(home, "cache"),
    purge: options.purge,
  };
  if (options.check) return { ok: true, check: true, uninstallPlan: plan };
  stopLaunchAgent();
  rmSync(launchAgentPath(), { force: true });
  rmSync(configPath(home), { force: true });
  rmSync(join(home, "runtime"), { recursive: true, force: true });
  rmSync(join(home, "releases"), { recursive: true, force: true });
  if (options.purge) {
    deleteRefreshToken();
    rmSync(home, { recursive: true, force: true });
    rmSync(join(homedir(), "Library", "Logs", "TonghuasunAgent"), { recursive: true, force: true });
  }
  return {
    ok: true,
    uninstalled: true,
    purged: options.purge,
    keychainPreserved: !options.purge,
    cachePreserved: !options.purge,
  };
}

function writeLaunchAgent(config: ProductConfig, home: string): string {
  const path = launchAgentPath();
  const logs = join(homedir(), "Library", "Logs", "TonghuasunAgent");
  mkdirSync(dirname(path), { recursive: true });
  mkdirSync(logs, { recursive: true, mode: 0o700 });
  const serverPath = join(config.activeReleasePath, "scripts", "market-server.mjs");
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(config.nodePath)}</string><string>${xml(serverPath)}</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>TONGHUASUN_AGENT_HOME</key><string>${xml(home)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>${xml(join(logs, "market-server.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(join(logs, "market-server.error.log"))}</string>
</dict>
</plist>
`;
  writeFileSync(path, plist, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

function startLaunchAgent(plist: string): void {
  const domain = `gui/${process.getuid?.() ?? 0}`;
  try {
    execFileSync("/bin/launchctl", ["bootstrap", domain, plist], { stdio: "ignore" });
    execFileSync("/bin/launchctl", ["kickstart", "-k", `${domain}/${LAUNCH_AGENT_LABEL}`], { stdio: "ignore" });
  } catch (error) {
    throw new ServiceError("internal_error", "无法启动 macOS LaunchAgent。", 500, {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

function stopLaunchAgent(): void {
  const domain = `gui/${process.getuid?.() ?? 0}`;
  try {
    execFileSync("/bin/launchctl", ["bootout", `${domain}/${LAUNCH_AGENT_LABEL}`], { stdio: "ignore" });
  } catch {
    try {
      if (existsSync(launchAgentPath())) {
        execFileSync("/bin/launchctl", ["bootout", domain, launchAgentPath()], { stdio: "ignore" });
      }
    } catch {
      // 尚未安装或已经停止。
    }
  }
}

function launchAgentPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`);
}

async function waitForEndpoint(home: string, timeoutMs: number) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const endpoint = readEndpoint(home);
    if (endpoint && isProcessRunning(endpoint.processId)) return endpoint;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return null;
}

async function canListen(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

function isProcessRunning(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function resolvePluginRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function safeChild(home: string, candidate: string): string {
  const root = resolve(home);
  const path = resolve(candidate);
  const rel = relative(root, path);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new ServiceError("internal_error", `拒绝使用应用目录之外的路径：${path}`, 500);
  }
  return path;
}

function assertSafeProductHome(value: string): void {
  const path = resolve(value);
  const userHome = resolve(homedir());
  const broadTargets = new Set([
    resolve("/"),
    userHome,
    join(userHome, "Library"),
    join(userHome, "Library", "Application Support"),
  ]);
  if (broadTargets.has(path) || path.length < userHome.length + 8 || !/tonghuasun/i.test(path)) {
    throw new ServiceError("invalid_request", `拒绝使用过宽的应用数据目录：${path}`, 400);
  }
}

function normalizePort(value: number): number {
  if (!Number.isInteger(value) || value < 1_024 || value > 65_535) {
    throw new ServiceError("invalid_request", "端口必须是 1024 到 65535 的整数。", 400);
  }
  return value;
}

function assertMacAndNode(): void {
  if (process.platform !== "darwin") throw new ServiceError("invalid_request", "0.3.0 配置器仅支持 macOS。", 400);
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isInteger(major) || major < 24) {
    throw new ServiceError("invalid_request", `需要 Node.js 24 或更高版本，当前为 ${process.version}。`, 400);
  }
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function parseArguments(args: string[]): Options {
  const commandValue = args.find(value => !value.startsWith("--")) ?? "configure";
  if (!(["configure", "repair", "status", "uninstall"] as const).includes(commandValue as Options["command"])) {
    throw new ServiceError("invalid_request", `不支持的命令：${commandValue}`, 400);
  }
  const options: Options = {
    command: commandValue as Options["command"],
    json: args.includes("--json"),
    check: args.includes("--check") || args.includes("--dry-run"),
    purge: args.includes("--purge"),
  };
  const portIndex = args.indexOf("--port");
  if (portIndex >= 0) options.port = Number(args[portIndex + 1]);
  return options;
}

function print(value: unknown, json: boolean): void {
  if (json) console.log(JSON.stringify(value, null, 2));
  else console.log(JSON.stringify(value, null, 2));
}
