param(
    [Parameter(Mandatory = $true)][string]$Repo,
    [string]$Tag = "",
    [string]$OutDir = "release",
    # Where the installer is hosted. A mirror such as Gitee is used for the
    # download because the upstream GitHub asset URL times out for learners in
    # mainland China, even though the manifest itself is reachable.
    [string]$BaseUrl = ""
)

# Build the update manifest Tauri's updater reads.
#
# Tauri looks for latest.json at the release's download URL and compares the
# version and signature it lists against the running build. The signature
# must come from the signing key whose public half is compiled into the
# application, otherwise the updater rejects the package.
#
# The file is written as UTF-8 without a BOM: PowerShell's default writer
# emits UTF-16 or the locale encoding, which turns the Chinese notes into
# mojibake in the update dialog.

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$bundleDir = Join-Path $root "src-tauri\target\release\bundle\nsis"

$setup = Get-ChildItem $bundleDir -Filter "*-setup.exe" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not $setup) {
    throw "No installer found; run npm run tauri:build first."
}

$sigFile = "$($setup.FullName).sig"
if (-not (Test-Path $sigFile)) {
    throw "No signature beside $($setup.Name). Build with TAURI_SIGNING_PRIVATE_KEY set."
}

# The version comes from the file name, which the bundler derives from
# tauri.conf.json, so the manifest cannot drift from the binary.
if ($setup.BaseName -match "_([0-9.]+)_x64-setup$") {
    $version = $Matches[1]
} else {
    throw "Cannot read the version from $($setup.Name)"
}

if (-not $Tag) {
    $Tag = "v$version"
}

$signature = (Get-Content $sigFile -Raw -Encoding UTF8).Trim()

$notesPath = Join-Path $root "release-notes.md"
$notes = if (Test-Path $notesPath) {
    (Get-Content $notesPath -Raw -Encoding UTF8).Trim()
} else {
    ""
}

if ($BaseUrl) {
    # A mirror serves the same file under its own host.
    $url = "$($BaseUrl.TrimEnd('/'))/$($setup.Name)"
} else {
    $url = "https://github.com/$Repo/releases/download/$Tag/$($setup.Name)"
}

$manifest = [ordered]@{
    version   = $version
    notes     = $notes
    pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = [ordered]@{
        "windows-x86_64" = [ordered]@{
            signature = $signature
            url       = $url
        }
    }
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$manifestPath = Join-Path $OutDir "latest.json"

$json = $manifest | ConvertTo-Json -Depth 6
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($manifestPath, $json, $utf8NoBom)

# Read it back and prove the Chinese survived the write.
$check = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8
if ($check -match "[$([char]0x4e00)-$([char]0x9fa5)]") {
    Write-Host "Chinese notes verified in the manifest."
} else {
    Write-Warning "The manifest contains no readable Chinese; check the encoding."
}

Write-Host "Manifest written:"
Write-Host "  version: $version"
Write-Host "  tag:     $Tag"
Write-Host "  url:     $url"
Write-Host "  file:    $manifestPath"
