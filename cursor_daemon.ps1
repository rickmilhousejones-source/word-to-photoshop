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
}
"@

function Write-State {
  param([string]$Path)
  $pt = New-Object CursorDaemonWin32+POINT
  if (-not [CursorDaemonWin32]::GetCursorPos([ref]$pt)) { return }

  $hChild = [CursorDaemonWin32]::WindowFromPoint($pt)
  $GA_ROOT = 2
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

  $state = [ordered]@{
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
  }
  $json = $state | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText($Path, $json, [System.Text.Encoding]::UTF8)
}

while ($true) {
  Write-State -Path $OutFile
  Start-Sleep -Milliseconds $IntervalMs
}
