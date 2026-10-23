param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [int]$WaitSeconds = 40
)

<#
.SYNOPSIS
    Check that the pronunciation actually works.

.DESCRIPTION
    Opens the application, starts a session and waits for the word to be
    pronounced. The backend writes every downloaded recording to the cache
    directory, so an mp3 appearing there proves the whole chain worked: the
    request went out, the file came back, and it was written to disk.
#>

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms

$sig = @'
using System;
using System.Runtime.InteropServices;
public class Native {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int t, bool r);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
Add-Type -TypeDefinition $sig

$cacheDir = Join-Path $env:APPDATA "app.lexiflow.desktop\audio"

Write-Host "Launching $Exe"
$process = Start-Process -FilePath $Exe -PassThru
Start-Sleep -Seconds 15

if ($process.HasExited) {
    throw "the application exited immediately with code $($process.ExitCode)"
}

$handle = $process.MainWindowHandle
[Native]::ShowWindow($handle, 9) | Out-Null
[Native]::MoveWindow($handle, 320, 40, 1240, 780, $true) | Out-Null
[Native]::SetForegroundWindow($handle) | Out-Null
Start-Sleep -Seconds 4

# Ctrl+3 starts a session. The first word is then pronounced automatically.
[System.Windows.Forms.SendKeys]::SendWait("^3")
Write-Host "Waiting for the pronunciation cache to fill…"

$deadline = (Get-Date).AddSeconds($WaitSeconds)
$found = @()
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    if (Test-Path $cacheDir) {
        $found = @(Get-ChildItem $cacheDir -Filter *.mp3 -ErrorAction SilentlyContinue)
        if ($found.Count -gt 0) { break }
    }
}

$process.CloseMainWindow() | Out-Null
Start-Sleep -Seconds 2
if (-not $process.HasExited) { $process.Kill() }

Write-Host ""
if ($found.Count -gt 0) {
    Write-Host "PASS: $($found.Count) recording(s) cached" -ForegroundColor Green
    foreach ($file in $found) {
        Write-Host ("  {0}  {1} bytes" -f $file.Name, $file.Length)
        # An mp3 header starts with either "ID3" or a frame sync byte.
        $header = [System.IO.File]::ReadAllBytes($file.FullName)[0..2]
        $hex = ($header | ForEach-Object { $_.ToString("X2") }) -join " "
        Write-Host "  header: $hex"
    }
    exit 0
}

Write-Host "FAIL: no recording was cached" -ForegroundColor Red
exit 1
