param(
  [string]$RepoRoot = "",
  [string]$OutFile = "$env:TEMP\word_import_cursor.json"
)

$ErrorActionPreference = "SilentlyContinue"

if (-not $RepoRoot) { $RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path }

$ahkDaemon = Join-Path $RepoRoot "cursor_daemon.ahk"
$psDaemon = Join-Path $RepoRoot "cursor_daemon.ps1"

function Start-AhkDaemon {
  param([string]$ahkPath, [string]$outFile)
  if (-not (Test-Path $ahkPath)) { return $false }
  $ahkExe = (Get-Command AutoHotkey.exe -ErrorAction SilentlyContinue)
  if (-not $ahkExe) {
    $candidates = @(
      "$env:ProgramFiles\AutoHotkey\AutoHotkey.exe",
      "$env:ProgramFiles(x86)\AutoHotkey\AutoHotkey.exe"
    )
    foreach ($p in $candidates) {
      if (Test-Path $p) { $ahkExe = @{ Source = $p }; break }
    }
  }
  if (-not $ahkExe) { return $false }

  $existingAhk = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -match '^AutoHotkey(64|32)?\.exe$' -and $_.CommandLine -match 'cursor_daemon\.ahk'
  }
  if ($existingAhk -and $existingAhk.Count -gt 0) { return $true }

  Start-Process -WindowStyle Hidden -FilePath $ahkExe.Source -ArgumentList "`"$ahkPath`" `"$outFile`"" | Out-Null
  return $true
}

function Start-PsDaemon {
  param([string]$psPath, [string]$outFile)
  if (-not (Test-Path $psPath)) { return $false }
  $existingPs = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -match '^powershell(\.exe)?$' -and $_.CommandLine -match 'cursor_daemon\.ps1'
  }
  if ($existingPs -and $existingPs.Count -gt 0) { return $true }
  $arg = "-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$psPath`" -OutFile `"$outFile`""
  Start-Process -WindowStyle Hidden -FilePath "powershell.exe" -ArgumentList $arg | Out-Null
  return $true
}

if (Start-PsDaemon -psPath $psDaemon -outFile $OutFile) { exit 0 }
[void](Start-AhkDaemon -ahkPath $ahkDaemon -outFile $OutFile)
