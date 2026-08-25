import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import archiver from "archiver";

const toolingRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coreRoot = resolve(toolingRoot, "..");
const repoRoot = resolve(coreRoot, "..");
const distributionRoot = join(coreRoot, "distribution");
const artifactsRoot = join(repoRoot, "artifacts");
const manifest = JSON.parse(readFileSync(join(distributionRoot, "manifest.json"), "utf8"));
const version = String(manifest.version);

if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`发行版本必须是严格 semver：${version}`);
assertVersion(join(repoRoot, "codex", ".codex-plugin", "plugin.json"), version);
assertPythonVersion(join(distributionRoot, "sdk", "python", "pyproject.toml"), version);

execFileSync("npm", ["test"], { cwd: toolingRoot, stdio: "inherit" });

mkdirSync(artifactsRoot, { recursive: true });
const tempRoot = mkdtempSync(join(tmpdir(), `tonghuasun-agent-${version}-`));
try {
  const pluginStage = join(tempRoot, "tonghuasun-codex");
  mkdirSync(pluginStage, { recursive: true });
  copyTree(join(repoRoot, "codex"), pluginStage, path => !path.endsWith(".mcp.example.json"));
  for (const directory of ["licenses", "scripts", "sdk", "skills", "ui"]) {
    copyTree(join(distributionRoot, directory), join(pluginStage, directory));
  }
  copyTree(join(coreRoot, "legal"), pluginStage);
  cpSync(join(distributionRoot, "manifest.json"), join(pluginStage, "manifest.json"));
  assertStage(pluginStage);

  const zipPath = join(artifactsRoot, `tonghuasun-agent-codex-macos-${version}.zip`);
  rmSync(zipPath, { force: true });
  await createZip(pluginStage, "tonghuasun-codex", zipPath);

  for (const file of readdirSync(artifactsRoot)) {
    if (/^tonghuasun_codex-.*\.whl$/.test(file)) rmSync(join(artifactsRoot, file), { force: true });
  }
  const wheel = `tonghuasun_codex-${version}-py3-none-any.whl`;
  await createPurePythonWheel(
    join(distributionRoot, "sdk", "python", "src", "tonghuasun_codex"),
    join(tempRoot, "wheel"),
    join(artifactsRoot, wheel),
    version,
  );

  for (const path of [zipPath, join(artifactsRoot, wheel)]) {
    console.log(`artifact_path=${path}`);
    console.log(`artifact_size=${statSync(path).size}`);
    console.log(`artifact_sha256=${sha256(path)}`);
  }
  console.log("build_complete=true");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function assertVersion(path, expected) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (value.version !== expected) throw new Error(`${path} 版本不一致：${value.version} != ${expected}`);
}

function assertPythonVersion(path, expected) {
  const text = readFileSync(path, "utf8");
  const found = text.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (found !== expected) throw new Error(`${path} 版本不一致：${found} != ${expected}`);
}

function copyTree(source, destination, filter = () => true) {
  if (!existsSync(source)) throw new Error(`缺少发行目录：${source}`);
  cpSync(source, destination, {
    recursive: true,
    filter: path => !/(^|\/)(node_modules|dist|__pycache__|\.git)(\/|$)/.test(path)
      && !/\.(pyc|cs|csproj|sln|dll|exe|ps1)$/.test(path)
      && !path.endsWith(".DS_Store")
      && filter(path),
  });
}

function assertStage(root) {
  for (const required of [
    ".codex-plugin/plugin.json",
    ".mcp.json",
    "scripts/configure.mjs",
    "scripts/market-server.mjs",
    "scripts/tonghuasun-mcp-proxy.mjs",
    "skills/configure-ths/SKILL.md",
    "ui/candle-chart.html",
    "sdk/python/pyproject.toml",
  ]) {
    if (!existsSync(join(root, required))) throw new Error(`Codex 发行包缺少：${required}`);
  }
  const forbidden = [];
  walk(root, path => {
    if (/\.(dll|exe|ps1|cs|csproj|sln)$/i.test(path)) forbidden.push(path);
    if (/payload\/ths-plugin/.test(path)) forbidden.push(path);
  });
  if (forbidden.length) throw new Error(`发行包包含 Windows 文件：${forbidden.join(", ")}`);
  const textFiles = [];
  walk(root, path => {
    if (/\.(json|md|mjs|html|toml|yaml|yml)$/i.test(path)) textFiles.push(path);
  });
  const forbiddenMarkers = ["LOCALAPPDATA", "happ.exe", "PluginSdks", "enableTradeTools", "ths_trade_"];
  for (const path of textFiles) {
    const text = readFileSync(path, "utf8");
    for (const marker of forbiddenMarkers) {
      if (text.includes(marker)) throw new Error(`发行包仍包含 Windows/交易标记 ${marker}：${path}`);
    }
  }
}

function walk(root, callback) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) walk(path, callback);
    else if (entry.isFile()) callback(path);
  }
}

function createZip(source, rootName, outputPath) {
  return new Promise((resolvePromise, reject) => {
    const output = createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolvePromise);
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(source, rootName);
    archive.finalize();
  });
}

async function createPurePythonWheel(packageSource, stage, outputPath, packageVersion) {
  const packageRoot = join(stage, "tonghuasun_codex");
  const distInfo = join(stage, `tonghuasun_codex-${packageVersion}.dist-info`);
  mkdirSync(packageRoot, { recursive: true });
  mkdirSync(distInfo, { recursive: true });
  for (const file of readdirSync(packageSource)) {
    if (file.endsWith(".py")) cpSync(join(packageSource, file), join(packageRoot, file));
  }
  writeFileSync(join(distInfo, "METADATA"), [
    "Metadata-Version: 2.4",
    "Name: tonghuasun-codex",
    `Version: ${packageVersion}`,
    "Summary: macOS Tonghuasun iFinD local market data SDK",
    "License-Expression: AGPL-3.0-only",
    "Requires-Python: >=3.10",
    "Provides-Extra: pandas",
    'Requires-Dist: pandas>=2; extra == "pandas"',
    "",
  ].join("\n"));
  writeFileSync(join(distInfo, "WHEEL"), [
    "Wheel-Version: 1.0",
    `Generator: tonghuasun-agent ${packageVersion}`,
    "Root-Is-Purelib: true",
    "Tag: py3-none-any",
    "",
  ].join("\n"));
  writeFileSync(join(distInfo, "top_level.txt"), "tonghuasun_codex\n");

  const recordPath = join(distInfo, "RECORD");
  const recordRows = [];
  walk(stage, path => {
    if (path === recordPath) return;
    const relativePath = path.slice(stage.length + 1).replaceAll("\\", "/");
    const bytes = readFileSync(path);
    const digest = createHash("sha256").update(bytes).digest("base64url");
    recordRows.push(`${relativePath},sha256=${digest},${bytes.length}`);
  });
  recordRows.sort();
  recordRows.push(`tonghuasun_codex-${packageVersion}.dist-info/RECORD,,`);
  writeFileSync(recordPath, `${recordRows.join("\n")}\n`);

  rmSync(outputPath, { force: true });
  await new Promise((resolvePromise, reject) => {
    const output = createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolvePromise);
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(stage, false);
    archive.finalize();
  });
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
