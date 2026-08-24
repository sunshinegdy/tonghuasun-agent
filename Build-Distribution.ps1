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
Assert-AdapterVersion (Join-Path $agentRoot "claude-code\.claude-plugin\plugin.json") "Claude Code"
Assert-AdapterVersion (Join-Path $agentRoot "workbuddy\.codebuddy-plugin\plugin.json") "WorkBuddy"
Assert-AdapterVersion (Join-Path $agentRoot "zcode\.zcode-plugin\plugin.json") "ZCode"
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

function Assert-NoLegacyCommercialState([string]$PackageRoot, [string]$AdapterName) {
    $forbiddenNames = @("subscription-center.html", "entitlement.json", "account.dat")
    $forbiddenMarkers = @(
        "subscription_required",
        "ths_subscription_status",
        "ths_subscription_begin_link",
        "ths_subscription_create_checkout",
        "free_quota",
        "commerceMode",
        "subscriptionServiceBaseUrl",
        "subscriptionExpiresAtUtc",
        "canPurchase",
        "monthlyFen",
        "yearlyFen",
        "entitlement",
        "完整权益",
        "基础版权益",
        "月付",
        "年付"
    )

    $packageFiles = @(Get-ChildItem -LiteralPath $PackageRoot -Recurse -File -Force)
    $forbiddenFiles = @($packageFiles | Where-Object {
        $_.Name -in $forbiddenNames -or $_.FullName -match "(^|\\)usage(\\|$)"
    })
    if ($forbiddenFiles.Count -gt 0) {
        throw "$AdapterName 发行包包含旧版订阅状态文件：$($forbiddenFiles.FullName -join ', ')"
    }

    foreach ($file in $packageFiles) {
        $bytes = [IO.File]::ReadAllBytes($file.FullName)
        $utf8Text = [Text.Encoding]::UTF8.GetString($bytes)
        $utf16EvenText = [Text.Encoding]::Unicode.GetString($bytes)
        $utf16OddText = if ($bytes.Length -gt 1) {
            [Text.Encoding]::Unicode.GetString($bytes, 1, $bytes.Length - 1)
        }
        else {
            ""
        }

        foreach ($marker in $forbiddenMarkers) {
            if ($utf8Text.IndexOf($marker, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
                $utf16EvenText.IndexOf($marker, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
                $utf16OddText.IndexOf($marker, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
                $relativePath = $file.FullName.Substring($PackageRoot.Length).TrimStart("\")
                throw "$AdapterName 发行包仍包含旧版订阅门禁标记 '$marker'：$relativePath"
            }
        }
    }
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

    Assert-NoLegacyCommercialState $PackageRoot $AdapterName

    $adapterConfigs = Get-ChildItem -LiteralPath $PackageRoot -File -Force |
        Where-Object { $_.Name -in @(".mcp.json", "mcp.json", "cordis.patch.yml") }
    foreach ($configFile in $adapterConfigs) {
        $text = Get-Content -LiteralPath $configFile.FullName -Raw -Encoding UTF8
        if ($text -match "CONFIGURE_REQUIRED" -or $text -match "X-Tonghuasun-Codex-Token") {
            throw "$AdapterName 宿主入口仍包含令牌或令牌占位符：$($configFile.Name)"
        }
    }
}

function Assert-WorkBuddyPackage([string]$PackageRoot) {
    $manifestPath = Join-Path $PackageRoot ".codebuddy-plugin\plugin.json"
    $mcpConfigPath = Join-Path $PackageRoot ".mcp.json"
    foreach ($requiredPath in @($manifestPath, $mcpConfigPath)) {
        if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
            throw "WorkBuddy 发行包缺少原生入口：$requiredPath"
        }
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([string]$manifest.mcpServers -ne "./.mcp.json") {
        throw "WorkBuddy 清单必须通过 ./.mcp.json 加载 MCP。"
    }

    $mcpConfigText = Get-Content -LiteralPath $mcpConfigPath -Raw -Encoding UTF8
    if ($mcpConfigText -notmatch [regex]::Escape('${CODEBUDDY_PLUGIN_ROOT}')) {
        throw "WorkBuddy MCP 配置必须使用 CODEBUDDY_PLUGIN_ROOT。"
    }
    if ($mcpConfigText -match [regex]::Escape('${PLUGIN_ROOT}') -or
        $mcpConfigText -match [regex]::Escape('${CLAUDE_PLUGIN_ROOT}')) {
        throw "WorkBuddy MCP 配置包含其他宿主的根目录变量。"
    }

    foreach ($forbiddenRelativePath in @("plugin.json", "mcp.json", ".claude-plugin", ".codex-plugin", "workbuddy")) {
        if (Test-Path -LiteralPath (Join-Path $PackageRoot $forbiddenRelativePath)) {
            throw "WorkBuddy 发行包包含错误或嵌套入口：$forbiddenRelativePath"
        }
    }
}

function Assert-ZCodePackage([string]$PackageRoot) {
    $manifestPath = Join-Path $PackageRoot ".zcode-plugin\plugin.json"
    $mcpConfigPath = Join-Path $PackageRoot ".mcp.json"
    foreach ($requiredPath in @($manifestPath, $mcpConfigPath)) {
        if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
            throw "ZCode 发行包缺少原生入口：$requiredPath"
        }
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([string]$manifest.skills -ne "skills") {
        throw "ZCode 清单必须从 skills 目录加载技能。"
    }
    if ([string]$manifest.mcpServers -ne ".mcp.json") {
        throw "ZCode 清单必须通过 .mcp.json 加载 MCP。"
    }

    $mcpConfigText = Get-Content -LiteralPath $mcpConfigPath -Raw -Encoding UTF8
    if ($mcpConfigText -notmatch [regex]::Escape('${ZCODE_PLUGIN_ROOT}')) {
        throw "ZCode MCP 配置必须使用 ZCODE_PLUGIN_ROOT。"
    }
    foreach ($foreignRoot in @('${CLAUDE_PLUGIN_ROOT}', '${CODEBUDDY_PLUGIN_ROOT}', '${CODEX_PLUGIN_ROOT}')) {
        if ($mcpConfigText -match [regex]::Escape($foreignRoot)) {
            throw "ZCode MCP 配置包含其他宿主的根目录变量：$foreignRoot"
        }
    }

    foreach ($forbiddenRelativePath in @(".claude-plugin", ".codex-plugin", ".codebuddy-plugin", "zcode")) {
        if (Test-Path -LiteralPath (Join-Path $PackageRoot $forbiddenRelativePath)) {
            throw "ZCode 发行包包含其他宿主或嵌套入口：$forbiddenRelativePath"
        }
    }
}

function Compress-Plugin([string]$SourceRoot, [string]$RootName, [string]$ArchiveName) {
    $archiveBaseName = [IO.Path]::GetFileNameWithoutExtension($ArchiveName)
    $container = Join-Path (Split-Path -Parent $SourceRoot) ("archive-" + $archiveBaseName)
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

function Assert-WorkBuddyArchive([string]$ArchivePath, [string]$RootName) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        $entries = @($archive.Entries | ForEach-Object { $_.FullName.Replace("\", "/") })
        $requiredEntries = @(
            "$RootName/.codebuddy-plugin/plugin.json",
            "$RootName/.mcp.json"
        )
        foreach ($requiredEntry in $requiredEntries) {
            if ($entries -cnotcontains $requiredEntry) {
                throw "WorkBuddy ZIP 缺少原生入口：$requiredEntry"
            }
        }

        $forbiddenPrefixes = @(
            "$RootName/.claude-plugin/",
            "$RootName/.codex-plugin/",
            "$RootName/workbuddy/"
        )
        $forbiddenEntries = @(
            "$RootName/plugin.json",
            "$RootName/mcp.json"
        )
        $pollutedEntries = @($entries | Where-Object {
            $entry = $_
            $forbiddenEntries -ccontains $entry -or
            @($forbiddenPrefixes | Where-Object { $entry.StartsWith($_, [StringComparison]::Ordinal) }).Count -gt 0
        })
        if ($pollutedEntries.Count -gt 0) {
            throw "WorkBuddy ZIP 包含其他宿主或嵌套入口：$($pollutedEntries -join ', ')"
        }
    }
    finally {
        $archive.Dispose()
    }
}

function Assert-ZCodeArchive([string]$ArchivePath, [string]$RootName) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        $entries = @($archive.Entries | ForEach-Object { $_.FullName.Replace("\", "/") })
        foreach ($requiredEntry in @(
            "$RootName/.zcode-plugin/plugin.json",
            "$RootName/.mcp.json",
            "$RootName/skills/configure-ths/SKILL.md",
            "$RootName/scripts/tonghuasun-mcp-proxy.mjs"
        )) {
            if ($entries -cnotcontains $requiredEntry) {
                throw "ZCode ZIP 缺少原生入口或公共能力：$requiredEntry"
            }
        }

        foreach ($forbiddenPrefix in @(
            "$RootName/.claude-plugin/",
            "$RootName/.codex-plugin/",
            "$RootName/.codebuddy-plugin/"
        )) {
            if (@($entries | Where-Object { $_.StartsWith($forbiddenPrefix, [StringComparison]::Ordinal) }).Count -gt 0) {
                throw "ZCode ZIP 包含其他宿主入口：$forbiddenPrefix"
            }
        }
    }
    finally {
        $archive.Dispose()
    }
}

function Write-ZCodeMarketplace(
    [string]$MarketplaceRoot,
    [string]$PluginSourceRoot,
    [string]$PluginRoot,
    [string]$Version
) {
    New-Item -ItemType Directory -Path $PluginRoot -Force | Out-Null
    Get-ChildItem -LiteralPath $PluginSourceRoot -Force |
        Copy-Item -Destination $PluginRoot -Recurse -Force

    # ZCode 插件本体使用 .zcode-plugin，但 3.8.x 的本地市场仍沿用
    # Claude 兼容目录读取 marketplace.json，两者不能混用。
    $marketplaceManifestDirectory = Join-Path $MarketplaceRoot ".claude-plugin"
    New-Item -ItemType Directory -Path $marketplaceManifestDirectory -Force | Out-Null
    $marketplaceManifest = [ordered]@{
        name = "tonghuasun-agent-local"
        description = "同花顺 Agent 的 ZCode 本地插件市场。"
        plugins = @(
            [ordered]@{
                name = "tonghuasun-agent"
                source = "./tonghuasun-agent"
                description = "连接本机同花顺，在 ZCode 中查询行情、持仓并使用实时盯盘。"
                version = $Version
                category = "productivity"
                tags = @("同花顺", "证券", "行情", "MCP")
                strict = $true
            }
        )
    }
    $marketplaceManifest |
        ConvertTo-Json -Depth 8 |
        Set-Content -LiteralPath (Join-Path $marketplaceManifestDirectory "marketplace.json") -Encoding UTF8
}

function Assert-ZCodeMarketplace([string]$MarketplaceRoot, [string]$Version) {
    $manifestPath = Join-Path $MarketplaceRoot ".claude-plugin\marketplace.json"
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "ZCode 本地市场缺少清单：$manifestPath"
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $plugins = @($manifest.plugins)
    if ($plugins.Count -ne 1 -or
        [string]$plugins[0].name -ne "tonghuasun-agent" -or
        [string]$plugins[0].source -ne "./tonghuasun-agent" -or
        [string]$plugins[0].version -ne $Version) {
        throw "ZCode 本地市场条目与插件版本不一致。"
    }

    Assert-ZCodePackage (Join-Path $MarketplaceRoot "tonghuasun-agent")
}

function Assert-ZCodeMarketplaceArchive([string]$ArchivePath, [string]$RootName) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        $entries = @($archive.Entries | ForEach-Object { $_.FullName.Replace("\", "/") })
        foreach ($requiredEntry in @(
            "$RootName/.claude-plugin/marketplace.json",
            "$RootName/tonghuasun-agent/.zcode-plugin/plugin.json",
            "$RootName/tonghuasun-agent/.mcp.json"
        )) {
            if ($entries -cnotcontains $requiredEntry) {
                throw "ZCode 本地市场 ZIP 缺少：$requiredEntry"
            }
        }
    }
    finally {
        $archive.Dispose()
    }
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

    $claudeStage = Join-Path $resolvedTemporaryRoot "claude-code"
    New-Item -ItemType Directory -Path $claudeStage -Force | Out-Null
    Copy-ReleaseTree (Join-Path $agentRoot "claude-code") $claudeStage
    Copy-CommonPackage $claudeStage
    Copy-Item -LiteralPath (Join-Path $agentRoot "claude-code\.mcp.json") -Destination (Join-Path $claudeStage ".mcp.json")
    Assert-StagedPackage $claudeStage "Claude Code"
    $builtArtifacts += Compress-Plugin $claudeStage "tonghuasun-agent" "tonghuasun-agent-claude-code-$releaseVersion.zip"

    $workBuddyStage = Join-Path $resolvedTemporaryRoot "workbuddy"
    New-Item -ItemType Directory -Path $workBuddyStage -Force | Out-Null
    Copy-ReleaseTree (Join-Path $agentRoot "workbuddy") $workBuddyStage
    Copy-Item -LiteralPath (Join-Path $agentRoot "workbuddy\.mcp.json") -Destination (Join-Path $workBuddyStage ".mcp.json")
    Copy-CommonPackage $workBuddyStage
    Assert-StagedPackage $workBuddyStage "WorkBuddy"
    Assert-WorkBuddyPackage $workBuddyStage
    $workBuddyArtifact = Compress-Plugin $workBuddyStage "tonghuasun-agent" "tonghuasun-agent-workbuddy-$releaseVersion.zip"
    Assert-WorkBuddyArchive $workBuddyArtifact "tonghuasun-agent"
    $builtArtifacts += $workBuddyArtifact

    $zCodeStage = Join-Path $resolvedTemporaryRoot "zcode"
    New-Item -ItemType Directory -Path $zCodeStage -Force | Out-Null
    Copy-ReleaseTree (Join-Path $agentRoot "zcode") $zCodeStage
    Copy-Item -LiteralPath (Join-Path $agentRoot "zcode\.mcp.json") -Destination (Join-Path $zCodeStage ".mcp.json")
    Copy-CommonPackage $zCodeStage
    Assert-StagedPackage $zCodeStage "ZCode"
    Assert-ZCodePackage $zCodeStage

    $zCodeMarketplaceStage = Join-Path $resolvedTemporaryRoot "zcode-marketplace"
    $zCodeMarketplacePluginRoot = Join-Path $zCodeMarketplaceStage "tonghuasun-agent"
    New-Item -ItemType Directory -Path $zCodeMarketplaceStage -Force | Out-Null
    Write-ZCodeMarketplace $zCodeMarketplaceStage $zCodeStage $zCodeMarketplacePluginRoot $releaseVersion
    Assert-ZCodeMarketplace $zCodeMarketplaceStage $releaseVersion

    $zCodeArtifact = Compress-Plugin $zCodeStage "tonghuasun-agent" "tonghuasun-agent-zcode-$releaseVersion.zip"
    Assert-ZCodeArchive $zCodeArtifact "tonghuasun-agent"
    $builtArtifacts += $zCodeArtifact

    $zCodeMarketplaceArtifact = Compress-Plugin `
        $zCodeMarketplaceStage `
        "tonghuasun-agent-zcode-marketplace" `
        "tonghuasun-agent-zcode-marketplace-$releaseVersion.zip"
    Assert-ZCodeMarketplaceArchive $zCodeMarketplaceArtifact "tonghuasun-agent-zcode-marketplace"
    $builtArtifacts += $zCodeMarketplaceArtifact

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
