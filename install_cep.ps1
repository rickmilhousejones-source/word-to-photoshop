param(
  [switch]$NoPause
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::UTF8

function Write-Info($msg) { Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "[OK]   $msg" -ForegroundColor Green }
function Write-WarnMsg($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-ErrMsg($msg) { Write-Host "[ERR]  $msg" -ForegroundColor Red }

function Ensure-Dir([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) {
    New-Item -ItemType Directory -Path $path -Force | Out-Null
  }
}

try {
  $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
  $logFile = Join-Path $scriptDir "install_cep.log"
  try { Start-Transcript -Path $logFile -Force | Out-Null } catch {}
  $extId = "com.word_to_photoshop.panel"
  $sourceDir = Join-Path $scriptDir "cep-extension\$extId"
  $destBases = @(
    (Join-Path $env:APPDATA "Adobe\CEP\extensions"),
    (Join-Path ${env:ProgramFiles(x86)} "Common Files\Adobe\CEP\extensions"),
    (Join-Path $env:ProgramFiles "Common Files\Adobe\CEP\extensions")
  )

  Write-Info "Installing CEP extension: $extId"

  if (-not (Test-Path -LiteralPath $sourceDir)) {
    throw "Extension source folder not found: $sourceDir"
  }

  $installedCount = 0
  foreach ($base in $destBases) {
    if ([string]::IsNullOrWhiteSpace($base)) { continue }
    try {
      Ensure-Dir $base
      $destDir = Join-Path $base $extId
      if (Test-Path -LiteralPath $destDir) {
        Write-Info "Existing version found, removing first: $destDir"
        Remove-Item -LiteralPath $destDir -Recurse -Force
      }
      Write-Info "Copying extension files to: $destDir"
      Copy-Item -LiteralPath $sourceDir -Destination $destDir -Recurse -Force
      Write-Ok "Extension files copied to: $destDir"
      $repoMarker = Join-Path $destDir "host\repo_path.txt"
      Set-Content -LiteralPath $repoMarker -Value $scriptDir -Encoding Ascii
      Write-Ok "Repo marker written: $repoMarker"
      $installedCount++
    } catch {
      Write-WarnMsg "Skipping path due to permission or IO error: $base"
      Write-WarnMsg $_.Exception.Message
    }
  }

  if ($installedCount -le 0) {
    throw "Installation failed: no extension path was writable."
  }

  [Environment]::SetEnvironmentVariable("WORD_IMPORT_REPO_PATH", $scriptDir, "User")
  Write-Ok "User environment variable set: WORD_IMPORT_REPO_PATH=$scriptDir"

  $csxsVersions = 8..20
  foreach ($v in $csxsVersions) {
    $keyPath = "HKCU:\Software\Adobe\CSXS.$v"
    Ensure-Dir $keyPath
    New-ItemProperty -Path $keyPath -Name "PlayerDebugMode" -Value "1" -PropertyType String -Force | Out-Null
    Write-Ok "CSXS.$v PlayerDebugMode=1 has been set"
  }

  Write-Host ""
  Write-Ok "CEP installation completed."
  Write-Host "Next: restart Photoshop, then open Window > Extensions (Legacy) > Word Import CEP"
} catch {
  Write-ErrMsg $_.Exception.Message
  try { Write-Host "Log file: $logFile" } catch {}
  exit 1
} finally {
  try { Stop-Transcript | Out-Null } catch {}
  try { Write-Host "Log file: $logFile" } catch {}
  if (-not $NoPause) {
    Write-Host ""
    Write-Host "Press any key to exit..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
  }
}
