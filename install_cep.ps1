param(
  [switch]$NoPause,
  [switch]$NoFonts
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

function Copy-Payload([string]$src, [string]$dst) {
  if (-not (Test-Path -LiteralPath $src)) {
    Write-WarnMsg "Payload source not found, skipped: $src"
    return $false
  }
  $parent = Split-Path -Parent $dst
  if ($parent) { Ensure-Dir $parent }
  $isDir = (Get-Item -LiteralPath $src).PSIsContainer
  if ($isDir) {
    if (Test-Path -LiteralPath $dst) {
      Remove-Item -LiteralPath $dst -Recurse -Force -ErrorAction SilentlyContinue
    }
    Ensure-Dir $dst
    Get-ChildItem -LiteralPath $src -Force | ForEach-Object {
      if ($_.PSIsContainer -and $_.Name -ieq "__pycache__") { return }
      $target = Join-Path $dst $_.Name
      Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse -Force
    }
  } else {
    Copy-Item -LiteralPath $src -Destination $dst -Force
  }
  return $true
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

  # Runtime payload bundled into extension's host\repo\ at install time.
  # Each entry: source path (relative to repo root) -> destination filename under host\repo\.
  $repoFiles = @(
    @{ Src = "import_to_photoshop.jsx";       Dst = "import_to_photoshop.jsx" },
    @{ Src = "import_panel.jsx";              Dst = "import_panel.jsx" },
    # 与 CEP 内 host/repo 副本同源，避免仅改 cep 未改根目录时安装仍拷旧文件导致 $readerSettings 等半截脚本
    @{ Src = "cep-extension\com.word_to_photoshop.panel\host\repo\export_docx_styles.ps1"; Dst = "export_docx_styles.ps1" },
    @{ Src = "start_cursor_daemon.ps1";       Dst = "start_cursor_daemon.ps1" },
    @{ Src = "cursor_probe.ps1";              Dst = "cursor_probe.ps1" },
    @{ Src = "cursor_daemon.ps1";             Dst = "cursor_daemon.ps1" }
  )
  $repoDirs = @(
    @{ Src = "tools";                         Dst = "tools" }
  )
  if (-not $NoFonts) {
    $repoDirs += @{ Src = "fonts";            Dst = "fonts" }
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

      $repoDest = Join-Path $destDir "host\repo"
      Ensure-Dir $repoDest
      Write-Info "Bundling runtime payload into: $repoDest"
      foreach ($entry in $repoFiles) {
        $src = Join-Path $scriptDir $entry.Src
        $dst = Join-Path $repoDest $entry.Dst
        if (-not (Test-Path -LiteralPath $src)) {
          throw "Missing install source (run install from repo root): $src"
        }
        if (-not (Copy-Payload $src $dst)) {
          throw "Failed to copy payload to $dst from $src"
        }
      }
      foreach ($entry in $repoDirs) {
        $src = Join-Path $scriptDir $entry.Src
        $dst = Join-Path $repoDest $entry.Dst
        [void](Copy-Payload $src $dst)
      }

      # Ship the current settings.json as a default template (never overwrites user's later edits).
      $defaultSettingsSrc = Join-Path $scriptDir "settings.json"
      if (Test-Path -LiteralPath $defaultSettingsSrc) {
        $defaultSettingsDst = Join-Path $repoDest "settings.default.json"
        Copy-Item -LiteralPath $defaultSettingsSrc -Destination $defaultSettingsDst -Force
        Write-Ok "Default settings template written: $defaultSettingsDst"
      } else {
        Write-WarnMsg "settings.json not found at repo root, skipping default template."
      }

      Write-Ok "Runtime payload bundled."
      $installedCount++
    } catch {
      Write-WarnMsg "Skipping path due to permission or IO error: $base"
      Write-WarnMsg $_.Exception.Message
    }
  }

  if ($installedCount -le 0) {
    throw "Installation failed: no extension path was writable."
  }

  # Also populate host\repo inside the *workspace* extension source (cep-extension\...\).
  # Needed when Photoshop loads a dev / mis-linked extension whose extRoot is the repo parent:
  # host\main.jsx then resolves bundled via walking to cep-extension\...\host\repo.
  $srcRepoDest = Join-Path $sourceDir "host\repo"
  Ensure-Dir $srcRepoDest
  Write-Info "Syncing runtime payload to workspace extension source: $srcRepoDest"
  foreach ($entry in $repoFiles) {
    $src = Join-Path $scriptDir $entry.Src
    $dst = Join-Path $srcRepoDest $entry.Dst
    [void](Copy-Payload $src $dst)
  }
  foreach ($entry in $repoDirs) {
    $src = Join-Path $scriptDir $entry.Src
    $dst = Join-Path $srcRepoDest $entry.Dst
    [void](Copy-Payload $src $dst)
  }
  $defaultSettingsSrcSync = Join-Path $scriptDir "settings.json"
  if (Test-Path -LiteralPath $defaultSettingsSrcSync) {
    Copy-Item -LiteralPath $defaultSettingsSrcSync -Destination (Join-Path $srcRepoDest "settings.default.json") -Force
    Write-Ok "Default settings template synced to source extension."
  }
  Write-Ok "Workspace extension host\\repo is up to date."

  # Ensure user-writable data root exists so first-launch settings/calibration writes succeed.
  $userDataRoot = Join-Path $env:APPDATA "com.word_to_photoshop"
  Ensure-Dir $userDataRoot
  Write-Ok "User data folder ready: $userDataRoot"

  # Legacy cleanup: previous versions wrote a user env var pointing at the source repo.
  # The extension is now self-contained, so this var is no longer needed.
  try {
    $legacyEnv = [Environment]::GetEnvironmentVariable("WORD_IMPORT_REPO_PATH", "User")
    if ($legacyEnv) {
      [Environment]::SetEnvironmentVariable("WORD_IMPORT_REPO_PATH", $null, "User")
      Write-Ok "Legacy env var removed: WORD_IMPORT_REPO_PATH (was: $legacyEnv)"
    }
  } catch {
    Write-WarnMsg "Failed to clean legacy env var: $($_.Exception.Message)"
  }

  # CC 2017 uses CSXS.7; CC 2018 uses CSXS.8 — enable unsigned panels for both + newer runtimes.
  $csxsVersions = 7..20
  foreach ($v in $csxsVersions) {
    $keyPath = "HKCU:\Software\Adobe\CSXS.$v"
    Ensure-Dir $keyPath
    New-ItemProperty -Path $keyPath -Name "PlayerDebugMode" -Value "1" -PropertyType String -Force | Out-Null
    Write-Ok "CSXS.$v PlayerDebugMode=1 has been set"
  }

  Write-Host ""
  Write-Ok "CEP installation completed."
  Write-Host "Next: restart Photoshop."
  Write-Host "  PS CC 2018: Window > Extensions > Word Import CEP (menu label may differ by language)."
  Write-Host "  PS 2020+: often Window > Extensions (Legacy) > Word Import CEP"
  Write-Host "  After install you can move or delete the source folder; the extension is self-contained."
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
