# Offline-first: expand python-*-embed-amd64.zip from host/repo/environment_dependencies,
# patch ._pth, run local get-pip.py, pip install tools/requirements-fontgen.txt.
# Optional -ProgressFile (0..100, -1=error) and -ErrFile for ScriptUI polling.

param(
  [string]$RepoRoot = "",
  [string]$ProgressFile = "",
  [string]$ErrFile = ""
)

$ErrorActionPreference = "Continue"

function Set-Prog([int]$n) {
  if ($ProgressFile) {
    try { Set-Content -LiteralPath $ProgressFile -Value ([string]$n) -Encoding ascii -NoNewline } catch {}
  }
}
function Set-Err([string]$m) {
  if ($ErrFile) {
    try { Set-Content -LiteralPath $ErrFile -Value $m -Encoding UTF8 } catch {}
  }
}

$repoRootResolved = if ($RepoRoot) { $RepoRoot } else { (Split-Path -Parent $PSScriptRoot) }
$deps = Join-Path $repoRootResolved "environment_dependencies"
$toolsDir = Join-Path $repoRootResolved "tools"
$reqFile = Join-Path $toolsDir "requirements-fontgen.txt"
$ver = "3.12.7"
$dest = Join-Path $env:APPDATA "com.word_to_photoshop\python-embed-3.12"
$pyExe = Join-Path $dest "python.exe"

if (Test-Path -LiteralPath $pyExe) {
  Set-Prog 100
  if (-not (Test-Path -LiteralPath $reqFile)) { exit 0 }
  & $pyExe -c "import fontTools" 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Set-Prog 95
    & $pyExe -m pip install -r $reqFile 2>&1 | Out-Null
  }
  exit 0
}

Set-Prog 2
if (-not (Test-Path -LiteralPath $deps)) {
  Set-Err "Missing folder: $deps"
  Set-Prog -1
  exit 1
}

$zip = Join-Path $deps "python-$ver-embed-amd64.zip"
if (-not (Test-Path -LiteralPath $zip)) {
  $found = Get-ChildItem -LiteralPath $deps -Filter "python-*-embed-amd64.zip" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { $zip = $found.FullName }
}
if (-not (Test-Path -LiteralPath $zip)) {
  Set-Err "Missing embed zip in $deps (expected python-$ver-embed-amd64.zip)"
  Set-Prog -1
  exit 1
}

$getPip = Join-Path $deps "get-pip.py"
if (-not (Test-Path -LiteralPath $getPip)) {
  $getPip = Join-Path $toolsDir "get-pip.py"
}
if (-not (Test-Path -LiteralPath $getPip)) {
  Set-Err "Missing get-pip.py in $deps or tools (see environment_dependencies/README.txt)"
  Set-Prog -1
  exit 1
}

try {
  Set-Prog 8
  New-Item -ItemType Directory -Path $dest -Force | Out-Null
  Set-Prog 18
  Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force
} catch {
  Set-Err ("extract failed: " + $_.Exception.Message)
  Set-Prog -1
  exit 1
}

if (-not (Test-Path -LiteralPath $pyExe)) {
  Set-Err "python.exe missing after extract"
  Set-Prog -1
  exit 1
}

Set-Prog 40
$pthPath = Join-Path $dest "python312._pth"
if (-not (Test-Path -LiteralPath $pthPath)) {
  $alt = Get-ChildItem -LiteralPath $dest -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "python*._pth" } | Select-Object -First 1
  if ($alt) { $pthPath = $alt.FullName }
}
if (Test-Path -LiteralPath $pthPath) {
  $raw = Get-Content -LiteralPath $pthPath -Raw -ErrorAction SilentlyContinue
  if ($raw) {
    $raw = $raw -replace "(?m)^#\s*import\s+site\s*$", "import site"
    if ($raw -notmatch "(?m)^import\s+site\s*$") { $raw = $raw.TrimEnd() + "`r`nimport site" }
    if ($raw -notmatch "(?m)^Lib\\site-packages\s*$") { $raw = $raw.TrimEnd() + "`r`nLib\site-packages" }
    Set-Content -LiteralPath $pthPath -Value $raw.TrimEnd() -NoNewline -Encoding ASCII
  }
}

Set-Prog 55
try {
  & $pyExe $getPip --no-warn-script-location 2>&1 | Out-Null
} catch {
  Set-Err ("get-pip failed: " + $_.Exception.Message)
  Set-Prog -1
  exit 1
}

if (-not (Test-Path -LiteralPath $reqFile)) {
  Set-Err "Missing $reqFile"
  Set-Prog -1
  exit 1
}

Set-Prog 75
& $pyExe -m pip install -r $reqFile 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Set-Err ("pip install failed exit " + $LASTEXITCODE)
  Set-Prog -1
  exit 1
}

Set-Prog 100
exit 0
