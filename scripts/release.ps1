param(
    [string]$Version = "",
    [switch]$SkipTests
)

<#
.SYNOPSIS
    Publish a release to GitHub and the Gitee mirror.

.DESCRIPTION
    The updater checks Gitee first because a mainland connection cannot fetch
    the GitHub asset URL, and the installer is hosted there for the same reason.

    Publishing is split in two so the GitHub step still needs the author's
    approval: this script prepares and mirrors, and prints the one GitHub
    command that remains. Run it with -WhatIf to see the plan.

    The token is read from $env:GITEE_TOKEN and is never written to disk.
#>

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $env:GITEE_TOKEN) {
    throw "Set GITEE_TOKEN first."
}

$conf = Get-Content "src-tauri/tauri.conf.json" -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $Version) {
    $Version = $conf.version
}
$tag = "v$Version"
$giteeBase = "https://gitee.com/chens-code-rythm/lexiflow/releases/download/$tag"

Write-Host "Releasing $tag"
Write-Host ""

# --- 1. checks -------------------------------------------------------------
if (-not $SkipTests) {
    Write-Host "Typechecking"
    & "E:\develop\Node\npx.cmd" tsc --noEmit
    if ($LASTEXITCODE -ne 0) { throw "typecheck failed" }

    Write-Host "Running frontend tests"
    & "E:\develop\Node\npx.cmd" vitest run
    if ($LASTEXITCODE -ne 0) { throw "frontend tests failed" }

    Write-Host "Running backend tests"
    Push-Location "src-tauri"
    $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
    & cargo test
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw "backend tests failed" }
    Pop-Location
}

# --- 2. build --------------------------------------------------------------
Write-Host "Building"
Get-Process -Name "lexiflow" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content "$env:USERPROFILE\.lexiflow-keys\lexiflow.key" -Raw)
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "lexiflow-updater-2026"

& "E:\develop\Node\npx.cmd" tauri build
if ($LASTEXITCODE -ne 0) { throw "build failed" }

# --- 3. mirror to Gitee ----------------------------------------------------
Write-Host "Uploading to Gitee"
$py = "C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
& $py "scripts\publish-gitee.py" --tag $tag
if ($LASTEXITCODE -ne 0) { throw "gitee upload failed" }

# --- 4. manifest -----------------------------------------------------------
# The manifest names the Gitee URL, so a learner's updater downloads from the
# mirror rather than from GitHub.
Write-Host "Writing the manifest"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\manifest.ps1" `
    -Repo "ChenRy-1019/lexiflow" -Tag $tag -BaseUrl $giteeBase
if ($LASTEXITCODE -ne 0) { throw "manifest failed" }

Copy-Item "release\latest.json" "updates\latest.json" -Force

& $py "scripts\publish-gitee.py" --tag $tag

# --- 5. share package -----------------------------------------------------
Write-Host "Packaging the share zip"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\package.ps1" -OutDir "release"
if ($LASTEXITCODE -ne 0) { throw "packaging failed" }

Write-Host ""
Write-Host "Prepared $tag"
Write-Host ""
Write-Host "Remaining step, which needs the author's approval:"
Write-Host "  gh release create $tag <setup.exe> <setup.exe.sig> release/latest.json --title ... --notes-file release-notes.md"
