param(
  [string]$OutFile = "$env:TEMP\word_import_cursor.json",
  [int]$IntervalMs = 20
)

$ErrorActionPreference = "SilentlyContinue"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class CursorDaemonWin32 {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT pt);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
}
"@

function Write-State {
  param([string]$Path)
  $pt = New-Object CursorDaemonWin32+POINT
  if (-not [CursorDaemonWin32]::GetCursorPos([ref]$pt)) { return }

  $GA_ROOT = [uint32]2
  $hChild = [CursorDaemonWin32]::WindowFromPoint($pt)
  $hwnd = if ($hChild -ne [IntPtr]::Zero) { [CursorDaemonWin32]::GetAncestor($hChild, $GA_ROOT) } else { [IntPtr]::Zero }
  $wr = New-Object CursorDaemonWin32+RECT
  $cr = New-Object CursorDaemonWin32+RECT
  $origin = New-Object CursorDaemonWin32+POINT
  $okW = $false
  $okC = $false

  if ($hwnd -ne [IntPtr]::Zero) {
    $okW = [CursorDaemonWin32]::GetWindowRect($hwnd, [ref]$wr)
    if ([CursorDaemonWin32]::GetClientRect($hwnd, [ref]$cr)) {
      $origin.X = 0
      $origin.Y = 0
      [CursorDaemonWin32]::ClientToScreen($hwnd, [ref]$origin) | Out-Null
      $okC = $true
    }
  }

  $hFg = [CursorDaemonWin32]::GetForegroundWindow()
  $fgRoot = if ($hFg -ne [IntPtr]::Zero) { [CursorDaemonWin32]::GetAncestor($hFg, $GA_ROOT) } else { [IntPtr]::Zero }
  $cursorRoot = if ($hChild -ne [IntPtr]::Zero) { [CursorDaemonWin32]::GetAncestor($hChild, $GA_ROOT) } else { [IntPtr]::Zero }

  $fgProcName = ""
  if ($hFg -ne [IntPtr]::Zero) {
    try {
      [uint32]$pidFg = 0
      [void][CursorDaemonWin32]::GetWindowThreadProcessId($hFg, [ref]$pidFg)
      if ($pidFg -ne 0) {
        $pp = Get-Process -Id ([int]$pidFg) -ErrorAction SilentlyContinue
        if ($pp) { $fgProcName = [string]$pp.ProcessName }
      }
    } catch {}
  }

  $foregroundIsPhotoshop = ($fgProcName -eq "Photoshop")
  $cursorFgAligned = ($fgRoot -ne [IntPtr]::Zero -and $cursorRoot -ne [IntPtr]::Zero -and $fgRoot -eq $cursorRoot)

  $cursorInForegroundClient = $false
  if ($fgRoot -ne [IntPtr]::Zero) {
    $fgCr = New-Object CursorDaemonWin32+RECT
    $fgOrig = New-Object CursorDaemonWin32+POINT
    if ([CursorDaemonWin32]::GetClientRect($fgRoot, [ref]$fgCr)) {
      $fgOrig.X = 0
      $fgOrig.Y = 0
      if ([CursorDaemonWin32]::ClientToScreen($fgRoot, [ref]$fgOrig)) {
        $cl = $fgOrig.X
        $ct = $fgOrig.Y
        $crR = $fgOrig.X + $fgCr.Right
        $cb = $fgOrig.Y + $fgCr.Bottom
        $cursorInForegroundClient = ($pt.X -ge $cl -and $pt.X -lt $crR -and $pt.Y -ge $ct -and $pt.Y -lt $cb)
      }
    }
  }

  $lmbDown = (([CursorDaemonWin32]::GetAsyncKeyState(1) -band 0x8000) -ne 0)

  $state = [ordered]@{
    probeVersion = 2
    ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    cursorX = $pt.X
    cursorY = $pt.Y
    winL = $(if ($okW) { $wr.Left } else { $null })
    winT = $(if ($okW) { $wr.Top } else { $null })
    winR = $(if ($okW) { $wr.Right } else { $null })
    winB = $(if ($okW) { $wr.Bottom } else { $null })
    clientL = $(if ($okC) { $origin.X } else { $null })
    clientT = $(if ($okC) { $origin.Y } else { $null })
    clientR = $(if ($okC) { $origin.X + $cr.Right } else { $null })
    clientB = $(if ($okC) { $origin.Y + $cr.Bottom } else { $null })
    lmbDown = [bool]$lmbDown
    foregroundIsPhotoshop = [bool]$foregroundIsPhotoshop
    foregroundProcessName = $fgProcName
    cursorFgAligned = [bool]$cursorFgAligned
    cursorInForegroundClient = [bool]$cursorInForegroundClient
  }
  $json = $state | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText($Path, $json, [System.Text.Encoding]::UTF8)
}

while ($true) {
  Write-State -Path $OutFile
  Start-Sleep -Milliseconds $IntervalMs
}
