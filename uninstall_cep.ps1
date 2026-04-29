param(
  [switch]$NoPause
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::UTF8

function Write-Info($msg) { Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "[OK]   $msg" -ForegroundColor Green }
function Write-WarnMsg($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-ErrMsg($msg) { Write-Host "[ERR]  $msg" -ForegroundColor Red }

try {
  $extId = "com.word_to_photoshop.panel"
  $destDirs = @(
    (Join-Path (Join-Path $env:APPDATA "Adobe\CEP\extensions") $extId),
    (Join-Path (Join-Path ${env:ProgramFiles(x86)} "Common Files\Adobe\CEP\extensions") $extId),
    (Join-Path (Join-Path $env:ProgramFiles "Common Files\Adobe\CEP\extensions") $extId)
  )

  Write-Info "Uninstalling CEP extension: $extId"

  foreach ($destDir in $destDirs) {
    if ([string]::IsNullOrWhiteSpace($destDir)) { continue }
    try {
      if (Test-Path -LiteralPath $destDir) {
        Remove-Item -LiteralPath $destDir -Recurse -Force
        Write-Ok "Extension folder removed: $destDir"
      } else {
        Write-WarnMsg "Extension folder not found, nothing to remove: $destDir"
      }
    } catch {
      Write-WarnMsg "Skipping uninstall path due to permission or IO error: $destDir"
      Write-WarnMsg $_.Exception.Message
    }
  }

  [Environment]::SetEnvironmentVariable("WORD_IMPORT_REPO_PATH", $null, "User")
  Write-Ok "User environment variable removed: WORD_IMPORT_REPO_PATH"

  Write-Host ""
  Write-Ok "CEP uninstall completed."
  Write-Host "If Photoshop is running, restart it to apply changes."
} catch {
  Write-ErrMsg $_.Exception.Message
  exit 1
} finally {
  if (-not $NoPause) {
    Write-Host ""
    Write-Host "Press any key to exit..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
  }
}
