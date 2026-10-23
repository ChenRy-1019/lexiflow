param(
    [Parameter(Mandatory = $true)][string]$OutDir
)

<#
.SYNOPSIS
    Build the folder that gets sent to another person.

.DESCRIPTION
    One installer plus the install notes, zipped together, so the recipient
    only needs to unpack and double-click. The zip is named after the app and
    version so several builds can sit side by side.
#>

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$setup = Get-ChildItem (Join-Path $root "src-tauri\target\release\bundle\nsis") -Filter "*-setup.exe" |
    Select-Object -First 1
if (-not $setup) {
    throw "No installer found; run 'npm run tauri:build' first."
}

$version = ($setup.BaseName -replace "^.*?_", "") -replace "_x64-setup$", ""
$packageDir = Join-Path $OutDir "LexiFlow-$version"
Remove-Item $packageDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $packageDir | Out-Null

Copy-Item $setup.FullName (Join-Path $packageDir $setup.Name)

$notes = Join-Path $root "docs\INSTALL.md"
if (Test-Path $notes) {
    # Rename to something a non-technical recipient will actually open.
    Copy-Item $notes (Join-Path $packageDir "先读我-安装说明.md")
}

$zip = Join-Path $OutDir "LexiFlow-$version.zip"
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path $packageDir -DestinationPath $zip -CompressionLevel Optimal

$zipMb = [math]::Round((Get-Item $zip).Length / 1MB, 2)
Write-Host "Package built:"
Write-Host "  folder: $packageDir"
Write-Host "  zip:    $zip ($zipMb MB)"
