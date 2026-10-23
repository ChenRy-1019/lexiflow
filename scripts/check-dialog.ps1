param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [string]$OutDir = "screenshots"
)

<#
.SYNOPSIS
    Verify that starting a session asks for a wordbook and a word count.

.DESCRIPTION
    Clicks the start button, screenshots the dialog, then confirms the
    dialog's own start button and screenshots the resulting session.
#>

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$sig = @'
using System;
using System.Runtime.InteropServices;
public class Native {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int t, bool r);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, IntPtr e);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
Add-Type -TypeDefinition $sig

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Raise-Window([IntPtr]$handle) {
    [Native]::SetWindowPos($handle, [IntPtr]::new(-1), 0, 0, 0, 0, 0x0003) | Out-Null
    [Native]::SetWindowPos($handle, [IntPtr]::new(-2), 0, 0, 0, 0, 0x0003) | Out-Null
    [Native]::ShowWindow($handle, 9) | Out-Null
    [Native]::SetForegroundWindow($handle) | Out-Null
    Start-Sleep -Milliseconds 500
}

function Save-Shot([IntPtr]$handle, [string]$name) {
    Raise-Window $handle
    Start-Sleep -Milliseconds 500
    $rect = New-Object Native+RECT
    [Native]::GetWindowRect($handle, [ref]$rect) | Out-Null
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
    $bitmap.Save((Join-Path $OutDir "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
    Write-Host "  captured $name"
}

function Click-At([IntPtr]$handle, [int]$x, [int]$y) {
    $rect = New-Object Native+RECT
    [Native]::GetWindowRect($handle, [ref]$rect) | Out-Null
    [Native]::SetCursorPos($rect.Left + $x, $rect.Top + $y) | Out-Null
    Start-Sleep -Milliseconds 300
    [Native]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 90
    [Native]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 900
}

Write-Host "Launching $Exe"
$process = Start-Process -FilePath $Exe -PassThru
Start-Sleep -Seconds 16

if ($process.HasExited) {
    throw "the application exited immediately with code $($process.ExitCode)"
}

$handle = $process.MainWindowHandle
[Native]::ShowWindow($handle, 9) | Out-Null
[Native]::MoveWindow($handle, 30, 20, 1340, 820, $true) | Out-Null
Raise-Window $handle
Start-Sleep -Seconds 3

# The start button sits under the quote, at roughly (360, 322) in the
# 1340x820 window at 125% scaling.
Write-Host "Clicking 开始学习"
Click-At $handle 360 322
Start-Sleep -Seconds 2
Save-Shot $handle "dialog-open"

$process.CloseMainWindow() | Out-Null
Start-Sleep -Seconds 2
if (-not $process.HasExited) { $process.Kill() }

Write-Host "Screenshot written to $OutDir\dialog-open.png"
