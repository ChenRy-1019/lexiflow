param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [string]$OutDir = "screenshots"
)

<#
.SYNOPSIS
    Global test: keyboard shortcuts, pronunciation, font sizes, and UI.

.DESCRIPTION
    Tests the following:
    1. F1/F2/F3 switch between spelling/choice/dictation modes
    2. Multiple words can be pronounced (not just the first one)
    3. Font sizes are readable
    4. Captures screenshots for visual inspection
#>

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

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
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
Add-Type -TypeDefinition $sig

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Save-Shot([IntPtr]$handle, [string]$name) {
    $rect = New-Object Native+RECT
    [Native]::GetWindowRect($handle, [ref]$rect) | Out-Null
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top

    if ($width -lt 200 -or $height -lt 200) {
        [Native]::ShowWindow($handle, 9) | Out-Null
        [Native]::MoveWindow($handle, 60, 30, 1400, 820, $true) | Out-Null
        [Native]::SetForegroundWindow($handle) | Out-Null
        Start-Sleep -Seconds 2
        $rect = New-Object Native+RECT
        [Native]::GetWindowRect($handle, [ref]$rect) | Out-Null
        $width = $rect.Right - $rect.Left
        $height = $rect.Bottom - $rect.Top
    }

    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
    $path = Join-Path $OutDir "$name.png"
    $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    if ($graphics) { $graphics.Dispose() }
    if ($bitmap) { $bitmap.Dispose() }
    Write-Host "  captured $name"
}

function Press([string]$keys, [int]$settle = 2500) {
    [System.Windows.Forms.SendKeys]::SendWait($keys)
    Start-Sleep -Milliseconds $settle
}

function Type-Text([string]$text) {
    Set-Clipboard -Value $text
    Start-Sleep -Milliseconds 300
    [System.Windows.Forms.SendKeys]::SendWait("^v")
    Start-Sleep -Milliseconds 600
}

# --- start -----------------------------------------------------------------
Write-Host "Launching $Exe"
$process = Start-Process -FilePath $Exe -PassThru
Start-Sleep -Seconds 15

if ($process.HasExited) {
    throw "the application exited immediately with code $($process.ExitCode)"
}

$handle = $process.MainWindowHandle
[Native]::ShowWindow($handle, 9) | Out-Null
[Native]::MoveWindow($handle, 60, 30, 1400, 820, $true) | Out-Null
[Native]::SetForegroundWindow($handle) | Out-Null
Start-Sleep -Seconds 4

# --- test 1: keyboard mode switching --------------------------------------
Write-Host "Test 1: Mode switching with F1/F2/F3"
Press "^3" 3000  # Start a session

# F1 = spelling
Press "{F1}" 1500
Save-Shot $handle "test1-f1-spelling"

# F2 = choice
Press "{F2}" 1500
Save-Shot $handle "test1-f2-choice"

# F3 = dictation
Press "{F3}" 1500
Save-Shot $handle "test1-f3-dictation"

# Back to spelling
Press "{F1}" 1500

# --- test 2: pronunciation of multiple words ------------------------------
Write-Host "Test 2: Pronunciation of multiple words"

# Clear the audio cache to see fresh downloads
$cacheDir = Join-Path $env:APPDATA "app.lexiflow.desktop\audio"
if (Test-Path $cacheDir) {
    Remove-Item "$cacheDir\*.mp3" -Force -ErrorAction SilentlyContinue
}

# Answer the first word
Type-Text "abandon"
Press "{ENTER}" 1000
Press "{ENTER}" 1500  # Rate it

# Answer the second word
Type-Text "ability"
Press "{ENTER}" 1000
Press "{ENTER}" 1500

# Answer the third word
Type-Text "aboard"
Press "{ENTER}" 1000
Press "{ENTER}" 1500

# Check how many recordings were cached
$recordings = @(Get-ChildItem $cacheDir -Filter *.mp3 -ErrorAction SilentlyContinue)
Write-Host "  cached recordings: $($recordings.Count)"

Save-Shot $handle "test2-multi-word"

# --- test 3: font size inspection -----------------------------------------
Write-Host "Test 3: Font size inspection"
Save-Shot $handle "test3-font-sizes"

# --- test 4: choice mode pronunciation ------------------------------------
Write-Host "Test 4: Choice mode pronunciation"
Press "{F2}" 2000
Save-Shot $handle "test4-choice-mode"

# Pick an answer
Press "1" 1500
Press "{ENTER}" 1500

# --- test 5: dictation mode pronunciation ---------------------------------
Write-Host "Test 5: Dictation mode pronunciation"
Press "{F3}" 2000
Save-Shot $handle "test5-dictation-mode"

# Type an answer
Type-Text "test"
Press "{ENTER}" 1000
Press "{ENTER}" 1500

# --- summary --------------------------------------------------------------
Write-Host ""
Write-Host "Test summary:"
Write-Host "  Mode switching: check test1-*.png"
Write-Host "  Multi-word pronunciation: $($recordings.Count) recordings cached"
Write-Host "  Font sizes: check test3-font-sizes.png"
Write-Host "  Choice mode: check test4-choice-mode.png"
Write-Host "  Dictation mode: check test5-dictation-mode.png"

$process.CloseMainWindow() | Out-Null
Start-Sleep -Seconds 2
if (-not $process.HasExited) {
    $process.Kill()
}

Write-Host "Screenshots written to $OutDir"
