param(
    [Parameter(Mandatory = $true)][string]$Repo
)

<#
.SYNOPSIS
    Publish the current build as a GitHub release.

.DESCRIPTION
    Creates the tag, uploads the three files the updater needs, and marks the
    release as latest. All three are required: without the signature the
    updater refuses the package, and without the manifest clients never learn
    that a new version exists.
#>

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$bundleDir = Join-Path $root "src-tauri\target\release\bundle\nsis"

$setup = Get-ChildItem $bundleDir -Filter "*-setup.exe" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not $setup) {
    throw "No installer found; run 'npm run tauri:build' first."
}

$sig = "$($setup.FullName).sig"
if (-not (Test-Path $sig)) {
    throw "No signature beside $($setup.Name); build with TAURI_SIGNING_PRIVATE_KEY set."
}

if ($setup.BaseName -notmatch "_([0-9.]+)_x64-setup$") {
    throw "Cannot read the version from $($setup.Name)"
}
$version = $Matches[1]
$tag = "v$version"

$manifest = Join-Path $root "release\latest.json"
if (-not (Test-Path $manifest)) {
    throw "No manifest; run 'npm run release:manifest' first."
}

$notes = Join-Path $root "release-notes.md"
if (-not (Test-Path $notes)) {
    throw "No release-notes.md; write the update notes before publishing."
}

Write-Host "Publishing $tag"
Write-Host "  installer: $($setup.Name) ($([math]::Round($setup.Length / 1MB, 2)) MB)"
Write-Host "  signature: $([System.IO.Path]::GetFileName($sig))"
Write-Host "  manifest:  latest.json"

& gh release create $tag $setup.FullName $sig $manifest `
    --repo $Repo `
    --title "LexiFlow $version" `
    --notes-file $notes
if ($LASTEXITCODE -ne 0) {
    throw "gh release create failed."
}

Write-Host ""
Write-Host "Published: https://github.com/$Repo/releases/tag/$tag"
Write-Host "Installed copies will offer the update on their next check."
