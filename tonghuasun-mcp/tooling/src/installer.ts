import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type DeploymentMode = "auto" | "symlink" | "copy";

type MappingRecord = {
  fileName: string;
  sourcePath: string;
  destinationPath: string;
  sha256: string;
  mode: "symlink" | "copy";
  backupPath?: string;
};

type ProductConfig = {
  schemaVersion: number;
  thsInstallPath: string;
  thsBinPath: string;
  pluginDirectory: string;
  preferredPort: number;
  portRangeStart: number;
  portRangeEnd: number;
  localAccessToken: string;
  deviceId: string;
  enableTradeTools: boolean;
  enableAutomatedTradeApi: boolean;
  releaseVersion: string;
  activeReleasePath: string;
  deploymentMode: "symlink" | "copy";
  mappings: MappingRecord[];
  updatedAtUtc: string;
};

type CliOptions = {
  command: "configure" | "repair" | "status" | "uninstall";
  thsPath?: string;
  payloadPath?: string;
  version?: string;
  port?: number;
  enableTradeTools?: boolean;
  enableAutomatedTradeApi?: boolean;
  rotateToken?: boolean;
  mode: DeploymentMode;
  json: boolean;
};

const productHome = resolveProductHome();
const configPath = join(productHome, "config.json");
const endpointPath = join(productHome, "runtime", "endpoint.json");

main();

function main(): void {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.command === "status") {
      printResult(readStatus(), options.json);
      return;
    }

    if (options.command === "uninstall") {
      printResult(uninstall(), options.json);
      return;
    }

    printResult(configure(options), options.json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`同花顺 Agent 配置失败：${message}`);
    process.exitCode = 1;
  }
}

function configure(options: CliOptions): Record<string, unknown> {
  ensureHostStopped();
  const existingConfig = readJson<ProductConfig>(configPath);
  const thsPaths = resolveThsPaths(options.thsPath ?? existingConfig?.thsInstallPath);
  const port = validatePort(options.port ?? existingConfig?.preferredPort ?? 17180);
  const version = options.version?.trim() || resolvePackagedVersion();
  const payloadPath = resolve(options.payloadPath ?? join(resolvePluginRoot(), "payload", "ths-plugin"));
  validatePayload(payloadPath);
  ensureHttpUrlAcl(port);

  const releasePath = join(productHome, "releases", sanitizePathSegment(version), "ths-plugin");
  mkdirSync(releasePath, { recursive: true });
  const releaseFiles = copyPayload(payloadPath, releasePath);
  const deploymentMode = resolveDeploymentMode(options.mode, thsPaths.pluginDirectory, releaseFiles[0]?.sourcePath);
  const backupDirectory = join(productHome, "backups", createTimestamp());
  const mappings = activateRelease(releaseFiles, thsPaths.pluginDirectory, deploymentMode, backupDirectory);

  const config: ProductConfig = {
    schemaVersion: 3,
    thsInstallPath: thsPaths.installPath,
    thsBinPath: thsPaths.binPath,
    pluginDirectory: thsPaths.pluginDirectory,
    preferredPort: port,
    portRangeStart: port,
    portRangeEnd: port,
    localAccessToken: resolveLocalAccessToken(existingConfig?.localAccessToken, options.rotateToken),
    deviceId: existingConfig?.deviceId || randomUUID(),
    enableTradeTools: options.enableTradeTools ?? existingConfig?.enableTradeTools ?? false,
    enableAutomatedTradeApi: options.enableAutomatedTradeApi ?? existingConfig?.enableAutomatedTradeApi ?? false,
    releaseVersion: version,
    activeReleasePath: releasePath,
    deploymentMode,
    mappings,
    updatedAtUtc: new Date().toISOString()
  };

  mkdirSync(productHome, { recursive: true });
  writeJsonAtomic(configPath, config);
  return {
    ok: true,
    configured: true,
    thsInstallPath: config.thsInstallPath,
    pluginDirectory: config.pluginDirectory,
    releaseVersion: config.releaseVersion,
    activeReleasePath: config.activeReleasePath,
    deploymentMode: config.deploymentMode,
    preferredPort: config.preferredPort,
    deviceId: config.deviceId,
    enableTradeTools: config.enableTradeTools,
    enableAutomatedTradeApi: config.enableAutomatedTradeApi,
    mcpUrl: `http://127.0.0.1:${port}/mcp`,
    apiBaseUrl: `http://127.0.0.1:${port}/api/v2`,
    openApiUrl: `http://127.0.0.1:${port}/openapi/v2.json`,
    websocketUrl: `ws://127.0.0.1:${port}/api/v2/realtime/ws`,
    pythonSdkPath: join(resolvePluginRoot(), "sdk", "python"),
    mappedFiles: config.mappings.length,
    configPath,
    mcpBridgePath: join(resolvePluginRoot(), "scripts", "tonghuasun-mcp-proxy.mjs"),
    localAccessTokenRotated: options.rotateToken === true,
    startupGuide: createStartupGuide(port),
    nextAction: "请启动同花顺，并重启当前 Agent 宿主或新建任务以重新加载 MCP。"
  };
}

function createStartupGuide(port: number): Record<string, unknown> {
  return {
    title: "同花顺启动后可使用以下本机入口：",
    endpoints: [
      {
        name: "MCP",
        url: `http://127.0.0.1:${port}/mcp`,
        usage: "供 Codex、WorkBuddy 和 DeepSeek Harness 加载并调用同花顺工具。"
      },
      {
        name: "REST API",
        url: `http://127.0.0.1:${port}/api/v2`,
        usage: "供本机程序通过 HTTP 调用接口。"
      },
      {
        name: "OpenAPI",
        url: `http://127.0.0.1:${port}/openapi/v2.json`,
        usage: "查看 REST API 的接口定义。"
      },
      {
        name: "实时 WebSocket",
        url: `ws://127.0.0.1:${port}/api/v2/realtime/ws`,
        usage: "订阅实时行情和事件推送。"
      }
    ],
    notice: "以上入口仅监听本机，访问时需要本机访问令牌。"
  };
}

function uninstall(): Record<string, unknown> {
  ensureHostStopped();
  const config = readJson<ProductConfig>(configPath);
  if (!config) {
    return { ok: true, configured: false, message: "未发现已安装配置，无需卸载。" };
  }

  const removed: string[] = [];
  const preserved: string[] = [];
  const restored: string[] = [];

  for (const mapping of config.mappings ?? []) {
    if (canRemoveManagedDestination(mapping)) {
      unlinkSync(mapping.destinationPath);
      removed.push(mapping.destinationPath);
    } else if (existsSync(mapping.destinationPath)) {
      preserved.push(mapping.destinationPath);
      continue;
    }

    if (mapping.backupPath && existsSync(mapping.backupPath)) {
      copyFileSync(mapping.backupPath, mapping.destinationPath);
      restored.push(mapping.destinationPath);
    }
  }

  if (existsSync(endpointPath)) {
    rmSync(endpointPath, { force: true });
  }

  const archivedConfigPath = join(productHome, `config.uninstalled-${createTimestamp()}.json`);
  renameSync(configPath, archivedConfigPath);
  return {
    ok: true,
    configured: false,
    removed,
    restored,
    preserved,
    archivedConfigPath,
    releasesPreserved: true
  };
}

function readStatus(): Record<string, unknown> {
  const config = readJson<ProductConfig>(configPath);
  const endpoint = readJson<Record<string, unknown>>(endpointPath);
  const mappings = (config?.mappings ?? []).map((mapping) => ({
    fileName: mapping.fileName,
    mode: mapping.mode,
    healthy: isMappingHealthy(mapping)
  }));

  return {
    ok: true,
    configured: !!config,
    hostRunning: isHostRunning(),
    configPath,
    endpointPath,
    endpointPublished: !!endpoint,
    config: config
      ? {
          thsInstallPath: config.thsInstallPath,
          releaseVersion: config.releaseVersion,
          deploymentMode: config.deploymentMode,
          preferredPort: config.preferredPort,
          deviceId: config.deviceId,
          enableTradeTools: config.enableTradeTools ?? false,
          enableAutomatedTradeApi: config.enableAutomatedTradeApi ?? false,
          localAccessTokenConfigured: /^[a-f0-9]{64}$/i.test(config.localAccessToken ?? ""),
          mcpUrl: `http://127.0.0.1:${config.preferredPort}/mcp`,
          apiBaseUrl: `http://127.0.0.1:${config.preferredPort}/api/v2`,
          openApiUrl: `http://127.0.0.1:${config.preferredPort}/openapi/v2.json`,
          websocketUrl: `ws://127.0.0.1:${config.preferredPort}/api/v2/realtime/ws`,
          pythonSdkPath: join(resolvePluginRoot(), "sdk", "python"),
          activeReleasePath: config.activeReleasePath
        }
      : null,
    endpoint,
    startupGuide: config ? createStartupGuide(config.preferredPort) : null,
    mappings,
    healthyMappings: mappings.filter((item) => item.healthy).length,
    totalMappings: mappings.length
  };
}

function activateRelease(
  releaseFiles: Array<{ fileName: string; sourcePath: string; sha256: string }>,
  pluginDirectory: string,
  mode: "symlink" | "copy",
  backupDirectory: string
): MappingRecord[] {
  mkdirSync(pluginDirectory, { recursive: true });
  const mappings: MappingRecord[] = [];

  for (const file of releaseFiles) {
    const destinationPath = join(pluginDirectory, file.fileName);
    let backupPath: string | undefined;
    try {
      if (existsSync(destinationPath) || isSymbolicLink(destinationPath)) {
        backupPath = backupExistingFile(destinationPath, backupDirectory);
        unlinkSync(destinationPath);
      }

      if (mode === "symlink") {
        symlinkSync(file.sourcePath, destinationPath, "file");
      } else {
        copyFileSync(file.sourcePath, destinationPath);
      }

      mappings.push({
        fileName: file.fileName,
        sourcePath: file.sourcePath,
        destinationPath,
        sha256: file.sha256,
        mode,
        ...(backupPath ? { backupPath } : {})
      });
    } catch (error) {
      // 激活必须具备事务性，避免安装中断后把 PluginSdks 留在半新半旧状态。
      removeFileIfPresent(destinationPath);
      restoreBackup(backupPath, destinationPath);
      rollbackMappings(mappings);
      throw error;
    }
  }

  return mappings;
}

function rollbackMappings(mappings: MappingRecord[]): void {
  for (const mapping of [...mappings].reverse()) {
    removeFileIfPresent(mapping.destinationPath);
    restoreBackup(mapping.backupPath, mapping.destinationPath);
  }
}

function restoreBackup(backupPath: string | undefined, destinationPath: string): void {
  if (backupPath && existsSync(backupPath)) {
    copyFileSync(backupPath, destinationPath);
  }
}

function removeFileIfPresent(filePath: string): void {
  if (existsSync(filePath) || isSymbolicLink(filePath)) {
    rmSync(filePath, { force: true });
  }
}

function backupExistingFile(destinationPath: string, backupDirectory: string): string | undefined {
  if (isSymbolicLink(destinationPath)) {
    return undefined;
  }

  mkdirSync(backupDirectory, { recursive: true });
  const backupPath = join(backupDirectory, destinationPath.split(/[\\/]/).pop() ?? "unknown-file");
  copyFileSync(destinationPath, backupPath);
  return backupPath;
}

function resolveDeploymentMode(
  requestedMode: DeploymentMode,
  pluginDirectory: string,
  sourceProbePath: string | undefined
): "symlink" | "copy" {
  if (requestedMode === "copy") {
    return "copy";
  }

  if (!sourceProbePath) {
    throw new Error("同花顺插件产物为空。请先执行发行构建。 ");
  }

  mkdirSync(pluginDirectory, { recursive: true });
  const probePath = join(pluginDirectory, `.tonghuasun-codex-link-probe-${process.pid}`);
  try {
    symlinkSync(sourceProbePath, probePath, "file");
    unlinkSync(probePath);
    return "symlink";
  } catch (error) {
    if (existsSync(probePath) || isSymbolicLink(probePath)) {
      rmSync(probePath, { force: true });
    }

    if (requestedMode === "symlink") {
      throw new Error(
        `无法创建文件符号链接。请开启 Windows 开发者模式或以管理员身份运行。${formatErrorCode(error)}`
      );
    }

    return "copy";
  }
}

function copyPayload(
  payloadPath: string,
  releasePath: string
): Array<{ fileName: string; sourcePath: string; sha256: string }> {
  return readdirSync(payloadPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const sourcePath = join(payloadPath, entry.name);
      const releaseFilePath = join(releasePath, entry.name);
      copyFileSync(sourcePath, releaseFilePath);
      return {
        fileName: entry.name,
        sourcePath: releaseFilePath,
        sha256: hashFile(releaseFilePath)
      };
    })
    .sort((left, right) => left.fileName.localeCompare(right.fileName));
}

function resolveThsPaths(inputPath: string | undefined): {
  installPath: string;
  binPath: string;
  pluginDirectory: string;
} {
  const candidates = inputPath ? [inputPath] : detectThsCandidates();
  for (const candidate of candidates) {
    const normalized = resolve(candidate);
    const binPath = existsSync(join(normalized, "happ.exe")) ? normalized : join(normalized, "bin");
    if (existsSync(join(binPath, "happ.exe"))) {
      return {
        installPath: dirname(binPath),
        binPath,
        pluginDirectory: join(binPath, "PluginSdks")
      };
    }
  }

  throw new Error("没有找到同花顺 happ.exe。请使用 --ths-path 指定同花顺安装目录。 ");
}

function detectThsCandidates(): string[] {
  const candidates: string[] = [];
  const configured = readJson<ProductConfig>(configPath)?.thsInstallPath;
  if (configured) {
    candidates.push(configured);
  }

  for (const drive of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
    candidates.push(`${drive}:\\同花顺远航版`);
    candidates.push(`${drive}:\\Program Files\\同花顺远航版`);
    candidates.push(`${drive}:\\Program Files (x86)\\同花顺远航版`);
  }

  return candidates;
}

function validatePayload(payloadPath: string): void {
  if (!existsSync(join(payloadPath, "ThsPlugin.Plugin.dll"))) {
    throw new Error(`插件产物不完整：${payloadPath} 中缺少 ThsPlugin.Plugin.dll。`);
  }
}

function resolvePackagedVersion(): string {
  const pluginRoot = resolvePluginRoot();
  const manifests = [
    join(pluginRoot, "plugin.json"),
    join(pluginRoot, ".codex-plugin", "plugin.json"),
    join(pluginRoot, "package.json"),
    join(pluginRoot, "manifest.json")
  ];
  for (const manifestPath of manifests) {
    const version = readJson<{ version?: string }>(manifestPath)?.version?.split("+")[0];
    if (version) return version;
  }
  return "0.1.0";
}

function resolvePluginRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return resolve(dirname(currentFile), "..");
}

function resolveProductHome(): string {
  const overridden = process.env.TONGHUASUN_AGENT_HOME?.trim() || process.env.TONGHUASUN_CODEX_HOME?.trim();
  if (overridden) {
    return resolve(expandEnvironmentVariables(overridden));
  }

  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (!localAppData) {
    throw new Error("LOCALAPPDATA 不可用，无法确定用户级安装目录。");
  }

  return join(localAppData, "TonghuasunCodex");
}

function isHostRunning(): boolean {
  try {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "if (Get-Process -Name happ -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
      ],
      {
        stdio: "ignore",
        timeout: 5_000,
        windowsHide: true
      }
    );
    return true;
  } catch {
    return false;
  }
}

function ensureHttpUrlAcl(port: number): void {
  const prefix = `http://+:${port}/`;
  const user = execFileSync("whoami.exe", [], { encoding: "utf8", windowsHide: true }).trim();
  const current = execFileSync("netsh.exe", ["http", "show", "urlacl", `url=${prefix}`], {
    encoding: "utf8",
    windowsHide: true
  });
  if (current.toLowerCase().includes(user.toLowerCase())) {
    return;
  }

  if (/Reserved URL|保留的 URL|预留 URL/i.test(current)) {
    throw new Error(`端口 ${port} 的 HTTP URL ACL 已属于其他用户，请先由管理员检查：${prefix}`);
  }

  // URL ACL 是 HttpListener 在普通用户权限下监听固定端口的前提。Windows 会显示标准 UAC，
  // 用户拒绝时配置立即终止，不会绕过系统授权。
  const elevatedCommand = [
    `$process = Start-Process -FilePath 'netsh.exe' -Verb RunAs -Wait -PassThru -ArgumentList @(`,
    `'http','add','urlacl','url=${prefix}','user=${user}','listen=yes','delegate=no'`,
    `); exit $process.ExitCode`
  ].join(" ");
  const encodedCommand = Buffer.from(elevatedCommand, "utf16le").toString("base64");
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-EncodedCommand", encodedCommand], {
      stdio: "inherit",
      windowsHide: false
    });
  } catch {
    throw new Error(`无法为 ${prefix} 配置当前用户 URL ACL；请接受 Windows UAC 后重试。`);
  }
}

function ensureHostStopped(): void {
  if (isHostRunning()) {
    throw new Error("检测到同花顺 happ.exe 正在运行。请先正常退出同花顺，再执行配置、修复或卸载。 ");
  }
}

function canRemoveManagedDestination(mapping: MappingRecord): boolean {
  if (!existsSync(mapping.destinationPath) && !isSymbolicLink(mapping.destinationPath)) {
    return false;
  }

  if (isSymbolicLink(mapping.destinationPath)) {
    try {
      return resolve(dirname(mapping.destinationPath), readlinkSync(mapping.destinationPath)) === resolve(mapping.sourcePath);
    } catch {
      return false;
    }
  }

  return mapping.mode === "copy" && hashFile(mapping.destinationPath) === mapping.sha256;
}

function isMappingHealthy(mapping: MappingRecord): boolean {
  return canRemoveManagedDestination(mapping);
}

function isSymbolicLink(filePath: string): boolean {
  try {
    return lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

function hashFile(filePath: string): string {
  const hash = createHash("sha256");
  const buffer = readFileSync(filePath);
  hash.update(buffer);
  return hash.digest("hex");
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(value, null, 2), "utf8");
  if (existsSync(filePath)) {
    rmSync(filePath, { force: true });
  }
  renameSync(temporaryPath, filePath);
}

function parseArguments(args: string[]): CliOptions {
  const first = args[0]?.toLowerCase();
  const command = first && !first.startsWith("--") ? first : "configure";
  if (!(["configure", "repair", "status", "uninstall"] as string[]).includes(command)) {
    throw new Error(`未知命令：${command}`);
  }

  const values = first && !first.startsWith("--") ? args.slice(1) : args;
  const options: CliOptions = {
    command: command as CliOptions["command"],
    mode: "auto",
    json: false
  };

  for (let index = 0; index < values.length; index++) {
    const name = values[index];
    if (name === "--json") {
      options.json = true;
      continue;
    }
    if (name === "--rotate-token") {
      options.rotateToken = true;
      continue;
    }

    const value = values[++index];
    if (!value) {
      throw new Error(`${name} 缺少参数值。`);
    }

    switch (name) {
      case "--ths-path":
        options.thsPath = value;
        break;
      case "--payload":
        options.payloadPath = value;
        break;
      case "--version":
        options.version = value;
        break;
      case "--port":
        options.port = validatePort(Number.parseInt(value, 10));
        break;
      case "--enable-trade-tools":
        if (!(value === "true" || value === "false")) {
          throw new Error("--enable-trade-tools 只支持 true 或 false。 ");
        }
        options.enableTradeTools = value === "true";
        break;
      case "--enable-automated-trade-api":
        if (!(value === "true" || value === "false")) {
          throw new Error("--enable-automated-trade-api 只支持 true 或 false。 ");
        }
        options.enableAutomatedTradeApi = value === "true";
        break;
      case "--mode":
        if (!(["auto", "symlink", "copy"] as string[]).includes(value)) {
          throw new Error("--mode 只支持 auto、symlink 或 copy。 ");
        }
        options.mode = value as DeploymentMode;
        break;
      default:
        throw new Error(`未知参数：${name}`);
    }
  }

  return options;
}

function validatePort(port: number): number {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`端口无效：${port}`);
  }
  return port;
}

function resolveLocalAccessToken(existingToken: string | undefined, rotateToken = false): string {
  const normalized = existingToken?.trim() ?? "";
  return !rotateToken && /^[a-f0-9]{64}$/i.test(normalized)
    ? normalized
    : randomBytes(32).toString("hex");
}

function createTimestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._+-]/g, "-");
}

function expandEnvironmentVariables(value: string): string {
  return value.replace(/%([^%]+)%/g, (_match, name: string) => process.env[name] ?? `%${name}%`);
}

function formatErrorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? ` 错误码：${String(error.code)}` : "";
}

function printResult(result: Record<string, unknown>, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  for (const [key, value] of Object.entries(result)) {
    console.log(`${key}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
  }
}
