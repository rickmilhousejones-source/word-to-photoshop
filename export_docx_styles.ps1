<#
Exports a Word .docx into a Photoshop-friendly JS data file.

Features:
  - Splits pages by paragraph markers like #001, #002, P01, plain digits
  - Preserves run-level bold / italic
  - Skips text inside floating text boxes (w:txbxContent); skips inline images without failing
  - If input path ends with .doc: copies bytes to a temp .docx path before reading the zip (for mis-suffixed OOXML or user-renamed files; not Word 97-2003 binary)
  - Avoids JSON.parse in Photoshop ExtendScript by writing a JS object literal

Usage:
  powershell -ExecutionPolicy Bypass -File .\export_docx_styles.ps1
  powershell -ExecutionPolicy Bypass -File .\export_docx_styles.ps1 -DocxPath .\input.docx -OutFile .\out\content.jsxdata
#>

[CmdletBinding()]
param(
  [string] $DocxPath,

  [string] $OutFile,

  [switch] $IncludeEmptyParagraphs,

  [switch] $Minify
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
  $dialog.Filter = 'Word (*.docx;*.doc)|*.docx;*.doc|All Files (*.*)|*.*'
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

function New-XmlDocumentFromWordMarkup([string]$xmlText) {
  # Word 有时写入 XML 1.0 非法字符（尤其含图/复制粘贴），LoadXml 会整段失败；用 Reader 放宽校验。
  # 使用 $readerSettings：部分宿主在 Set-StrictMode 下对 $settings 名称异常敏感。
  $readerSettings = New-Object System.Xml.XmlReaderSettings
  $readerSettings.CheckCharacters = $false
  $readerSettings.IgnoreComments = $true
  $readerSettings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
  $stringReader = New-Object System.IO.StringReader($xmlText)
  try {
    $reader = [System.Xml.XmlReader]::Create($stringReader, $readerSettings)
    try {
      $xmlDoc = New-Object System.Xml.XmlDocument
      $xmlDoc.PreserveWhitespace = $true
      $xmlDoc.Load($reader)
      return $xmlDoc
    }
    finally {
      if ($null -ne $reader) { $reader.Dispose() }
    }
  }
  finally {
    if ($null -ne $stringReader) { $stringReader.Dispose() }
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

function Normalize-ExportPageKey([string]$digits) {
  if ([string]::IsNullOrWhiteSpace($digits)) { return $null }
  return ([string]$digits).PadLeft(3, '0')
}

function Try-GetPageMarkerFromPlain([string]$plainText) {
  if ([string]::IsNullOrWhiteSpace($plainText)) { return $null }
  $t = $plainText.Trim()
  if ($t.Length -eq 0) { return $null }
  $m = [regex]::Match($t, '^\s*#(?<n>\d{1,4})\s*$')
  if ($m.Success) { return (Normalize-ExportPageKey $m.Groups['n'].Value) }
  $m = [regex]::Match($t, '^\s*P(?<n>\d{1,4})\s*$', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  if ($m.Success) { return (Normalize-ExportPageKey $m.Groups['n'].Value) }
  $m = [regex]::Match($t, '^\s*(?<n>\d{1,4})\s*$')
  if ($m.Success) { return (Normalize-ExportPageKey $m.Groups['n'].Value) }
  return $null
}

function Parse-Paragraphs([string]$xmlText) {
  $xmlDoc = New-XmlDocumentFromWordMarkup -xmlText $xmlText

  $ns = New-Object System.Xml.XmlNamespaceManager($xmlDoc.NameTable)
  $ns.AddNamespace('w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main')
  $ns.AddNamespace('mc', 'http://schemas.openxmlformats.org/markup-compatibility/2006')

  $paras = New-Object System.Collections.Generic.List[object]

  # 含 w:tbl / 内容控件等时，正文 w:p 往往不在 body 的直接子级；必须取 body 下所有段落。
  $pNodes = $xmlDoc.SelectNodes('//w:body//w:p', $ns)
  foreach ($p in $pNodes) {
    # 浮动文本框 / 形状内文字（非正文流）
    if ($null -ne $p.SelectSingleNode('ancestor::w:txbxContent', $ns)) { continue }

    $segments = New-Object System.Collections.Generic.List[object]

    $rNodes = $p.SelectNodes('./w:r', $ns)
    foreach ($r in $rNodes) {
      # Inline images / drawings: ignore image-only runs; keep text if Word merged w:t in the same w:r
      $tProbe = $r.SelectNodes('.//w:t', $ns)
      $onlyMedia =
        ($tProbe.Count -eq 0) -and (
          ($null -ne $r.SelectSingleNode('./w:drawing', $ns)) -or
          ($null -ne $r.SelectSingleNode('./w:pict', $ns)) -or
          ($null -ne $r.SelectSingleNode('./mc:AlternateContent', $ns)) -or
          ($null -ne $r.SelectSingleNode('./w:object', $ns))
        )
      if ($onlyMedia) { continue }

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
  $pages = New-Object System.Collections.Generic.List[object]
  $warnings = New-Object System.Collections.Generic.List[string]
  $currentPage = $null

  foreach ($paragraph in $paragraphs) {
    $plainText = [string]$paragraph.text
    $pageNumber = Try-GetPageMarkerFromPlain $plainText
    if ($pageNumber) {
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
    exportedAt = (Get-Date).ToString('o')
    docxFileName = [System.IO.Path]::GetFileName($docxFullPath)
    source  = [pscustomobject]@{
      type = 'docx'
      path = $docxFullPath
    }
    pageMarkerPattern = '#NNN | Pnnn (case-insensitive) | plain digits NNN'
    pages = $groupedPages.pages
    warnings = $groupedPages.warnings
  }
}

function ConvertTo-PhotoshopDataFile([object]$payload, [switch]$Minify) {
  $json = if ($Minify) {
    $payload | ConvertTo-Json -Depth 50 -Compress
  } else {
    $payload | ConvertTo-Json -Depth 50
  }
  return 'var WORD_IMPORT_DATA = ' + $json + ';'
}

function Copy-DocPathToTempDocxPath([string]$sourcePath) {
  $sourcePath = Resolve-FullPath $sourcePath
  if (-not (Test-Path -LiteralPath $sourcePath)) { throw "File not found: $sourcePath" }
  if ([System.IO.Path]::GetExtension($sourcePath) -ine ".doc") {
    return $sourcePath
  }
  $tempDocx = Join-Path ([System.IO.Path]::GetTempPath()) ('word_import_doc_as_docx_' + [Guid]::NewGuid().ToString('N') + '.docx')
  Copy-Item -LiteralPath $sourcePath -Destination $tempDocx -Force
  return $tempDocx
}

if ([string]::IsNullOrWhiteSpace($DocxPath)) {
  $DocxPath = Select-DocxFile
}

$payloadSourcePath = Resolve-FullPath $DocxPath
$tempRenamedDocx = $null
$docxFull = $payloadSourcePath
try {
  try {
    if ([System.IO.Path]::GetExtension($payloadSourcePath) -ieq ".doc") {
      $docxFull = Copy-DocPathToTempDocxPath -sourcePath $payloadSourcePath
      $tempRenamedDocx = $docxFull
    }

    if ([string]::IsNullOrWhiteSpace($OutFile)) {
      $OutFile = Select-OutputFilePath -docxFullPath $payloadSourcePath
    }

    $outFull = if ([System.IO.Path]::IsPathRooted($OutFile)) { $OutFile } else { Join-Path (Get-Location) $OutFile }

    $xml = Get-WordDocumentXml -docxFullPath $docxFull
    $paragraphs = Parse-Paragraphs -xmlText $xml
    $grouped = Group-ParagraphsByPage -paragraphs $paragraphs
    $payload = Build-ExportPayload -docxFullPath $payloadSourcePath -groupedPages $grouped

    $outDir = Split-Path -Parent $outFull
    if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
      New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    }

    [System.IO.File]::WriteAllText($outFull, (ConvertTo-PhotoshopDataFile -payload $payload -Minify:$Minify), [System.Text.Encoding]::UTF8)

    Write-Host "Wrote Photoshop data: $outFull"
    Write-Host ("Pages found: " + $payload.pages.Count)
    if ($payload.warnings.Count -gt 0) {
      Write-Host "Warnings:"
      foreach ($warning in $payload.warnings) {
        Write-Host ("- " + $warning)
      }
    }
  } catch {
    $m = $_.Exception.Message
    $code = 'E_UNKNOWN'
    if ($m -match '(?i)cancel') { $code = 'E_USER_CANCEL' }
    elseif ($m -match '(?i)document\.xml|Missing') { $code = 'E_DOCX_STRUCTURE' }
    elseif ($m -match '(?i)not found|file not found|cannot find|missing path') { $code = 'E_IO' }
    elseif ($m -match '(?i)zip|InvalidData|corrupt') { $code = 'E_DOCX_ZIP' }
    elseif ($m -match '(?i)access|denied|Unauthorized') { $code = 'E_IO_ACCESS' }
    Write-Host ("[" + $code + "] " + $m)
    throw
  }
}
finally {
  if ($tempRenamedDocx -and (Test-Path -LiteralPath $tempRenamedDocx)) {
    Remove-Item -LiteralPath $tempRenamedDocx -Force -ErrorAction SilentlyContinue
  }
}
