param(
  [Parameter(Mandatory = $true)][string]$InputDir,
  [Parameter(Mandatory = $true)][string]$OutputDir,
  [Parameter(Mandatory = $true)][string]$RepoRoot,
  [switch]$SaveDebug
)

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::UTF8

$pyScript = Join-Path $RepoRoot "tools\generate_bubble_masks.py"
if (-not (Test-Path -LiteralPath $pyScript)) {
  Write-Host "ERROR: generate_bubble_masks.py not found: $pyScript" -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 2
}

Set-Location -LiteralPath $RepoRoot

$Host.UI.RawUI.WindowTitle = "Mask generation"
Clear-Host
Write-Host "------------------------------------------------------------"
Write-Host " DO NOT CLOSE - Processing images. Please wait."
Write-Host "------------------------------------------------------------"
Write-Host ""

$launchers = @("py", "python", "python3")
$exitCode = 1
foreach ($name in $launchers) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if (-not $cmd) { continue }
  Push-Location -LiteralPath $RepoRoot
  try {
    if ($SaveDebug) {
      & $cmd.Source $pyScript "--input-dir" $InputDir "--output-dir" $OutputDir "--save-debug"
    } else {
      & $cmd.Source $pyScript "--input-dir" $InputDir "--output-dir" $OutputDir
    }
    $code = [int]$LASTEXITCODE
    if ($code -eq 0) {
      $exitCode = 0
      break
    }
    $exitCode = $code
  } catch {
    $exitCode = 1
  } finally {
    Pop-Location
  }
}

Write-Host ""
if ($exitCode -eq 0) {
  Write-Host "Done." -ForegroundColor Green
  Start-Sleep -Seconds 2
} else {
  Write-Host "Finished with errors (exit $exitCode). Check mask_generate.log in the image folder if present." -ForegroundColor Red
  Read-Host "Press Enter to close"
}

exit $exitCode
