[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$agentRoot = $PSScriptRoot
$coreRoot = Join-Path $agentRoot "tonghuasun-mcp"
$distributionRoot = Join-Path $coreRoot "distribution"
$toolingRoot = Join-Path $coreRoot "tooling"
$coreManifestPath = Join-Path $distributionRoot "manifest.json"
$payloadPath = Join-Path $distributionRoot "payload\ths-plugin"
$payloadManifestPath = Join-Path $distributionRoot "payload\manifest.json"
$artifactDirectory = Join-Path $agentRoot "artifacts"
$temporaryBase = Join-Path $agentRoot ".tmp"

$coreManifest = Get-Content -LiteralPath $coreManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$releaseVersion = [string]$coreManifest.version
if ($releaseVersion -notmatch "^\d+\.\d+\.\d+$") {
    throw "公共底座版本必须使用严格语义版本：$releaseVersion"
}

function Assert-AdapterVersion([string]$ManifestPath, [string]$AdapterName) {
    $manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([string]$manifest.version -ne $releaseVersion) {
        throw "$AdapterName 版本与公共底座不一致：$($manifest.version) != $releaseVersion"
    }
}

Assert-AdapterVersion (Join-Path $agentRoot "codex\.codex-plugin\plugin.json") "Codex"
Assert-AdapterVersion (Join-Path $agentRoot "workbuddy\plugin.json") "WorkBuddy"
Assert-AdapterVersion (Join-Path $agentRoot "deepseek-harness\package.json") "DeepSeek Harness"

Push-Location $toolingRoot
try {
    & npm test
    if ($LASTEXITCODE -ne 0) {
        throw "公共配置器、MCP 传输桥或 UI 测试失败。"
    }
}
finally {
    Pop-Location
}

$resolvedPayloadPath = [IO.Path]::GetFullPath($payloadPath)
if (-not (Test-Path -LiteralPath $resolvedPayloadPath -PathType Container)) {
    throw "缺少闭源同花顺插件预编译目录：$resolvedPayloadPath"
}

$requiredPayloadFiles = @(
    "ThsPlugin.Plugin.dll",
    "ThsPlugin.Plugin.deps.json",
    "ThsPlugin.Abstractions.dll",
    "ThsPlugin.Application.dll",
    "ThsPlugin.Contracts.dll",
    "ThsPlugin.Adapters.Hevo.dll"
)
foreach ($requiredFile in $requiredPayloadFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $resolvedPayloadPath $requiredFile))) {
        throw "公共发行底座缺少必需文件：$requiredFile"
    }
}

if (-not (Test-Path -LiteralPath $payloadManifestPath -PathType Leaf)) {
    throw "缺少闭源 DLL 清单：$payloadManifestPath"
}

$payloadFiles = @(Get-ChildItem -LiteralPath $resolvedPayloadPath -File -Force | Sort-Object Name)
$payloadManifest = Get-Content -LiteralPath $payloadManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ([int]$payloadManifest.schemaVersion -ne 1) {
    throw "不支持的闭源 DLL 清单版本：$($payloadManifest.schemaVersion)"
}
if ([string]$payloadManifest.releaseVersion -ne $releaseVersion) {
    throw "闭源 DLL 版本与公共底座不一致：$($payloadManifest.releaseVersion) != $releaseVersion"
}

$manifestFiles = @($payloadManifest.files)
if ($manifestFiles.Count -ne $payloadFiles.Count) {
    throw "闭源 DLL 清单文件数与实际文件数不一致：$($manifestFiles.Count) != $($payloadFiles.Count)"
}

foreach ($payloadFile in $payloadFiles) {
    $manifestMatches = @($manifestFiles | Where-Object { [string]$_.name -ceq $payloadFile.Name })
    if ($manifestMatches.Count -ne 1) {
        throw "闭源 DLL 清单缺少文件或存在重名项：$($payloadFile.Name)"
    }

    $manifestFile = $manifestMatches[0]
    if ([long]$manifestFile.size -ne $payloadFile.Length) {
        throw "闭源 DLL 文件大小与清单不一致：$($payloadFile.Name)"
    }

    $actualHash = (Get-FileHash -LiteralPath $payloadFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if ([string]$manifestFile.sha256 -cne $actualHash) {
        throw "闭源 DLL 哈希与清单不一致：$($payloadFile.Name)"
    }
}

$forbiddenPayloadSources = @(Get-ChildItem -LiteralPath $resolvedPayloadPath -Recurse -File -Force |
    Where-Object { $_.Extension -in @(".cs", ".csproj", ".sln") })
if ($forbiddenPayloadSources.Count -gt 0) {
    throw "闭源发行目录不得包含 C# 源码或工程文件：$($forbiddenPayloadSources.FullName -join ', ')"
}

function Copy-ReleaseTree([string]$SourcePath, [string]$DestinationPath) {
    $resolvedSourcePath = (Resolve-Path -LiteralPath $SourcePath).Path
    Get-ChildItem -LiteralPath $resolvedSourcePath -Recurse -File -Force |
        Where-Object {
            $relativePath = $_.FullName.Substring($resolvedSourcePath.Length).TrimStart("\")
            $relativePath -notmatch "(^|\\)(node_modules|dist|bin|obj|__pycache__|\.secrets|\.git|host|control-plane)(\\|$)" -and
            $_.Name -notin @(".env", ".env.local", ".mcp.json") -and
            $_.Extension -notin @(".pyc", ".cs", ".csproj", ".sln")
        } |
        ForEach-Object {
            $relativePath = $_.FullName.Substring($resolvedSourcePath.Length).TrimStart("\")
            $destinationFilePath = Join-Path $DestinationPath $relativePath
            New-Item -ItemType Directory -Path (Split-Path -Parent $destinationFilePath) -Force | Out-Null
            Copy-Item -LiteralPath $_.FullName -Destination $destinationFilePath -Force
        }
}

function Copy-CommonPackage([string]$DestinationPath) {
    foreach ($directoryName in @("licenses", "payload", "scripts", "sdk", "skills", "ui")) {
        $sourceDirectory = Join-Path $distributionRoot $directoryName
        if (-not (Test-Path -LiteralPath $sourceDirectory)) {
            throw "公共发行底座缺少目录：$directoryName"
        }
        Copy-ReleaseTree $sourceDirectory (Join-Path $DestinationPath $directoryName)
    }

    Copy-ReleaseTree (Join-Path $coreRoot "legal") $DestinationPath
}

function Assert-StagedPackage([string]$PackageRoot, [string]$AdapterName) {
    foreach ($relativePath in @(
        "payload\ths-plugin\ThsPlugin.Plugin.dll",
        "scripts\configure.mjs",
        "scripts\tonghuasun-mcp-proxy.mjs",
        "skills\configure-ths\SKILL.md"
    )) {
        if (-not (Test-Path -LiteralPath (Join-Path $PackageRoot $relativePath))) {
            throw "$AdapterName 发行包缺少：$relativePath"
        }
    }

    $forbiddenFiles = Get-ChildItem -LiteralPath $PackageRoot -Recurse -File -Force |
        Where-Object {
            $_.Name -in @(".env", ".env.local") -or
            $_.Extension -in @(".pyc", ".cs", ".csproj", ".sln") -or
            $_.FullName -match "(^|\\)(__pycache__|\.secrets|\.git|host|control-plane)(\\|$)"
        }
    if ($forbiddenFiles) {
        throw "$AdapterName 发行包包含禁止文件：$($forbiddenFiles.FullName -join ', ')"
    }

    $adapterConfigs = Get-ChildItem -LiteralPath $PackageRoot -File -Force |
        Where-Object { $_.Name -in @(".mcp.json", "mcp.json", "cordis.patch.yml") }
    foreach ($configFile in $adapterConfigs) {
        $text = Get-Content -LiteralPath $configFile.FullName -Raw -Encoding UTF8
        if ($text -match "CONFIGURE_REQUIRED" -or $text -match "X-Tonghuasun-Codex-Token") {
            throw "$AdapterName 宿主入口仍包含令牌或令牌占位符：$($configFile.Name)"
        }
    }
}

function Compress-Plugin([string]$SourceRoot, [string]$RootName, [string]$ArchiveName) {
    $container = Join-Path (Split-Path -Parent $SourceRoot) ("archive-" + $RootName)
    New-Item -ItemType Directory -Path $container -Force | Out-Null
    $namedRoot = Join-Path $container $RootName
    Move-Item -LiteralPath $SourceRoot -Destination $namedRoot
    $archivePath = Join-Path $artifactDirectory $ArchiveName
    if (Test-Path -LiteralPath $archivePath) {
        Remove-Item -LiteralPath $archivePath -Force
    }
    Compress-Archive -LiteralPath $namedRoot -DestinationPath $archivePath -CompressionLevel Optimal
    return $archivePath
}

$temporaryRoot = Join-Path $temporaryBase ("distribution-" + $releaseVersion + "-" + $PID)
$resolvedTemporaryBase = [IO.Path]::GetFullPath($temporaryBase).TrimEnd("\") + "\"
$resolvedTemporaryRoot = [IO.Path]::GetFullPath($temporaryRoot)
if (-not $resolvedTemporaryRoot.StartsWith($resolvedTemporaryBase, [StringComparison]::OrdinalIgnoreCase)) {
    throw "拒绝使用 tonghuasun-agent/.tmp 之外的发行临时目录：$resolvedTemporaryRoot"
}

$builtArtifacts = @()
try {
    if (Test-Path -LiteralPath $resolvedTemporaryRoot) {
        Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Path $resolvedTemporaryRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $artifactDirectory -Force | Out-Null

    $codexStage = Join-Path $resolvedTemporaryRoot "codex"
    New-Item -ItemType Directory -Path $codexStage -Force | Out-Null
    Copy-ReleaseTree (Join-Path $agentRoot "codex") $codexStage
    Copy-CommonPackage $codexStage
    Copy-Item -LiteralPath (Join-Path $agentRoot "codex\.mcp.example.json") -Destination (Join-Path $codexStage ".mcp.json")
    Assert-StagedPackage $codexStage "Codex"
    $builtArtifacts += Compress-Plugin $codexStage "tonghuasun-codex" "tonghuasun-agent-codex-$releaseVersion.zip"

    $workBuddyStage = Join-Path $resolvedTemporaryRoot "workbuddy"
    New-Item -ItemType Directory -Path $workBuddyStage -Force | Out-Null
    Copy-ReleaseTree (Join-Path $agentRoot "workbuddy") $workBuddyStage
    Copy-CommonPackage $workBuddyStage
    Assert-StagedPackage $workBuddyStage "WorkBuddy"
    $builtArtifacts += Compress-Plugin $workBuddyStage "tonghuasun-agent" "tonghuasun-agent-workbuddy-$releaseVersion.zip"

    $dshStage = Join-Path $resolvedTemporaryRoot "deepseek-harness"
    New-Item -ItemType Directory -Path $dshStage -Force | Out-Null
    Copy-ReleaseTree (Join-Path $agentRoot "deepseek-harness") $dshStage
    Copy-CommonPackage $dshStage
    Assert-StagedPackage $dshStage "DeepSeek Harness"
    Push-Location $dshStage
    try {
        $packOutput = & npm pack --pack-destination $artifactDirectory --silent
        if ($LASTEXITCODE -ne 0) {
            throw "DeepSeek Harness npm 包生成失败。"
        }
        $dshArchive = Join-Path $artifactDirectory ([string]$packOutput | Select-Object -Last 1)
        $builtArtifacts += $dshArchive
    }
    finally {
        Pop-Location
    }

    foreach ($artifactPath in $builtArtifacts) {
        Write-Output "artifact_path=$artifactPath"
        Write-Output "artifact_sha256=$((Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant())"
    }
    Write-Output "payload_files=$($payloadFiles.Count)"
    Write-Output "build_complete=true"
}
finally {
    if (Test-Path -LiteralPath $resolvedTemporaryRoot) {
        Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force
    }
}
