# Install fonttools for tools/generate_synthetic_bold_font.py when missing.
# Safe to run multiple times; exits 0 even if Python is missing (non-fatal for CEP install).
# ASCII-only output for legacy consoles.

$ErrorActionPreference = "SilentlyContinue"

$toolsDir = $PSScriptRoot
$reqFile = Join-Path $toolsDir "requirements-fontgen.txt"
if (-not (Test-Path -LiteralPath $reqFile)) {
  Write-Host "[SKIP] tools\requirements-fontgen.txt not found"
  exit 0
}

function Test-FontTools {
  param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [string[]]$PrefixArgs = @()
  )
  if ($PrefixArgs -and $PrefixArgs.Length -gt 0) {
    & $Exe @PrefixArgs -c "import fontTools" 2>$null | Out-Null
  } else {
    & $Exe -c "import fontTools" 2>$null | Out-Null
  }
  return ($LASTEXITCODE -eq 0)
}

function Add-UniqueCandidate {
  param(
    [System.Collections.ArrayList]$Bucket,
    [hashtable]$Seen,
    [string]$Path,
    [string[]]$Prefix
  )
  if (-not $Path) { return }
  $key = "$Path|$($Prefix -join ',')"
  if ($Seen.ContainsKey($key)) { return }
  $Seen[$key] = $true
  [void]$Bucket.Add(@($Path, $Prefix))
}

function Get-PythonCandidates {
  $bucket = New-Object System.Collections.ArrayList
  $seen = @{}

  $embedExe = Join-Path $env:APPDATA "com.word_to_photoshop\python-embed-3.12\python.exe"
  if (Test-Path -LiteralPath $embedExe) {
    Add-UniqueCandidate $bucket $seen $embedExe @()
  }

  $launcher = Join-Path $env:LOCALAPPDATA "Programs\Python\Launcher\py.exe"
  if (Test-Path -LiteralPath $launcher) {
    Add-UniqueCandidate $bucket $seen $launcher @("-3")
  }
  $winPy = Join-Path $env:WINDIR "py.exe"
  if (Test-Path -LiteralPath $winPy) {
    Add-UniqueCandidate $bucket $seen $winPy @("-3")
  }

  foreach ($name in @("py", "python", "python3")) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if (-not ($cmd -and $cmd.Source)) { continue }
    $src = $cmd.Source
    if ($name -eq "py") {
      Add-UniqueCandidate $bucket $seen $src @("-3")
      Add-UniqueCandidate $bucket $seen $src @()
    } else {
      Add-UniqueCandidate $bucket $seen $src @()
    }
  }

  return , $bucket.ToArray()
}

foreach ($cand in (Get-PythonCandidates)) {
  $exe = $cand[0]
  $prefix = $cand[1]
  if (Test-FontTools -Exe $exe -PrefixArgs $prefix) {
    $label = if ($prefix -and $prefix.Length) { "$exe $($prefix -join ' ')" } else { $exe }
    Write-Host "[OK] fonttools already available ($label)"
    exit 0
  }
}

$pipExe = $null
$pipPrefix = $null
foreach ($cand in (Get-PythonCandidates)) {
  if (Test-Path -LiteralPath $cand[0]) {
    $pipExe = $cand[0]
    $pipPrefix = $cand[1]
    break
  }
}

if (-not $pipExe) {
  Write-Host "[WARN] Python not found (py/python). Install Python 3, then run:"
  Write-Host "       pip install -r `"$reqFile`""
  exit 0
}

$pipArgs = @()
if ($pipPrefix -and $pipPrefix.Length -gt 0) { $pipArgs += $pipPrefix }
$pipArgs += @("-m", "pip", "install", "-r", $reqFile)

Write-Host "[INFO] Installing fonttools: $pipExe $($pipArgs -join ' ')"
try {
  & $pipExe @pipArgs
  if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] fonttools installed"
  } else {
    Write-Host "[WARN] pip failed (exit $LASTEXITCODE). Try manually:"
    Write-Host "       `"$pipExe`" $($pipPrefix -join ' ') -m pip install -r `"$reqFile`""
  }
} catch {
  Write-Host "[WARN] pip launch failed: $($_.Exception.Message)"
}

exit 0
