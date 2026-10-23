param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [string]$OutDir = "screenshots"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$sig = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public class Win {
    public delegate bool EnumProc(IntPtr h, IntPtr l);

    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int t, bool r);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, IntPtr e);

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

    /// <summary>The largest visible Tauri window belonging to one process.</summary>
    public static IntPtr FindWindow(uint target) {
        IntPtr best = IntPtr.Zero;
        long bestArea = 0;
        EnumWindows(delegate(IntPtr h, IntPtr l) {
            uint pid;
            GetWindowThreadProcessId(h, out pid);
            if (pid != target || !IsWindowVisible(h)) return true;
            StringBuilder cn = new StringBuilder(256);
            GetClassName(h, cn, 256);
            if (cn.ToString() != "Tauri Window") return true;
            RECT r;
            GetWindowRect(h, out r);
            long area = (long)(r.Right - r.Left) * (r.Bottom - r.Top);
            if (area > bestArea) { bestArea = area; best = h; }
            return true;
        }, IntPtr.Zero);
        return best;
    }
}
'@
Add-Type -TypeDefinition $sig

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Raise([IntPtr]$handle) {
    [Win]::SetWindowPos($handle, [IntPtr]::new(-1), 0, 0, 0, 0, 0x0003) | Out-Null
    [Win]::SetWindowPos($handle, [IntPtr]::new(-2), 0, 0, 0, 0, 0x0003) | Out-Null
    [Win]::ShowWindow($handle, 9) | Out-Null
    [Win]::SetForegroundWindow($handle) | Out-Null
    Start-Sleep -Milliseconds 600
}

function Save-Shot([IntPtr]$handle, [string]$name) {
    Raise $handle
    Start-Sleep -Milliseconds 600
    $rect = New-Object Win+RECT
    [Win]::GetWindowRect($handle, [ref]$rect) | Out-Null
    $w = $rect.Right - $rect.Left
    $h = $rect.Bottom - $rect.Top
    $bitmap = New-Object System.Drawing.Bitmap($w, $h)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
    $bitmap.Save((Join-Path $OutDir "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
    Write-Host "  captured $name (${w}x${h})"
}

function Click-At([IntPtr]$handle, [int]$x, [int]$y) {
    $rect = New-Object Win+RECT
    [Win]::GetWindowRect($handle, [ref]$rect) | Out-Null
    [Win]::SetCursorPos($rect.Left + $x, $rect.Top + $y) | Out-Null
    Start-Sleep -Milliseconds 300
    [Win]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 90
    [Win]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 1200
}

Write-Host "Launching $Exe"
$process = Start-Process -FilePath $Exe -PassThru
Start-Sleep -Seconds 16

if ($process.HasExited) { throw "the app exited with code $($process.ExitCode)" }

# Use this process's own window, not whatever happens to be at a screen position.
$handle = [Win]::FindWindow([uint32]$process.Id)
if ($handle -eq [IntPtr]::Zero) { throw "no Tauri window found for pid $($process.Id)" }
Write-Host "window handle: $handle"

[Win]::ShowWindow($handle, 9) | Out-Null
# keep the default window size; resizing by physical pixels clips the webview
Raise $handle
Start-Sleep -Seconds 3

Save-Shot $handle "ui-home"

Write-Host "Opening start dialog"
Click-At $handle 300 330
Start-Sleep -Seconds 2
Save-Shot $handle "ui-dialog"

$process.CloseMainWindow() | Out-Null
Start-Sleep -Seconds 2
if (-not $process.HasExited) { $process.Kill() }

Write-Host "done"
