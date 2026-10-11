param([ValidateSet('start', 'update')][string]$Mode = 'start')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$studioRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $studioRoot

function Test-StudioNode([string]$Program) {
    if (-not $Program -or -not (Test-Path -LiteralPath $Program -PathType Leaf)) { return $false }
    try {
        $version = & $Program -p 'process.versions.node' 2>$null
        return $LASTEXITCODE -eq 0 -and $version -match '^\d+\.' -and [int]($version.Split('.')[0]) -ge 22
    } catch { return $false }
}
function Find-StudioNode {
    $portable = Join-Path $studioRoot '.local\runtime\node\node.exe'
    if (Test-StudioNode $portable) { return $portable }
    $installed = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($installed -and (Test-StudioNode $installed.Source)) { return $installed.Source }
    return $null
}
function Get-StudioSha256([string]$File) {
    $stream = [IO.File]::OpenRead($File)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}
function Install-StudioNode {
    Write-Host '正在准备工作台运行环境（仅首次下载，无需管理员权限）…'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    $arch = switch ($architecture) { 'ARM64' { 'arm64' } 'AMD64' { 'x64' } default { throw '自动运行环境支持 Windows x64 / ARM64。' } }
    $checksumText = (Invoke-WebRequest -UseBasicParsing -Uri 'https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt' -TimeoutSec 60).Content
    $match = [regex]::Match($checksumText, "(?m)^([a-f0-9]{64})\s+(node-(v22\.\d+\.\d+)-win-$arch\.zip)\s*$")
    if (-not $match.Success) { throw '未找到 Node.js 官方运行环境，请检查网络后重试。' }
    $archiveName = $match.Groups[2].Value
    $version = $match.Groups[3].Value
    $runtimeRoot = Join-Path $studioRoot '.local\runtime'
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    if ((Get-Item -LiteralPath $runtimeRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '运行环境目录不能是链接。' }
    $stage = Join-Path $runtimeRoot ('download-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stage | Out-Null
    $archive = Join-Path $stage $archiveName
    Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$version/$archiveName" -OutFile $archive -TimeoutSec 300
    if ((Get-StudioSha256 $archive) -ne $match.Groups[1].Value) { throw '运行环境下载校验失败，请重新双击启动；现有文件未替换。' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($archive, $stage)
    $unpacked = Join-Path $stage ([IO.Path]::GetFileNameWithoutExtension($archiveName))
    if (-not (Test-StudioNode (Join-Path $unpacked 'node.exe'))) { throw '运行环境无法启动。' }
    $destination = Join-Path $runtimeRoot 'node'
    if (Test-Path -LiteralPath $destination) {
        if ((Get-Item -LiteralPath $destination).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '运行环境目标不能是链接。' }
        Move-Item -LiteralPath $destination -Destination (Join-Path $runtimeRoot ('previous-' + [Guid]::NewGuid().ToString('N')))
    }
    Move-Item -LiteralPath $unpacked -Destination $destination
    # Delete only the verified temporary child created above, never a computed
    # application or user-data directory.
    $resolvedStage = (Resolve-Path -LiteralPath $stage).Path
    $resolvedRuntime = (Resolve-Path -LiteralPath $runtimeRoot).Path
    if ([IO.Path]::GetDirectoryName($resolvedStage) -ne $resolvedRuntime -or [IO.Path]::GetFileName($resolvedStage) -notmatch '^download-[a-f0-9]{32}$') { throw '临时目录校验失败。' }
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
    return (Join-Path $destination 'node.exe')
}
function Install-StudioDependencies([string]$Node, [bool]$Force) {
    if (-not $Force) {
        & $Node -e "import('css-tree').catch(()=>process.exit(1))" 2>$null
        if ($LASTEXITCODE -eq 0) { return }
    }
    Write-Host '正在准备工作台依赖…'
    $npmCli = Join-Path (Split-Path -Parent $Node) 'node_modules\npm\bin\npm-cli.js'
    if (Test-Path -LiteralPath $npmCli) {
        & $Node $npmCli ci --omit=dev --ignore-scripts
    } else {
        $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
        if (-not $npm) { throw '未找到 npm，请检查 Node.js 安装。' }
        & $npm.Source ci --omit=dev --ignore-scripts
    }
    if ($LASTEXITCODE -ne 0) { throw '依赖准备未完成，请检查网络后重试。' }
}
try {
    $studioNode = Find-StudioNode
    if (-not $studioNode) { $studioNode = Install-StudioNode }
    $env:PATH = (Split-Path -Parent $studioNode) + [IO.Path]::PathSeparator + $env:PATH
    if ($Mode -eq 'update') {
        & $studioNode (Join-Path $studioRoot 'scripts\update.js')
        if ($LASTEXITCODE -ne 0) { throw '本次更新未完成，请按上面的提示处理。仍可使用 start.cmd。' }
    }
    Install-StudioDependencies $studioNode ($Mode -eq 'update' -and (Test-Path -LiteralPath (Join-Path $studioRoot '.git')))
    & $studioNode (Join-Path $studioRoot 'scripts\launcher.js')
    exit $LASTEXITCODE
} catch {
    Write-Host ("`n" + $_.Exception.Message) -ForegroundColor Red
    Write-Host '已有作品和酒馆数据会保留。解决后重新双击即可。'
    exit 1
}
