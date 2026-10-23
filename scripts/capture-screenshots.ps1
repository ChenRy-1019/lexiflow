param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [Parameter(Mandatory = $true)][string]$OutDir
)

<#
.SYNOPSIS
    Launch LexiFlow and capture a screenshot of every page.

.DESCRIPTION
    Synthetic mouse clicks are unreliable against a frameless window: the
    invisible resize border shifts the hit area by a few pixels, and a
    neighbouring window can swallow the event. The application has keyboard
    shortcuts for every page, so this script drives it with the keyboard
    instead, which is deterministic.

    The script also types an answer and grades it, so the screenshot shows
    the real review flow rather than an empty shell.
#>

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

    if ($width -lt 200 -or $height -lt 200) {
        Write-Warning "  skipped ${name}: the window is not visible"
        return
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
    # Typing character by character goes through the input method editor, and
    # a Chinese IME swallows Enter to pick a candidate instead of submitting
    # the answer. Pasting from the clipboard bypasses the IME entirely.
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

# --- home ------------------------------------------------------------------
Write-Host "Home page"
Save-Shot $handle "01-home"

# --- library ---------------------------------------------------------------
# Ctrl+2 opens the library.
Write-Host "Library page"
Press "^2"
Save-Shot $handle "02-library"

# --- practice --------------------------------------------------------------
# Ctrl+3 starts the session.
Write-Host "Practice page"
Press "^3" 4000
Save-Shot $handle "03-practice"

# --- answer ---------------------------------------------------------------
Write-Host "Typing an answer"
Type-Text "abandon"
Start-Sleep -Milliseconds 800
Save-Shot $handle "04-typed"

Write-Host "Grading"
# Grade and capture immediately: the feedback panel is replaced by the next
# word as soon as the learner rates it, so the shot has to be taken first.
Press "{ENTER}" 900
Save-Shot $handle "05-graded"

Write-Host "Rating the word"
Press "{ENTER}" 1500
Save-Shot $handle "06-rated"

# --- dictation ------------------------------------------------------------
# The dictation mode is driven by the audio, so it gets its own screenshot.
Write-Host "Dictation mode"
Press "^3" 2000
Press "{F3}" 2500
Save-Shot $handle "09-dictation"

# --- statistics ------------------------------------------------------------
Write-Host "Statistics page"
Press "^5" 2500
Save-Shot $handle "07-stats"

# --- settings --------------------------------------------------------------
Write-Host "Settings page"
Press "^," 2500
Save-Shot $handle "08-settings"

$process.CloseMainWindow() | Out-Null
Start-Sleep -Seconds 2
if (-not $process.HasExited) {
    $process.Kill()
}

Write-Host "Screenshots written to $OutDir"
