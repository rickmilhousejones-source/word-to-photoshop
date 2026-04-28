<#
Exports a Word .docx into a Photoshop-friendly JS data file.

Features:
  - Splits pages by paragraph markers like #001, #002
  - Preserves run-level bold / italic
  - Avoids JSON.parse in Photoshop ExtendScript by writing a JS object literal

Usage:
  powershell -ExecutionPolicy Bypass -File .\export_docx_styles.ps1
  powershell -ExecutionPolicy Bypass -File .\export_docx_styles.ps1 -DocxPath .\input.docx -OutFile .\out\content.jsxdata
#>

[CmdletBinding()]
param(
  [string] $DocxPath,

  [string] $OutFile,

  [switch] $IncludeEmptyParagraphs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-FullPath([string]$p) {
  if ([System.IO.Path]::IsPathRooted($p)) { return $p }
  return (Resolve-Path -LiteralPath $p).Path
}

function Select-DocxFile() {
  Add-Type -AssemblyName System.Windows.Forms | Out-Null
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title = 'Select Word Document'
  $dialog.Filter = 'Word Document (*.docx)|*.docx|All Files (*.*)|*.*'
  $dialog.Multiselect = $false

  $result = $dialog.ShowDialog()
  if ($result -ne [System.Windows.Forms.DialogResult]::OK -or [string]::IsNullOrWhiteSpace($dialog.FileName)) {
    throw 'Word document selection cancelled.'
  }
  return $dialog.FileName
}

function Select-OutputFilePath([string]$docxFullPath) {
  Add-Type -AssemblyName System.Windows.Forms | Out-Null
  $dialog = New-Object System.Windows.Forms.SaveFileDialog
  $dialog.Title = 'Select Photoshop Data Output Path'
  $dialog.Filter = 'Photoshop Data (*.jsxdata)|*.jsxdata|JavaScript (*.js)|*.js|All Files (*.*)|*.*'
  $dialog.OverwritePrompt = $true
  $dialog.AddExtension = $true
  $dialog.DefaultExt = 'jsxdata'
  $dialog.FileName = [System.IO.Path]::GetFileNameWithoutExtension($docxFullPath) + '.jsxdata'

  $result = $dialog.ShowDialog()
  if ($result -ne [System.Windows.Forms.DialogResult]::OK -or [string]::IsNullOrWhiteSpace($dialog.FileName)) {
    throw 'Output path selection cancelled.'
  }
  return $dialog.FileName
}

function Get-WordDocumentXml([string]$docxFullPath) {
  if (-not (Test-Path -LiteralPath $docxFullPath)) {
    throw "File not found: $docxFullPath"
  }
  Add-Type -AssemblyName System.IO.Compression | Out-Null
  Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null
  $fs = [System.IO.File]::OpenRead($docxFullPath)
  try {
    $zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Read, $false)
    try {
      $entry = $zip.GetEntry('word/document.xml')
      if (-not $entry) { throw "Missing 'word/document.xml' in docx (is it a valid .docx?)" }
      $stream = $entry.Open()
      try {
        $sr = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8, $true)
        try { return $sr.ReadToEnd() } finally { $sr.Dispose() }
      } finally { $stream.Dispose() }
    } finally {
      $zip.Dispose()
    }
  } finally {
    $fs.Dispose()
  }
}

function New-Segment([string]$text, [bool]$bold, [bool]$italic) {
  [pscustomobject]@{
    text   = $text
    bold   = $bold
    italic = $italic
  }
}

function Append-Segment([System.Collections.Generic.List[object]]$segments, [string]$text, [bool]$bold, [bool]$italic) {
  if ([string]::IsNullOrEmpty($text)) { return }
  $last = if ($segments.Count -gt 0) { $segments[$segments.Count - 1] } else { $null }
  if ($last -and $last.bold -eq $bold -and $last.italic -eq $italic) {
    $last.text += $text
    return
  }
  $segments.Add((New-Segment -text $text -bold $bold -italic $italic)) | Out-Null
}

function Test-WordOnOffNode([System.Xml.XmlNode]$node) {
  if (-not $node) { return $false }

  $valAttr = $null
  if ($node.Attributes) {
    $valAttr = $node.Attributes.GetNamedItem('w:val')
    if (-not $valAttr) {
      $valAttr = $node.Attributes.GetNamedItem('val')
    }
    if (-not $valAttr) {
      for ($idx = 0; $idx -lt $node.Attributes.Count; $idx++) {
        $attr = $node.Attributes.Item($idx)
        if ($attr -and $attr.LocalName -eq 'val') {
          $valAttr = $attr
          break
        }
      }
    }
  }

  if (-not $valAttr) { return $true }

  $valText = [string]$valAttr.InnerText
  if ([string]::IsNullOrWhiteSpace($valText)) { return $true }

  switch ($valText.ToLowerInvariant()) {
    '0' { return $false }
    'false' { return $false }
    'off' { return $false }
    default { return $true }
  }
}

function Get-RunStyle([xml]$xmlDoc, [System.Xml.XmlElement]$rNode, [System.Xml.XmlNamespaceManager]$ns) {
  $bold = $false
  $italic = $false

  $rPr = $rNode.SelectSingleNode('./w:rPr', $ns)
  if ($rPr) {
    $b = $rPr.SelectSingleNode('./w:b', $ns)
    if ($b) {
      $bold = Test-WordOnOffNode $b
    }
    $i = $rPr.SelectSingleNode('./w:i', $ns)
    if ($i) {
      $italic = Test-WordOnOffNode $i
    }
  }

  return @{ bold = $bold; italic = $italic }
}

function Get-ParagraphPlainText([object]$segments) {
  if (-not $segments -or $segments.Count -eq 0) { return '' }
  $sb = New-Object System.Text.StringBuilder
  foreach ($segment in $segments) {
    [void]$sb.Append([string]$segment.text)
  }
  return $sb.ToString()
}

function Parse-Paragraphs([string]$xmlText) {
  $xmlDoc = New-Object System.Xml.XmlDocument
  $xmlDoc.PreserveWhitespace = $true
  $xmlDoc.LoadXml($xmlText)

  $ns = New-Object System.Xml.XmlNamespaceManager($xmlDoc.NameTable)
  $ns.AddNamespace('w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main')

  $paras = New-Object System.Collections.Generic.List[object]

  $pNodes = $xmlDoc.SelectNodes('//w:document/w:body/w:p', $ns)
  foreach ($p in $pNodes) {
    $segments = New-Object System.Collections.Generic.List[object]

    $rNodes = $p.SelectNodes('./w:r', $ns)
    foreach ($r in $rNodes) {
      $style = Get-RunStyle -xmlDoc $xmlDoc -rNode $r -ns $ns
      $bold = [bool]$style.bold
      $italic = [bool]$style.italic

      # Text nodes
      $tNodes = $r.SelectNodes('./w:t', $ns)
      foreach ($t in $tNodes) {
        # Preserve spaces: Word uses xml:space="preserve" sometimes; the text content already includes spaces.
        Append-Segment -segments $segments -text $t.InnerText -bold $bold -italic $italic
      }

      # Tabs
      $tabNodes = $r.SelectNodes('./w:tab', $ns)
      foreach ($tab in $tabNodes) {
        Append-Segment -segments $segments -text "`t" -bold $bold -italic $italic
      }

      # Line breaks within paragraph
      $brNodes = $r.SelectNodes('./w:br | ./w:cr', $ns)
      foreach ($br in $brNodes) {
        Append-Segment -segments $segments -text "`n" -bold $bold -italic $italic
      }
    }

    $paraObj = [pscustomobject]@{
      segments = $segments
      text = (Get-ParagraphPlainText $segments)
    }

    if ($IncludeEmptyParagraphs -or $segments.Count -gt 0) {
      $paras.Add($paraObj) | Out-Null
    }
  }

  return $paras
}

function Group-ParagraphsByPage([object]$paragraphs) {
  $pageMarkerRegex = '^\s*#(?<page>\d{1,})\s*$'
  $pages = New-Object System.Collections.Generic.List[object]
  $warnings = New-Object System.Collections.Generic.List[string]
  $currentPage = $null

  foreach ($paragraph in $paragraphs) {
    $plainText = [string]$paragraph.text
    $match = [regex]::Match($plainText, $pageMarkerRegex)
    if ($match.Success) {
      $pageNumber = $match.Groups['page'].Value.PadLeft(3, '0')
      $currentPage = [pscustomobject]@{
        page = $pageNumber
        paragraphs = New-Object System.Collections.Generic.List[object]
      }
      $pages.Add($currentPage) | Out-Null
      continue
    }

    if (-not $currentPage) {
      if (-not [string]::IsNullOrWhiteSpace($plainText)) {
        $warnings.Add("Ignored content before first page marker: $plainText") | Out-Null
      }
      continue
    }

    $nextParagraphIndex = $currentPage.paragraphs.Count + 1
    $currentPage.paragraphs.Add([pscustomobject]@{
      index = $nextParagraphIndex
      text = $paragraph.text
      segments = $paragraph.segments
    }) | Out-Null
  }

  return [pscustomobject]@{
    pages = $pages
    warnings = $warnings
  }
}

function Build-ExportPayload([string]$docxFullPath, [object]$groupedPages) {
  return [pscustomobject]@{
    version = 2
    source  = [pscustomobject]@{
      type = 'docx'
      path = $docxFullPath
    }
    pageMarkerPattern = '#NNN'
    pages = $groupedPages.pages
    warnings = $groupedPages.warnings
  }
}

function ConvertTo-PhotoshopDataFile([object]$payload) {
  $json = $payload | ConvertTo-Json -Depth 50
  return @"
var WORD_IMPORT_DATA = $json;
"@
}

if ([string]::IsNullOrWhiteSpace($DocxPath)) {
  $DocxPath = Select-DocxFile
}

$docxFull = Resolve-FullPath $DocxPath

if ([string]::IsNullOrWhiteSpace($OutFile)) {
  $OutFile = Select-OutputFilePath -docxFullPath $docxFull
}

$outFull = if ([System.IO.Path]::IsPathRooted($OutFile)) { $OutFile } else { Join-Path (Get-Location) $OutFile }

$xml = Get-WordDocumentXml -docxFullPath $docxFull
$paragraphs = Parse-Paragraphs -xmlText $xml
$grouped = Group-ParagraphsByPage -paragraphs $paragraphs
$payload = Build-ExportPayload -docxFullPath $docxFull -groupedPages $grouped

$outDir = Split-Path -Parent $outFull
if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}

[System.IO.File]::WriteAllText($outFull, (ConvertTo-PhotoshopDataFile -payload $payload), [System.Text.Encoding]::UTF8)

Write-Host "Wrote Photoshop data: $outFull"
Write-Host ("Pages found: " + $payload.pages.Count)
if ($payload.warnings.Count -gt 0) {
  Write-Host "Warnings:"
  foreach ($warning in $payload.warnings) {
    Write-Host ("- " + $warning)
  }
}
