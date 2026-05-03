<#
.SYNOPSIS
  Local repro: export the known-problematic docx from Desktop to .jsxdata.

.DESCRIPTION
  Default docx: same UTF-8 filename on Desktop, else under Documents (MyDocuments).
  Testers reported that renaming to remove '#' still failed on some machines, so '#'
  in the path is not treated as the root cause; use this script plus host cap / [E_*]
  lines to compare environments (PS version, execution policy, docx/OOXML, etc.).
  Override path with -DocxPath. The docx is not committed to the repo.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\export_docx_fixture_repro.ps1
#>
[CmdletBinding()]
param(
  [string]$RepoRoot = "",
  [string]$DocxPath = "",
  [string]$OutFile = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
} else {
  $RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
}

$exportScript = Join-Path $RepoRoot 'export_docx_styles.ps1'
if (-not (Test-Path -LiteralPath $exportScript)) {
  throw "export_docx_styles.ps1 not found: $exportScript"
}

if ([string]::IsNullOrWhiteSpace($DocxPath)) {
  # UTF-8 for: ...化身#1.docx
  $nameUtf8 = [byte[]](
    0xE6, 0xAD, 0xA3, 0xE4, 0xB9, 0x89, 0xE8, 0x81, 0x94, 0xE7, 0x9B, 0x9F,
    0xE5, 0x8C, 0x96, 0xE8, 0xBA, 0xAB, 0x23, 0x31, 0x2E, 0x64, 0x6F, 0x63, 0x78
  )
  $fixtureLeaf = [System.Text.Encoding]::UTF8.GetString($nameUtf8)
  $desktopPath = Join-Path ([Environment]::GetFolderPath('Desktop')) $fixtureLeaf
  $documentsPath = Join-Path ([Environment]::GetFolderPath('MyDocuments')) $fixtureLeaf
  if (Test-Path -LiteralPath $desktopPath) {
    $DocxPath = $desktopPath
  } elseif (Test-Path -LiteralPath $documentsPath) {
    $DocxPath = $documentsPath
  } else {
    throw (
      "Docx not found. Tried Desktop and Documents:`n  $desktopPath`n  $documentsPath`n" +
        "Pass -DocxPath with the full path (e.g. C:\Users\...\Documents\...docx)."
    )
  }
}

if (-not (Test-Path -LiteralPath $DocxPath)) {
  throw "Docx not found: $DocxPath"
}
$DocxPath = (Resolve-Path -LiteralPath $DocxPath).Path

if ([string]::IsNullOrWhiteSpace($OutFile)) {
  $OutFile = Join-Path ([System.IO.Path]::GetTempPath()) 'word_import_fixture_justice_league.jsxdata'
} else {
  $parent = Split-Path -Parent $OutFile
  if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
}

Write-Host "RepoRoot: $RepoRoot"
Write-Host "DocxPath: $DocxPath"
Write-Host "OutFile:  $OutFile"
Write-Host ""

Push-Location -LiteralPath $RepoRoot
try {
  & $exportScript -DocxPath $DocxPath -OutFile $OutFile -Minify
} finally {
  Pop-Location
}

if (Test-Path -LiteralPath $OutFile) {
  Write-Host "OK: wrote $OutFile"
} else {
  throw 'Export finished but output file is missing.'
}
