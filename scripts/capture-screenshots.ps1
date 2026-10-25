param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [Parameter(Mandatory = $true)][string]$OutDir
)

<#
.SYNOPSIS
    Capture the README screenshots.

.DESCRIPTION
    The earlier script brought the window forward only once, at the start. A
    browser that grabbed focus afterwards ended up in the frame, so a picture
    labelled "practice" showed a web page instead.

    Every shot now re-asserts the target: the window is located by pid each
    time, raised, and the foreground checked. If another window is in front,
    the attempt is repeated and the shot is skipped rather than saved wrong.
#>

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$sig = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Shot {
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int t, bool r);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

    public static IntPtr Find(uint target) {
        IntPtr best = IntPtr.Zero; long bestArea = 0;
        EnumWindows(delegate(IntPtr h, IntPtr l) {
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (pid != target || !IsWindowVisible(h)) return true;
            StringBuilder cn = new StringBuilder(256); GetClassName(h, cn, 256);
            if (cn.ToString() != "Tauri Window") return true;
            RECT r; GetWindowRect(h, out r);
            long area = (long)(r.Right - r.Left) * (r.Bottom - r.Top);
            if (area > bestArea) { bestArea = area; best = h; }
            return true;
        }, IntPtr.Zero);
        return best;
    }

    public static bool IsForeground(IntPtr h) {
        return GetForegroundWindow() == h;
    }
}
'@
Add-Type -TypeDefinition $sig

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$script:AppPid = 0

function Raise-Window([IntPtr]$handle) {
    # Topmost, then normal, then foreground: this defeats a window that keeps
    # trying to stay above, and it makes the capture deterministic.
    [Shot]::SetWindowPos($handle, [IntPtr]::new(-1), 0, 0, 0, 0, 0x0003) | Out-Null
    [Shot]::SetWindowPos($handle, [IntPtr]::new(-2), 0, 0, 0, 0, 0x0003) | Out-Null
    [Shot]::ShowWindow($handle, 9) | Out-Null
    [Shot]::BringWindowToTop($handle) | Out-Null
    [Shot]::SetForegroundWindow($handle) | Out-Null
    Start-Sleep -Milliseconds 500
}

function Save-Shot([string]$name) {
    $handle = [Shot]::Find([uint32]$script:AppPid)
    if ($handle -eq [IntPtr]::Zero) {
        Write-Warning "  skipped ${name}: no window"
        return
    }

    for ($attempt = 1; $attempt -le 4; $attempt += 1) {
        Raise-Window $handle
        Start-Sleep -Milliseconds 700
        if ([Shot]::IsForeground($handle)) { break }
        Write-Host "  retrying $name (another window is in front, attempt $attempt)"
    }

    if (-not [Shot]::IsForeground($handle)) {
        Write-Warning "  skipped ${name}: could not bring the window forward"
        return
    }

    $rect = New-Object Shot+RECT
    [Shot]::GetWindowRect($handle, [ref]$rect) | Out-Null
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -lt 200 -or $height -lt 200) {
        Write-Warning "  skipped ${name}: window is ${width}x${height}"
        return
    }

    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
    $bitmap.Save((Join-Path $OutDir "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    if ($graphics) { $graphics.Dispose() }
    if ($bitmap) { $bitmap.Dispose() }
    Write-Host "  captured $name (${width}x${height})"
}

function Press([string]$keys, [int]$settle = 2500) {
    [System.Windows.Forms.SendKeys]::SendWait($keys)
    Start-Sleep -Milliseconds $settle
}

function Type-Text([string]$text) {
    # Pasting bypasses the input method editor, which would otherwise swallow
    # Enter to pick a candidate instead of submitting the answer.
    Set-Clipboard -Value $text
    Start-Sleep -Milliseconds 300
    [System.Windows.Forms.SendKeys]::SendWait("^v")
    Start-Sleep -Milliseconds 600
}

Write-Host "Launching $Exe"
$process = Start-Process -FilePath $Exe -PassThru
$script:AppPid = $process.Id
Start-Sleep -Seconds 15

if ($process.HasExited) {
    throw "the application exited immediately with code $($process.ExitCode)"
}

$handle = [Shot]::Find([uint32]$process.Id)
if ($handle -eq [IntPtr]::Zero) { throw "no window found for pid $($process.Id)" }

Write-Host "Sizing the window"
# Maximise rather than placing a floating window: the app then covers the
# screen, so a browser or editor behind it cannot appear in the capture.
[Shot]::ShowWindow($handle, 9) | Out-Null
[Shot]::ShowWindow($handle, 3) | Out-Null
[Shot]::BringWindowToTop($handle) | Out-Null
[Shot]::SetForegroundWindow($handle) | Out-Null
Start-Sleep -Seconds 4

Write-Host "Home page"
Save-Shot "01-home"

Write-Host "Library page"
Press "^2"
Save-Shot "02-library"

Write-Host "Practice page"
Press "^3" 4000
Save-Shot "03-practice"

Write-Host "Typing an answer"
Type-Text "abandon"
Start-Sleep -Milliseconds 800
Save-Shot "04-typed"

Write-Host "Grading"
Press "{ENTER}" 900
Save-Shot "05-graded"

Write-Host "Rating the word"
Press "{ENTER}" 1500
Save-Shot "06-rated"

Write-Host "Statistics page"
Press "^5" 2500
Save-Shot "07-stats"

Write-Host "Settings page"
Press "^," 2500
Save-Shot "08-settings"

Write-Host "Dictation mode"
Press "^3" 2500
Press "{F3}" 2500
Save-Shot "09-dictation"

$process.CloseMainWindow() | Out-Null
Start-Sleep -Seconds 2
if (-not $process.HasExited) { $process.Kill() }

Write-Host "Screenshots written to $OutDir"
