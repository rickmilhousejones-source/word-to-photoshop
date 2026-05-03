param()

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class Win32Probe {
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

$pt = New-Object Win32Probe+POINT
if (-not [Win32Probe]::GetCursorPos([ref]$pt)) {
  Write-Output "ERR|CURSOR"
  exit 0
}

$hChild = [Win32Probe]::WindowFromPoint($pt)
$GA_ROOT = 2
$hRoot = if ($hChild -ne [IntPtr]::Zero) { [Win32Probe]::GetAncestor($hChild, $GA_ROOT) } else { [IntPtr]::Zero }

$rootRect = New-Object Win32Probe+RECT
$clientRect = New-Object Win32Probe+RECT
$clientOrigin = New-Object Win32Probe+POINT
$childRect = New-Object Win32Probe+RECT

$okRoot = $false
$okClient = $false
$okChild = $false

if ($hRoot -ne [IntPtr]::Zero) {
  $okRoot = [Win32Probe]::GetWindowRect($hRoot, [ref]$rootRect)
  if ([Win32Probe]::GetClientRect($hRoot, [ref]$clientRect)) {
    $okClient = $true
    $clientOrigin.X = 0
    $clientOrigin.Y = 0
    [Win32Probe]::ClientToScreen($hRoot, [ref]$clientOrigin) | Out-Null
  }
}

if ($hChild -ne [IntPtr]::Zero) {
  $okChild = [Win32Probe]::GetWindowRect($hChild, [ref]$childRect)
}

$parts = @()
$parts += "OK"
$parts += $pt.X
$parts += $pt.Y
$parts += ($(if ($okRoot) { $rootRect.Left } else { "" }))
$parts += ($(if ($okRoot) { $rootRect.Top } else { "" }))
$parts += ($(if ($okRoot) { $rootRect.Right } else { "" }))
$parts += ($(if ($okRoot) { $rootRect.Bottom } else { "" }))
$parts += ($(if ($okClient) { $clientOrigin.X } else { "" }))
$parts += ($(if ($okClient) { $clientOrigin.Y } else { "" }))
$parts += ($(if ($okClient) { $clientOrigin.X + $clientRect.Right } else { "" }))
$parts += ($(if ($okClient) { $clientOrigin.Y + $clientRect.Bottom } else { "" }))
$parts += ($(if ($okChild) { $childRect.Left } else { "" }))
$parts += ($(if ($okChild) { $childRect.Top } else { "" }))
$parts += ($(if ($okChild) { $childRect.Right } else { "" }))
$parts += ($(if ($okChild) { $childRect.Bottom } else { "" }))

Write-Output ($parts -join "|")
