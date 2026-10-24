param(
    [Parameter(Mandatory = $true)][string]$OutDir
)

<#
.SYNOPSIS
    Build the folder that gets sent to another person.

.DESCRIPTION
    One installer plus the install notes, zipped together, so the recipient
    only needs to unpack and double-click.

    The installer is chosen by version, not by file order. Sorting by name
    picked 0.1.0 over 0.2.0 because "0.1" sorts before "0.2" as text once the
    separator differs, and the zip then carried the wrong build.
#>

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$bundleDir = Join-Path $root "src-tauri\target\release\bundle\nsis"

# Parse the version out of each installer name and take the highest.
$setup = Get-ChildItem $bundleDir -Filter "*-setup.exe" |
    ForEach-Object {
        if ($_.BaseName -match "_([0-9]+\.[0-9]+\.[0-9]+)_x64-setup$") {
            [pscustomobject]@{ File = $_; Version = [version]$Matches[1] }
        }
    } |
    Sort-Object Version -Descending |
    Select-Object -First 1

if (-not $setup) {
    throw "No installer found; run 'npm run tauri:build' first."
}

$installer = $setup.File
$version = $setup.Version.ToString()

Write-Host "Selected installer: $($installer.Name) (version $version)"

$packageDir = Join-Path $OutDir "LexiFlow-$version"
Remove-Item $packageDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $packageDir | Out-Null

Copy-Item $installer.FullName (Join-Path $packageDir $installer.Name)

# The share note is plain text so it opens on a double-click, and it talks
# about installing the file the recipient already has rather than downloading
# from GitHub.
$notes = Join-Path $root "docs\INSTALL-SHARE.txt"
if (Test-Path $notes) {
    $noteName = [char]0x5148 + [char]0x8BFB + [char]0x6211 + "-" + `
        [char]0x5B89 + [char]0x88C5 + [char]0x8BF4 + [char]0x660E + ".txt"
    Copy-Item $notes (Join-Path $packageDir $noteName)
}

$zip = Join-Path $OutDir "LexiFlow-$version.zip"
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path $packageDir -DestinationPath $zip -CompressionLevel Optimal

$zipMb = [math]::Round((Get-Item $zip).Length / 1MB, 2)
Write-Host "Package built:"
Write-Host "  folder: $packageDir"
Write-Host "  zip:    $zip ($zipMb MB)"
