param([string]$Launcher, [string]$TestRoot, [string]$FixtureZip)
$ErrorActionPreference = 'Stop'
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Launcher, [ref]$null, [ref]$null)
foreach ($item in $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
    . ([scriptblock]::Create($item.Extent.Text))
}
$studioRoot = $TestRoot
$script:badHash = $false
$script:requests = @()
# Exercise the actual bootstrap against a fixed local HTTP response fixture.
# No network, global installations, PATH edits, or personal host writes.
function Invoke-WebRequest {
    param([switch]$UseBasicParsing, [string]$Uri, [string]$OutFile, [int]$TimeoutSec)
    $script:requests += $Uri
    if ($Uri -eq 'https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt') {
        $hash = if ($script:badHash) { '0' * 64 } else { Get-StudioSha256 $FixtureZip }
        return @{ Content = "$hash  node-v22.0.0-win-x64.zip`n" }
    }
    if ($Uri -ne 'https://nodejs.org/dist/v22.0.0/node-v22.0.0-win-x64.zip' -or -not $OutFile) { throw "Unexpected request: $Uri" }
    Copy-Item -LiteralPath $FixtureZip -Destination $OutFile
}
$env:PROCESSOR_ARCHITECTURE = 'AMD64'
$env:PROCESSOR_ARCHITEW6432 = ''
$installed = Install-StudioNode
if (-not (Test-StudioNode $installed)) { throw 'Portable Node did not start' }
if ((Find-StudioNode) -ne $installed) { throw 'Portable Node was not reused' }
$before = Get-StudioSha256 $installed
$script:badHash = $true
$rejected = $false
try { Install-StudioNode | Out-Null } catch { $rejected = $true }
if (-not $rejected) { throw 'Tampered download was accepted' }
if ((Get-StudioSha256 $installed) -ne $before) { throw 'Existing Node changed on failure' }
if ($script:requests.Count -ne 4) { throw 'Unexpected download sequence' }
Write-Output 'Windows PowerShell bootstrap download, checksum, extraction and reuse: OK'
