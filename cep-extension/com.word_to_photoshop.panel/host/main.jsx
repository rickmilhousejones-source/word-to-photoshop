#target photoshop

if (!$.global.WORD_IMPORT_CEP) {
  $.global.WORD_IMPORT_CEP = {};
}

$.global.WORD_IMPORT_CEP.BUILD_ID = "2026-05-03T12:00+08 cep-v1.2";

$.global.WORD_IMPORT_CEP.ping = function () {
  return "PONG|Photoshop CEP Host Ready|build=" + ($.global.WORD_IMPORT_CEP.BUILD_ID || "");
};

/**
 * Identify which copy of the runtime scripts the host is using.
 * Returns OK|<source>|<resolvedPath>, where <source> is one of:
 *   - "bundled"  : extension's own host/repo/  (preferred)
 *   - "legacy"   : env / repo_path.txt / dev fallback
 *   - "missing"  : nothing usable found
 */
$.global.WORD_IMPORT_CEP.getRuntimeSource = function () {
  try {
    var bundled = $.global.WORD_IMPORT_CEP._getBundledRepoRoot();
    if (bundled) return "OK|bundled|" + bundled.fsName;
    var resolved = $.global.WORD_IMPORT_CEP.getRepoRoot();
    if (resolved) return "OK|legacy|" + resolved.fsName;
    return "OK|missing|";
  } catch (e) {
    return "ERR|" + e.message;
  }
};

/**
 * Fetch remote JSON (e.g. release-channel.json) when CEP fetch is unavailable.
 * @param {string} urlEncoded encodeURIComponent(remoteUrl)
 * @returns {string} OK|encodeURIComponent(body) or ERR|...
 */
$.global.WORD_IMPORT_CEP.checkRemoteUpdate = function (urlEncoded) {
  try {
    var url = "";
    try {
      url = decodeURIComponent(String(urlEncoded || ""));
    } catch (_) {
      url = String(urlEncoded || "");
    }
    url = $.global.WORD_IMPORT_CEP._sanitizePathText(url);
    if (!url || url.indexOf("http") !== 0) return "ERR|bad_url";

    var runId = new Date().getTime();
    var outFile = new File(Folder.temp.fsName + "/word_import_update_" + runId + ".json");
    var ps1 = new File(Folder.temp.fsName + "/word_import_fetch_update_" + runId + ".ps1");
    ps1.encoding = "UTF-8";
    var urlLit = $.global.WORD_IMPORT_CEP._quoteForPs1Sq(url);
    var outLit = $.global.WORD_IMPORT_CEP._quoteForPs1Sq(outFile.fsName);
    if (!ps1.open("w")) return "ERR|temp_ps1";
    try {
      ps1.write("$ErrorActionPreference='Stop'\r\n");
      ps1.write("$u='" + urlLit + "'\r\n");
      ps1.write("$o='" + outLit + "'\r\n");
      ps1.write(
        "try {\r\n" +
          "  $r = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 25\r\n" +
          "  [System.IO.File]::WriteAllText($o, $r.Content, [System.Text.UTF8Encoding]::new($false))\r\n" +
          "  Write-Output 'OK'\r\n" +
          "} catch {\r\n" +
          "  $m = ($_.Exception.Message + '') -replace '[\\r\\n]',' '\r\n" +
          "  [System.IO.File]::WriteAllText($o, ('CHANNEL_FAIL:' + $m), [System.Text.UTF8Encoding]::new($false))\r\n" +
          "  Write-Output 'WROTE_ERR'\r\n" +
          "}\r\n"
      );
    } finally {
      ps1.close();
    }
    var cmd =
      "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " +
      $.global.WORD_IMPORT_CEP._quoteForCmd(ps1.fsName);
    String(app.system(cmd) || "");
    try {
      ps1.remove();
    } catch (_) {}
    if (!outFile.exists) return "ERR|no_output_file";
    outFile.encoding = "UTF-8";
    var raw = "";
    if (!outFile.open("r")) return "ERR|read_fail";
    try {
      raw = outFile.read();
    } finally {
      outFile.close();
    }
    try {
      outFile.remove();
    } catch (_) {}
    if (raw.length && raw.charCodeAt(0) === 0xFEFF) raw = raw.substring(1);
    raw = String(raw || "").replace(/^\s+|\s+$/g, "");
    if (!raw) return "ERR|empty_body";
    if (raw.indexOf("CHANNEL_FAIL:") === 0) {
      return "ERR|" + raw.substring(14);
    }
    return "OK|" + encodeURIComponent(raw);
  } catch (e) {
    return "ERR|" + e.message + " (line: " + (e.line || "?") + ")";
  }
};

/**
 * Download a release zip (HTTPS only, github.com / raw.githubusercontent.com).
 * Saves under %USERPROFILE%\\Downloads. Returns OK|_encodeJSON({ savedPath, folder }).
 */
$.global.WORD_IMPORT_CEP.downloadReleaseZip = function (urlEncoded, suggestedLeafEncoded) {
  try {
    var url = "";
    try {
      url = decodeURIComponent(String(urlEncoded || ""));
    } catch (_) {
      url = String(urlEncoded || "");
    }
    url = $.global.WORD_IMPORT_CEP._sanitizePathText(url);
    if (url.indexOf("https://") !== 0) return "ERR|https_only";
    var allowed =
      url.indexOf("https://github.com/") === 0 ||
      url.indexOf("https://raw.githubusercontent.com/") === 0 ||
      url.indexOf("https://gitee.com/") === 0 ||
      url.indexOf("https://cdn.jsdelivr.net/") === 0;
    if (!allowed) return "ERR|host_not_allowed";

    var leafHint = "";
    try {
      leafHint = decodeURIComponent(String(suggestedLeafEncoded || ""));
    } catch (_) {
      leafHint = String(suggestedLeafEncoded || "");
    }
    leafHint = $.global.WORD_IMPORT_CEP._sanitizePathText(leafHint);

    var runId = new Date().getTime();
    var resultPath = Folder.temp.fsName + "/word_import_dl_result_" + runId + ".json";
    var ps1 = new File(Folder.temp.fsName + "/word_import_dl_" + runId + ".ps1");
    ps1.encoding = "UTF-8";
    var urlLit = $.global.WORD_IMPORT_CEP._quoteForPs1Sq(url);
    var resultLit = $.global.WORD_IMPORT_CEP._quoteForPs1Sq(resultPath);
    var hintLit = $.global.WORD_IMPORT_CEP._quoteForPs1Sq(leafHint);
    if (!ps1.open("w")) return "ERR|temp_ps1";
    try {
      ps1.write("$ErrorActionPreference='Stop'\r\n");
      ps1.write("$u='" + urlLit + "'\r\n");
      ps1.write("$resultPath='" + resultLit + "'\r\n");
      ps1.write("$hint='" + hintLit + "'\r\n");
      ps1.write(
        "$downloads = Join-Path $env:USERPROFILE 'Downloads'\r\n" +
          "if (-not (Test-Path -LiteralPath $downloads)) { New-Item -ItemType Directory -Path $downloads -Force | Out-Null }\r\n" +
          "$leaf = $hint\r\n" +
          "if (-not $leaf) {\r\n" +
          "  try { $leaf = [System.IO.Path]::GetFileName(([uri]$u).AbsolutePath) } catch { $leaf = '' }\r\n" +
          "}\r\n" +
          "if (-not $leaf -or $leaf -notmatch '\\.(zip|ZIP)$') { $leaf = 'word-to-photoshop-update.zip' }\r\n" +
          "$leaf = ($leaf -replace '[^a-zA-Z0-9._\\-]', '_')\r\n" +
          "$dest = Join-Path $downloads $leaf\r\n" +
          "if (Test-Path -LiteralPath $dest) {\r\n" +
          "  $stem = [System.IO.Path]::GetFileNameWithoutExtension($dest)\r\n" +
          "  $ext = [System.IO.Path]::GetExtension($dest)\r\n" +
          "  $dest = Join-Path $downloads ($stem + '_' + [DateTime]::UtcNow.ToString('yyyyMMddHHmmss') + $ext)\r\n" +
          "}\r\n" +
          "try {\r\n" +
          "  Invoke-WebRequest -Uri $u -OutFile $dest -UseBasicParsing -TimeoutSec 300\r\n" +
          "  $folder = Split-Path -Parent $dest\r\n" +
          "  @{ ok = $true; savedPath = $dest; folder = $folder } | ConvertTo-Json -Compress | Set-Content -LiteralPath $resultPath -Encoding UTF8\r\n" +
          "  Write-Output 'OK'\r\n" +
          "} catch {\r\n" +
          "  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress | Set-Content -LiteralPath $resultPath -Encoding UTF8\r\n" +
          "  Write-Output ('ERR|' + $_.Exception.Message)\r\n" +
          "}\r\n"
      );
    } finally {
      ps1.close();
    }
    var cmd =
      "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " +
      $.global.WORD_IMPORT_CEP._quoteForCmd(ps1.fsName);
    String(app.system(cmd) || "");
    try {
      ps1.remove();
    } catch (_) {}

    var rf = new File(resultPath);
    if (!rf.exists) return "ERR|no_result";
    rf.encoding = "UTF-8";
    var raw = "";
    if (!rf.open("r")) return "ERR|read_result";
    try {
      raw = rf.read();
    } finally {
      rf.close();
    }
    try {
      rf.remove();
    } catch (_) {}
    if (raw.length && raw.charCodeAt(0) === 0xFEFF) raw = raw.substring(1);
    raw = String(raw || "").replace(/^\s+|\s+$/g, "");
    var obj = null;
    try {
      if (typeof JSON !== "undefined" && JSON && JSON.parse) obj = JSON.parse(raw);
      else obj = eval("(" + raw + ")");
    } catch (e2) {
      return "ERR|bad_result_json";
    }
    if (!obj || obj.ok !== true) return "ERR|" + String(obj && obj.error ? obj.error : "download_failed");
    return "OK|" + $.global.WORD_IMPORT_CEP._encodeJSON({ savedPath: obj.savedPath, folder: obj.folder });
  } catch (e) {
    return "ERR|" + e.message + " (line: " + (e.line || "?") + ")";
  }
};

/** Open a folder in Explorer (UTF-8 path via PowerShell). */
$.global.WORD_IMPORT_CEP.openFolderInExplorer = function (folderEncoded) {
  try {
    var folder = "";
    try {
      folder = decodeURIComponent(String(folderEncoded || ""));
    } catch (_) {
      folder = String(folderEncoded || "");
    }
    folder = $.global.WORD_IMPORT_CEP._sanitizePathText(folder);
    if (!folder) return "ERR|empty_folder";
    var runId = new Date().getTime();
    var ps1 = new File(Folder.temp.fsName + "/word_import_openfolder_" + runId + ".ps1");
    ps1.encoding = "UTF-8";
    var flit = $.global.WORD_IMPORT_CEP._quoteForPs1Sq(folder);
    if (!ps1.open("w")) return "ERR|temp_ps1";
    try {
      ps1.write("$ErrorActionPreference='Stop'\r\n");
      ps1.write("$d='" + flit + "'\r\n");
      ps1.write("if (-not (Test-Path -LiteralPath $d)) { throw 'folder_missing' }\r\n");
      ps1.write("Invoke-Item -LiteralPath $d\r\n");
    } finally {
      ps1.close();
    }
    var cmd =
      "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " +
      $.global.WORD_IMPORT_CEP._quoteForCmd(ps1.fsName);
    app.system(cmd);
    try {
      ps1.remove();
    } catch (_) {}
    return "OK|opened";
  } catch (e3) {
    return "ERR|" + e3.message;
  }
};

/** Open https URL in default browser (CEP fallback when cep.util is missing). */
$.global.WORD_IMPORT_CEP.openUrlInDefaultBrowser = function (urlRaw) {
  try {
    var u = String(urlRaw == null ? "" : urlRaw).replace(/\r|\n/g, "");
    if (!u || u.indexOf("http") !== 0) return "ERR|bad_url";
    var inner = "Start-Process -FilePath '" + $.global.WORD_IMPORT_CEP._quoteForPs1Sq(u) + "'";
    var cmd =
      "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command " +
      $.global.WORD_IMPORT_CEP._quoteForCmd(inner);
    app.system(cmd);
    return "OK|opened";
  } catch (e) {
    return "ERR|" + e.message;
  }
};

/** Remove text layers created by this tool: "Word Import #…" (batch) and "Bubble #…" (CEP drag). */
$.global.WORD_IMPORT_CEP.clearImportedDialogues = function () {
  try {
    if (app.name !== "Adobe Photoshop") return "ERR|请在 Photoshop 中运行";
    if (app.documents.length <= 0) return "ERR|请先打开 PSD 文档";

    var doc = app.activeDocument;

    function matchImportName(nm) {
      return /^Word Import #|^Bubble #/i.test(String(nm || ""));
    }

    function walk(container) {
      var removed = 0;
      var ls = container.layers;
      if (!ls) return 0;
      var n = ls.length;
      if (!n) return 0;
      for (var i = n; i >= 1; i--) {
        try {
          var lyr = ls[i];
          if (lyr.typename === "ArtLayer") {
            if (lyr.kind === LayerKind.TEXT && matchImportName(lyr.name)) {
              lyr.remove();
              removed++;
            }
          } else if (lyr.typename === "LayerSet") {
            removed += walk(lyr);
          }
        } catch (_) {}
      }
      return removed;
    }

    var total = walk(doc);
    return "OK|" + $.global.WORD_IMPORT_CEP._encodeJSON({ removedCount: total });
  } catch (e) {
    return "ERR|" + e.message + " (line: " + (e.line || "?") + ")";
  }
};

$.global.WORD_IMPORT_CEP._sanitizePathText = function (raw) {
  var s = String(raw == null ? "" : raw);
  if (s.length && s.charCodeAt(0) === 0xFEFF) s = s.substring(1);
  // Windows PowerShell may write marker files as UTF-16LE; strip embedded NULs.
  s = s.replace(/\u0000/g, "");
  s = s.replace(/\r/g, "").replace(/\n/g, "");
  while (s.length && (s.charAt(0) === " " || s.charAt(0) === "\t" || s.charAt(0) === "\"" || s.charAt(0) === "'")) s = s.substring(1);
  while (s.length && (s.charAt(s.length - 1) === " " || s.charAt(s.length - 1) === "\t" || s.charAt(s.length - 1) === "\"" || s.charAt(s.length - 1) === "'")) s = s.substring(0, s.length - 1);
  return s;
};

/** Last path segment (handles \ and /). */
$.global.WORD_IMPORT_CEP._pathLastSegment = function (fsPath) {
  var s = String(fsPath == null ? "" : fsPath).replace(/\\/g, "/");
  var i = s.lastIndexOf("/");
  return i >= 0 ? s.substring(i + 1) : s;
};

/** If the leaf name looks URI-encoded (e.g. File#name on some hosts), decode once. */
$.global.WORD_IMPORT_CEP._maybeDecodePercentEncoded = function (s) {
  var t = String(s == null ? "" : s);
  if (!/%[0-9A-Fa-f]{2}/.test(t)) return t;
  try {
    var dec = decodeURIComponent(t.replace(/\+/g, " "));
    return dec.length > 0 ? dec : t;
  } catch (e) {
    return t;
  }
};

/** Basename for sibling .jsxdata: prefer fsName leaf (Unicode-safe), then decode %XX if needed. */
$.global.WORD_IMPORT_CEP._jsxdataBaseNameFromDocxFile = function (docxFile) {
  try {
    var leaf = "";
    try {
      leaf = $.global.WORD_IMPORT_CEP._pathLastSegment(docxFile && docxFile.fsName ? docxFile.fsName : "");
    } catch (e0) {
      leaf = "";
    }
    if (!leaf && docxFile && docxFile.name) leaf = String(docxFile.name);
    leaf = $.global.WORD_IMPORT_CEP._maybeDecodePercentEncoded(leaf);
    return leaf.replace(/\.[^\.]+$/, "");
  } catch (e) {
    try {
      return String(docxFile && docxFile.name ? docxFile.name : "word_import_export").replace(/\.[^\.]+$/, "");
    } catch (e2) {
      return "word_import_export";
    }
  }
};

$.global.WORD_IMPORT_CEP.getUserDataRoot = function () {
  try {
    var appdata = $.getenv("APPDATA");
    if (!appdata) return null;
    var f = new Folder(appdata + "/com.word_to_photoshop");
    if (!f.exists) {
      try { f.create(); } catch (_) {}
    }
    return f.exists ? f : null;
  } catch (_) {
    return null;
  }
};

$.global.WORD_IMPORT_CEP._getBundledRepoRoot = function () {
  function coreExistsInFolder(fol) {
    try {
      if (!fol || !fol.exists) return false;
      return new File(fol.fsName + "/import_to_photoshop.jsx").exists;
    } catch (_) {
      return false;
    }
  }
  try {
    var mainFile = new File($.fileName);
    var hostDir = mainFile.parent;
    var extRoot = hostDir.parent;
    var relPanel = "/cep-extension/com.word_to_photoshop.panel/host/repo";
    var cands = [];
    cands.push(extRoot.fsName + "/host/repo");
    cands.push(hostDir.fsName + "/repo");
    var walk = extRoot;
    for (var i = 0; i < 14 && walk; i++) {
      cands.push(walk.fsName + relPanel);
      try {
        walk = walk.parent;
      } catch (_) {
        walk = null;
      }
    }
    for (var j = 0; j < cands.length; j++) {
      try {
        var f = new Folder(cands[j]);
        if (coreExistsInFolder(f)) return f;
      } catch (_) {}
    }
    // Last resort: canonical per-user install path (install_cep.ps1 always writes here).
    // Fixes CEP Symbolic / dev roots where $.fileName sits under e.g. D:\...\host\main.jsx
    // but the real bundled scripts only exist under AppData.
    try {
      var ad = $.getenv("APPDATA");
      if (ad) {
        var appdataBundle = new Folder(ad + "/Adobe/CEP/extensions/com.word_to_photoshop.panel/host/repo");
        if (coreExistsInFolder(appdataBundle)) return appdataBundle;
      }
    } catch (_) {}
  } catch (_) {}
  return null;
};

$.global.WORD_IMPORT_CEP.diagnoseRepoRoot = function () {
  var out = [];
  out.push("host=" + $.fileName);
  try { out.push("env=" + $.getenv("WORD_IMPORT_REPO_PATH")); } catch (_) {}
  try {
    var extRoot = new File($.fileName).parent.parent;
    out.push("extRoot=" + extRoot.fsName);
    var bundled = new Folder(extRoot.fsName + "/host/repo");
    out.push("bundled=" + bundled.fsName);
    out.push("bundledExists=" + bundled.exists);
    if (bundled.exists) {
      var coreFile = new File(bundled.fsName + "/import_to_photoshop.jsx");
      out.push("bundledCoreExists=" + coreFile.exists);
    }
    try {
      var ad0 = $.getenv("APPDATA");
      if (ad0) {
        var ab0 = new Folder(ad0 + "/Adobe/CEP/extensions/com.word_to_photoshop.panel/host/repo");
        out.push("appdataBundle=" + ab0.fsName);
        out.push("appdataBundleCoreExists=" + new File(ab0.fsName + "/import_to_photoshop.jsx").exists);
      }
    } catch (_) {}
    var marker = new File(extRoot.fsName + "/host/repo_path.txt");
    out.push("legacyMarker=" + marker.fsName);
    out.push("legacyMarkerExists=" + marker.exists);
    if (marker.exists && marker.open("r")) {
      var raw = marker.read();
      marker.close();
      var p = $.global.WORD_IMPORT_CEP._sanitizePathText(raw);
      out.push("legacyMarkerPath=" + p);
      var lf = new Folder(p);
      out.push("legacyFolderExists=" + lf.exists);
    }
  } catch (e) {
    out.push("diagErr=" + e.message);
  }
  try {
    var udr = $.global.WORD_IMPORT_CEP.getUserDataRoot();
    out.push("userDataRoot=" + (udr ? udr.fsName : "(none)"));
  } catch (_) {}
  try {
    var resolved = $.global.WORD_IMPORT_CEP.getRepoRoot();
    out.push("resolved=" + (resolved ? resolved.fsName : "(null)"));
  } catch (_) {}
  return out.join("; ");
};

$.global.WORD_IMPORT_CEP.getRepoRoot = function () {
  // Preferred: extension is self-contained — runtime files live in host/repo/.
  var bundled = $.global.WORD_IMPORT_CEP._getBundledRepoRoot();
  if (bundled) return bundled;

  // Legacy / dev fallbacks below — kept so old installs and in-repo dev still work
  // even before the user re-runs install_cep.ps1 against this version.
  try {
    var envPath = $.getenv("WORD_IMPORT_REPO_PATH");
    envPath = $.global.WORD_IMPORT_CEP._sanitizePathText(envPath);
    if (envPath) {
      var envFolder = new Folder(envPath);
      if (envFolder.exists) {
        var envCore = new File(envFolder.fsName + "/import_to_photoshop.jsx");
        if (envCore.exists) return envFolder;
      }
    }
  } catch (_) {}

  var extRoot = new File($.fileName).parent.parent;

  try {
    var marker = new File(extRoot.fsName + "/host/repo_path.txt");
    if (marker.exists && marker.open("r")) {
      var raw = marker.read();
      marker.close();
      var p = $.global.WORD_IMPORT_CEP._sanitizePathText(raw);
      if (p) {
        var f = new Folder(p);
        if (f.exists) {
          var legacyCore = new File(f.fsName + "/import_to_photoshop.jsx");
          if (legacyCore.exists) return f;
        }
      }
    }
  } catch (_) {}

  try {
    if (extRoot.parent && extRoot.parent.parent && extRoot.parent.parent.parent) {
      var fallback = extRoot.parent.parent.parent;
      if (fallback && fallback.exists) {
        var fbCore = new File(fallback.fsName + "/import_to_photoshop.jsx");
        if (fbCore.exists) return fallback;
      }
    }
  } catch (_) {}

  return null;
};

$.global.WORD_IMPORT_CEP.runRepoScript = function (fileName, repoRootHint) {
  try {
    if (app.name !== "Adobe Photoshop") return "ERR|请在 Photoshop 中运行";
    if (!fileName) return "ERR|缺少文件名";

    if (repoRootHint) {
      var hinted = $.global.WORD_IMPORT_CEP._sanitizePathText(repoRootHint);
      if (hinted) {
        var hintedFolder = new Folder(hinted);
        if (hintedFolder.exists) {
          var hintedTarget = new File(hintedFolder.fsName + "/" + fileName);
          if (hintedTarget.exists) {
            if (String(fileName) === "import_to_photoshop.jsx") {
              // If full panel was opened before, PANEL_MODE may stay true in targetengine
              // and suppress quick-import auto-run. Force quick mode here.
              $.global.WORD_IMPORT_PANEL_MODE = false;
              $.global.WORD_IMPORT_FORCE_CURRENT_PAGE = true;
            }
            $.evalFile(hintedTarget);
            $.global.WORD_IMPORT_FORCE_CURRENT_PAGE = false;
            return "OK|" + hintedTarget.fsName;
          }
        }
      }
    }

    var repoRoot = $.global.WORD_IMPORT_CEP.getRepoRoot();
    if (!repoRoot) return "ERR|扩展运行时缺失，请重新运行 install_cep.ps1 后重启 Photoshop | " + $.global.WORD_IMPORT_CEP.diagnoseRepoRoot();
    var target = new File(repoRoot.fsName + "/" + fileName);
    if (!target.exists) return "ERR|脚本不存在: " + target.fsName;

    if (String(fileName) === "import_to_photoshop.jsx") {
      $.global.WORD_IMPORT_PANEL_MODE = false;
      $.global.WORD_IMPORT_FORCE_CURRENT_PAGE = true;
    }
    $.evalFile(target);
    $.global.WORD_IMPORT_FORCE_CURRENT_PAGE = false;
    return "OK|" + target.fsName;
  } catch (e) {
    try { $.global.WORD_IMPORT_FORCE_CURRENT_PAGE = false; } catch (_) {}
    return "ERR|" + e.message + " (line: " + (e.line || "?") + ")";
  }
};

$.global.WORD_IMPORT_CEP._encodeJSON = function (obj) {
  var s = "";
  try {
    if (typeof JSON !== "undefined" && JSON && JSON.stringify) {
      s = JSON.stringify(obj);
      return encodeURIComponent(s);
    }
  } catch (_) {}
  s = $.global.WORD_IMPORT_CEP._toJSON(obj);
  return encodeURIComponent(String(s));
};

$.global.WORD_IMPORT_CEP._toJSON = function (value) {
  if (value === null || typeof value === "undefined") return "null";
  var t = typeof value;
  if (t === "number" || t === "boolean") return String(value);
  if (t === "string") return $.global.WORD_IMPORT_CEP._quoteJSON(value);
  if (value instanceof Array) {
    var arr = [];
    for (var i = 0; i < value.length; i++) arr.push($.global.WORD_IMPORT_CEP._toJSON(value[i]));
    return "[" + arr.join(",") + "]";
  }
  var parts = [];
  for (var k in value) {
    if (!value.hasOwnProperty(k)) continue;
    parts.push($.global.WORD_IMPORT_CEP._quoteJSON(k) + ":" + $.global.WORD_IMPORT_CEP._toJSON(value[k]));
  }
  return "{" + parts.join(",") + "}";
};

$.global.WORD_IMPORT_CEP._quoteJSON = function (s) {
  return "\"" + String(s)
    .replace(/\\/g, "\\\\")
    .replace(/\"/g, "\\\"")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t") + "\"";
};

/** Escape for PowerShell single-quoted string (double single quotes). */
$.global.WORD_IMPORT_CEP._quoteForPs1Sq = function (s) {
  return String(s == null ? "" : s).replace(/'/g, "''");
};

$.global.WORD_IMPORT_CEP._parseJSON = function (text) {
  var s = String(text == null ? "" : text);
  if (!s) return null;
  try {
    return decodeURIComponent(s);
  } catch (_) {
    return s;
  }
};

$.global.WORD_IMPORT_CEP._quoteForCmd = function (s) {
  var v = String(s == null ? "" : s);
  return "\"" + v.replace(/"/g, "\"\"") + "\"";
};

/** Visible .cmd preamble so the console is not blank while Python runs (app.system is synchronous). */
$.global.WORD_IMPORT_CEP._synthRunnerCmdPreamble = function (cmdTitle) {
  var t = String(cmdTitle || "WTP").replace(/[\r\n]+/g, " ");
  return (
    "@echo off\r\n" +
    "chcp 65001 >nul 2>&1\r\n" +
    "title " +
    t +
    "\r\n" +
    "echo ============================================================\r\n" +
    "echo  Loading... Please do NOT exit or close this window.\r\n" +
    "echo  WTP is running Python; exiting now may abort the job.\r\n" +
    "echo  Output is logged to a file; this may take up to a few minutes.\r\n" +
    "echo ============================================================\r\n" +
    "echo.\r\n"
  );
};

/** Photoshop often hides child consoles; START opens a visible window that runs the batch. */
$.global.WORD_IMPORT_CEP._synthRunnerInvokeCmd = function (runnerFsPath) {
  var p = String(runnerFsPath || "");
  if (!p) return "";
  return (
    "cmd.exe /d/c start \"WTP Loading (do not close)\" /wait cmd.exe /d/c " +
    $.global.WORD_IMPORT_CEP._quoteForCmd(p)
  );
};

/** Double-quotes a path for a .bat/.cmd line (internal " → ""). */
$.global.WORD_IMPORT_CEP._quoteForBatLine = function (s) {
  var v = String(s == null ? "" : s);
  return "\"" + v.replace(/"/g, "\"\"") + "\"";
};

$.global.WORD_IMPORT_CEP._parseProbeNumber = function (v) {
  var n = Number(v);
  return isNaN(n) ? null : n;
};

$.global.WORD_IMPORT_CEP._getCursorProbeStatePath = function () {
  try {
    var t = $.getenv("TEMP");
    if (!t) t = $.getenv("TMP");
    if (!t) return null;
    return String(t).replace(/[\/\\]+$/, "") + "/word_import_cursor.json";
  } catch (_) {
    return null;
  }
};

$.global.WORD_IMPORT_CEP.getCursorProbePathEncoded = function () {
  try {
    var p = $.global.WORD_IMPORT_CEP._getCursorProbeStatePath();
    if (!p) return "ERR|no_path";
    return "OK|" + encodeURIComponent(String(p));
  } catch (e) {
    return "ERR|" + e.message;
  }
};

$.global.WORD_IMPORT_CEP.restartCursorDaemonForProbeV2 = function (repoRootHint) {
  try {
    $.global.WORD_IMPORT_CURSOR_DAEMON_READY = false;
    $.global.WORD_IMPORT_CURSOR_DAEMON_LAST_TRY = 0;
    var tempDir = Folder.temp;
    var killPs = new File(tempDir.fsName + "/word_import_kill_cursor_daemon.ps1");
    killPs.encoding = "UTF-8";
    if (killPs.open("w")) {
      try {
        killPs.write(
          "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'cursor_daemon\\.ps1' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }\r\n"
        );
      } finally {
        killPs.close();
      }
    }
    try {
      app.system(
        "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " +
          $.global.WORD_IMPORT_CEP._quoteForCmd(killPs.fsName)
      );
    } catch (_) {}
    $.global.WORD_IMPORT_CEP._ensureCursorDaemon(repoRootHint);
    return "OK|restarted";
  } catch (e2) {
    return "ERR|" + e2.message;
  }
};

$.global.WORD_IMPORT_CEP._ensureCursorDaemon = function (repoRootHint) {
  try {
    if ($.global.WORD_IMPORT_CURSOR_DAEMON_READY === true) return true;
    var nowMs = new Date().getTime();
    var lastTry = Number($.global.WORD_IMPORT_CURSOR_DAEMON_LAST_TRY || 0);
    if (!isNaN(lastTry) && lastTry > 0 && (nowMs - lastTry) < 15000) {
      return false;
    }
    $.global.WORD_IMPORT_CURSOR_DAEMON_LAST_TRY = nowMs;

    var repoRoot = $.global.WORD_IMPORT_CEP._resolveRepoRootWithHint(repoRootHint);
    if (!repoRoot) return false;
    var starter = new File(repoRoot.fsName + "/start_cursor_daemon.ps1");
    if (!starter.exists) return false;
    var outPath = $.global.WORD_IMPORT_CEP._getCursorProbeStatePath();
    if (!outPath) return false;
    var cmd = "powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " +
      $.global.WORD_IMPORT_CEP._quoteForCmd(starter.fsName) +
      " -RepoRoot " + $.global.WORD_IMPORT_CEP._quoteForCmd(repoRoot.fsName) +
      " -OutFile " + $.global.WORD_IMPORT_CEP._quoteForCmd(outPath);
    app.system(cmd);
    $.global.WORD_IMPORT_CURSOR_DAEMON_READY = true;
    return true;
  } catch (_) {
    return false;
  }
};

$.global.WORD_IMPORT_CEP._runCursorProbe = function (repoRootHint) {
  try {
    $.global.WORD_IMPORT_CEP._ensureCursorDaemon(repoRootHint);
    var p = $.global.WORD_IMPORT_CEP._getCursorProbeStatePath();
    if (!p) return null;
    var f = new File(p);
    if (!f.exists) return null;
    f.encoding = "UTF-8";
    if (!f.open("r")) return null;
    var raw = "";
    try { raw = f.read(); } finally { f.close(); }
    if (!raw) return null;
    if (raw.length && raw.charCodeAt(0) === 0xFEFF) raw = raw.substring(1);
    var obj = null;
    try {
      if (typeof JSON !== "undefined" && JSON && JSON.parse) obj = JSON.parse(raw);
      else obj = eval("(" + raw + ")");
    } catch (_) {
      obj = null;
    }
    if (!obj) return null;
    var ts = Number(obj.ts);
    if (!isNaN(ts)) {
      var now = new Date().getTime();
      if (Math.abs(now - ts) > 2500) return null;
    }
    return {
      cursorX: $.global.WORD_IMPORT_CEP._parseProbeNumber(obj.cursorX),
      cursorY: $.global.WORD_IMPORT_CEP._parseProbeNumber(obj.cursorY),
      winL: $.global.WORD_IMPORT_CEP._parseProbeNumber(obj.winL),
      winT: $.global.WORD_IMPORT_CEP._parseProbeNumber(obj.winT),
      winR: $.global.WORD_IMPORT_CEP._parseProbeNumber(obj.winR),
      winB: $.global.WORD_IMPORT_CEP._parseProbeNumber(obj.winB),
      clientL: $.global.WORD_IMPORT_CEP._parseProbeNumber(obj.clientL),
      clientT: $.global.WORD_IMPORT_CEP._parseProbeNumber(obj.clientT),
      clientR: $.global.WORD_IMPORT_CEP._parseProbeNumber(obj.clientR),
      clientB: $.global.WORD_IMPORT_CEP._parseProbeNumber(obj.clientB)
    };
  } catch (_) {
    return null;
  }
};

$.global.WORD_IMPORT_CEP._runCursorProbeOnce = function (repoRootHint) {
  try {
    var repoRoot = $.global.WORD_IMPORT_CEP._resolveRepoRootWithHint(repoRootHint);
    if (!repoRoot) return null;
    var script = new File(repoRoot.fsName + "/cursor_probe.ps1");
    if (!script.exists) return null;
    var cmd = "powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File " +
      $.global.WORD_IMPORT_CEP._quoteForCmd(script.fsName);
    var output = String(app.system(cmd) || "");
    var line = output.replace(/\r/g, "\n").split("\n")[0];
    if (!line || line.indexOf("OK|") !== 0) return null;
    var parts = line.split("|");
    if (!parts || parts.length < 15) return null;
    return {
      cursorX: $.global.WORD_IMPORT_CEP._parseProbeNumber(parts[1]),
      cursorY: $.global.WORD_IMPORT_CEP._parseProbeNumber(parts[2]),
      winL: $.global.WORD_IMPORT_CEP._parseProbeNumber(parts[3]),
      winT: $.global.WORD_IMPORT_CEP._parseProbeNumber(parts[4]),
      winR: $.global.WORD_IMPORT_CEP._parseProbeNumber(parts[5]),
      winB: $.global.WORD_IMPORT_CEP._parseProbeNumber(parts[6]),
      clientL: $.global.WORD_IMPORT_CEP._parseProbeNumber(parts[7]),
      clientT: $.global.WORD_IMPORT_CEP._parseProbeNumber(parts[8]),
      clientR: $.global.WORD_IMPORT_CEP._parseProbeNumber(parts[9]),
      clientB: $.global.WORD_IMPORT_CEP._parseProbeNumber(parts[10])
    };
  } catch (_) {
    return null;
  }
};

$.global.WORD_IMPORT_CEP._shouldUseCursorProbe = function (payload) {
  try {
    if (payload && payload.useCursorProbe === false) return false;
    return true;
  } catch (_) {
    return true;
  }
};

$.global.WORD_IMPORT_CEP._getDocViewInfoByAM = function (doc) {
  try {
    if (!doc) return null;
    var s2t = stringIDToTypeID;

    // viewInfo.activeView.globalBounds (document-space visible rect)
    var r = new ActionReference();
    r.putProperty(s2t("property"), s2t("viewInfo"));
    r.putEnumerated(s2t("document"), s2t("ordinal"), s2t("targetEnum"));
    var d = executeActionGet(r);
    if (!d || !d.hasKey(s2t("viewInfo"))) return null;
    var vi = d.getObjectValue(s2t("viewInfo"));
    if (!vi || !vi.hasKey(s2t("activeView"))) return null;
    var av = vi.getObjectValue(s2t("activeView"));
    if (!av || !av.hasKey(s2t("globalBounds"))) return null;
    var gb = av.getObjectValue(s2t("globalBounds"));

    function getNum(desc, key) {
      try {
        if (!desc || !desc.hasKey(key)) return NaN;
        var t = desc.getType(key);
        if (t === DescValueType.DOUBLETYPE) return Number(desc.getDouble(key));
        if (t === DescValueType.UNITDOUBLE) return Number(desc.getUnitDoubleValue(key));
        return NaN;
      } catch (_) {
        return NaN;
      }
    }

    var left = getNum(gb, s2t("left"));
    var top = getNum(gb, s2t("top"));
    var right = getNum(gb, s2t("right"));
    var bottom = getNum(gb, s2t("bottom"));
    if (!isFinite(left) || !isFinite(top) || !isFinite(right) || !isFinite(bottom)) return null;

    function getBoundsIfAny(desc, keyName) {
      try {
        var key = s2t(keyName);
        if (!desc || !desc.hasKey(key)) return null;
        var obj = desc.getObjectValue(key);
        if (!obj) return null;
        var l = getNum(obj, s2t("left"));
        var t = getNum(obj, s2t("top"));
        var r = getNum(obj, s2t("right"));
        var b = getNum(obj, s2t("bottom"));
        if (!isFinite(l) || !isFinite(t) || !isFinite(r) || !isFinite(b)) return null;
        return { left: l, top: t, right: r, bottom: b, key: keyName };
      } catch (_) {
        return null;
      }
    }

    // Try to read activeView's screen/canvas bounds (names vary between builds).
    var screenBounds = null;
    var candidates = ["screenBounds", "frameBounds", "bounds", "canvasBounds", "globalBoundsInScreen", "windowBounds"];
    for (var ci = 0; ci < candidates.length; ci++) {
      screenBounds = getBoundsIfAny(av, candidates[ci]);
      if (screenBounds) break;
    }

    // zoom (percent) – some PS builds expose it on document descriptor
    var zoomPct = NaN;
    try {
      var rz = new ActionReference();
      rz.putProperty(s2t("property"), s2t("zoom"));
      rz.putEnumerated(s2t("document"), s2t("ordinal"), s2t("targetEnum"));
      var dz = executeActionGet(rz);
      if (dz && dz.hasKey(s2t("zoom"))) zoomPct = Number(dz.getDouble(s2t("zoom"))) * 100;
    } catch (_) {}

    // center (document-space) – some PS builds expose it on document descriptor
    var centerX = (left + right) / 2;
    var centerY = (top + bottom) / 2;
    try {
      var rc = new ActionReference();
      rc.putProperty(s2t("property"), s2t("center"));
      rc.putEnumerated(s2t("document"), s2t("ordinal"), s2t("targetEnum"));
      var dc = executeActionGet(rc);
      if (dc && dc.hasKey(s2t("center"))) {
        var c = dc.getObjectValue(s2t("center"));
        var hx = getNum(c, s2t("horizontal"));
        var hy = getNum(c, s2t("vertical"));
        if (isFinite(hx) && isFinite(hy)) {
          centerX = hx;
          centerY = hy;
        }
      }
    } catch (_) {}

    return {
      globalBounds: { left: left, top: top, right: right, bottom: bottom },
      screenBounds: screenBounds,
      centerX: centerX,
      centerY: centerY,
      zoomPct: zoomPct
    };
  } catch (_) {
    return null;
  }
};

$.global.WORD_IMPORT_CEP._screenToDocPoint = function (doc, probe) {
  function fallbackByClientRatio(doc0, probe0) {
    try {
      if (!doc0 || !probe0) return null;
      var cl = Number(probe0.clientL), ct = Number(probe0.clientT), cr = Number(probe0.clientR), cb = Number(probe0.clientB);
      var cx = Number(probe0.cursorX), cy = Number(probe0.cursorY);
      if (!isFinite(cl) || !isFinite(ct) || !isFinite(cr) || !isFinite(cb) || !isFinite(cx) || !isFinite(cy)) return null;
      if (cr <= cl || cb <= ct) return null;
      var fx = (cx - cl) / (cr - cl);
      var fy = (cy - ct) / (cb - ct);
      if (!isFinite(fx) || !isFinite(fy)) return null;
      if (fx < 0) fx = 0; if (fx > 1) fx = 1;
      if (fy < 0) fy = 0; if (fy > 1) fy = 1;
      var dw = Number(doc0.width && doc0.width.as ? doc0.width.as("px") : doc0.width);
      var dh = Number(doc0.height && doc0.height.as ? doc0.height.as("px") : doc0.height);
      if (!isFinite(dw) || !isFinite(dh) || dw <= 0 || dh <= 0) return null;
      return { x: fx * dw, y: fy * dh };
    } catch (_) {
      return null;
    }
  }

  try {
    $.global.WORD_IMPORT_CEP._SCREEN_TO_DOC_LAST_FAIL = "";
    if (!doc || !probe) {
      $.global.WORD_IMPORT_CEP._SCREEN_TO_DOC_LAST_FAIL = "no_doc_or_probe";
      return null;
    }
    if (probe.cursorX == null || probe.cursorY == null) {
      $.global.WORD_IMPORT_CEP._SCREEN_TO_DOC_LAST_FAIL = "no_cursor";
      return null;
    }

    // Prefer Action Manager viewInfo since doc.activeView is often null in CEP/ExtendScript.
    var am = $.global.WORD_IMPORT_CEP._getDocViewInfoByAM(doc);
    if (!am || !am.globalBounds) {
      var p0 = fallbackByClientRatio(doc, probe);
      if (p0) {
        $.global.WORD_IMPORT_CEP._SCREEN_TO_DOC_LAST_FAIL = "fallback_client_ratio_no_am_view";
        return p0;
      }
      $.global.WORD_IMPORT_CEP._SCREEN_TO_DOC_LAST_FAIL = "no_am_view";
      return null;
    }
    var gb = am.globalBounds;
    var centerX = Number(am.centerX);
    var centerY = Number(am.centerY);
    var zoomPct = Number(am.zoomPct);
    var zoom = isFinite(zoomPct) && zoomPct > 0 ? (zoomPct / 100.0) : NaN;
    if (!isFinite(zoom) || zoom <= 0) {
      // As a last resort, derive zoom from globalBounds vs viewport size.
      var vw = Number(probe.clientR) - Number(probe.clientL);
      var vh = Number(probe.clientB) - Number(probe.clientT);
      var gw = Number(gb.right) - Number(gb.left);
      var gh = Number(gb.bottom) - Number(gb.top);
      if (isFinite(vw) && isFinite(vh) && vw > 0 && vh > 0 && isFinite(gw) && isFinite(gh) && gw > 0 && gh > 0) {
        zoom = Math.min(vw / gw, vh / gh);
      }
    }
    if (!isFinite(zoom) || zoom <= 0) {
      $.global.WORD_IMPORT_CEP._SCREEN_TO_DOC_LAST_FAIL = "bad_am_zoom";
      return null;
    }
    if (!isFinite(centerX) || !isFinite(centerY)) {
      centerX = (Number(gb.left) + Number(gb.right)) / 2.0;
      centerY = (Number(gb.top) + Number(gb.bottom)) / 2.0;
    }
    if (!isFinite(centerX) || !isFinite(centerY)) {
      $.global.WORD_IMPORT_CEP._SCREEN_TO_DOC_LAST_FAIL = "bad_am_center";
      return null;
    }

    var viewportL = probe.clientL;
    var viewportT = probe.clientT;
    var viewportR = probe.clientR;
    var viewportB = probe.clientB;
    var usingScreenBounds = false;
    if (am.screenBounds) {
      viewportL = am.screenBounds.left;
      viewportT = am.screenBounds.top;
      viewportR = am.screenBounds.right;
      viewportB = am.screenBounds.bottom;
      usingScreenBounds = true;
    }
    if (viewportL == null || viewportT == null || viewportR == null || viewportB == null || viewportR <= viewportL || viewportB <= viewportT) {
      $.global.WORD_IMPORT_CEP._SCREEN_TO_DOC_LAST_FAIL = "bad_viewport";
      return null;
    }

    var viewportCX = (viewportL + viewportR) / 2.0;
    var viewportCY = (viewportT + viewportB) / 2.0;
    var dxScreen = probe.cursorX - viewportCX;
    var dyScreen = probe.cursorY - viewportCY;
    var docX = centerX + (dxScreen / zoom);
    var docY = centerY + (dyScreen / zoom);
    if (!isFinite(docX) || !isFinite(docY)) {
      $.global.WORD_IMPORT_CEP._SCREEN_TO_DOC_LAST_FAIL = "bad_doc_xy";
      return null;
    }
    $.global.WORD_IMPORT_CEP._SCREEN_TO_DOC_LAST_FAIL = usingScreenBounds ? "ok_am_screenBounds" : "ok_am_clientBounds";
    return { x: docX, y: docY };
  } catch (_) {
    $.global.WORD_IMPORT_CEP._SCREEN_TO_DOC_LAST_FAIL = "exception";
    return null;
  }
};

$.global.WORD_IMPORT_CEP._getCalibrationFile = function (repoRootHint) {
  try {
    var udr = $.global.WORD_IMPORT_CEP.getUserDataRoot();
    if (udr) {
      var pref = new File(udr.fsName + "/cursor_calibration.json");
      if (pref.exists) return pref;
      // First-run migration: copy from legacy repoRoot if available.
      try {
        var repoRoot = $.global.WORD_IMPORT_CEP._resolveRepoRootWithHint(repoRootHint);
        if (repoRoot) {
          var legacy = new File(repoRoot.fsName + "/cursor_calibration.json");
          if (legacy.exists && legacy.fsName !== pref.fsName) {
            try {
              legacy.encoding = "UTF-8";
              if (legacy.open("r")) {
                var raw = "";
                try { raw = legacy.read(); } finally { legacy.close(); }
                if (raw) {
                  pref.encoding = "UTF-8";
                  if (pref.open("w")) {
                    try { pref.write(raw); } finally { pref.close(); }
                  }
                }
              }
            } catch (__) {}
          }
        }
      } catch (__) {}
      return pref;
    }
    var repoRoot2 = $.global.WORD_IMPORT_CEP._resolveRepoRootWithHint(repoRootHint);
    if (!repoRoot2) return null;
    return new File(repoRoot2.fsName + "/cursor_calibration.json");
  } catch (_) {
    return null;
  }
};

$.global.WORD_IMPORT_CEP._loadCalibration = function (repoRootHint) {
  try {
    var f = $.global.WORD_IMPORT_CEP._getCalibrationFile(repoRootHint);
    if (!f || !f.exists) return null;
    f.encoding = "UTF-8";
    if (!f.open("r")) return null;
    var raw = "";
    try { raw = f.read(); } finally { f.close(); }
    if (!raw) return null;
    var obj = null;
    try {
      if (typeof JSON !== "undefined" && JSON && JSON.parse) obj = JSON.parse(raw);
      else obj = eval("(" + raw + ")");
    } catch (_) { obj = null; }
    if (!obj) return null;
    var sx = Number(obj.scaleX), sy = Number(obj.scaleY), ox = Number(obj.offsetX), oy = Number(obj.offsetY);
    if (!isFinite(sx) || !isFinite(sy) || !isFinite(ox) || !isFinite(oy)) return null;
    return { scaleX: sx, scaleY: sy, offsetX: ox, offsetY: oy };
  } catch (_) {
    return null;
  }
};

$.global.WORD_IMPORT_CEP._saveCalibration = function (repoRootHint, calib) {
  var f = $.global.WORD_IMPORT_CEP._getCalibrationFile(repoRootHint);
  if (!f || !calib) return false;
  try {
    f.encoding = "UTF-8";
    if (!f.open("w")) return false;
    var obj = {
      scaleX: calib.scaleX, scaleY: calib.scaleY, offsetX: calib.offsetX, offsetY: calib.offsetY
    };
    var s = (typeof JSON !== "undefined" && JSON && JSON.stringify) ? JSON.stringify(obj) : $.global.WORD_IMPORT_CEP._toJSON(obj);
    try { f.write(s); } finally { f.close(); }
    return true;
  } catch (_) {
    try { f.close(); } catch (_) {}
    return false;
  }
};

$.global.WORD_IMPORT_CEP._applyCalibration = function (pt, calib) {
  if (!pt || !calib) return pt;
  return {
    x: pt.x * calib.scaleX + calib.offsetX,
    y: pt.y * calib.scaleY + calib.offsetY
  };
};

$.global.WORD_IMPORT_CEP._resolveRepoRootWithHint = function (repoRootHint) {
  if (repoRootHint) {
    var hinted = $.global.WORD_IMPORT_CEP._sanitizePathText(repoRootHint);
    if (hinted) {
      var hintedFolder = new Folder(hinted);
      if (hintedFolder.exists) return hintedFolder;
    }
  }
  return $.global.WORD_IMPORT_CEP.getRepoRoot();
};

$.global.WORD_IMPORT_CEP._loadCoreApi = function (repoRootHint) {
  var repoRoot = $.global.WORD_IMPORT_CEP._resolveRepoRootWithHint(repoRootHint);
  if (!repoRoot) throw new Error("扩展运行时缺失，请重新运行 install_cep.ps1 后重启 Photoshop");
  var coreFile = new File(repoRoot.fsName + "/import_to_photoshop.jsx");
  if (!coreFile.exists) throw new Error("找不到导入核心: " + coreFile.fsName);
  // 避免二次会话中残留不完整 API（部分 PS/CEP 组合下 eval 未覆盖全局）
  try {
    $.global.WORD_IMPORT_API = null;
  } catch (_) {}
  $.global.WORD_IMPORT_PANEL_MODE = true;
  try {
    $.evalFile(coreFile);
  } catch (e) {
    var detail = [];
    detail.push(String(e && e.message ? e.message : e));
    detail.push("core=" + coreFile.fsName);
    try {
      if (e && e.line != null && e.line !== "") detail.push("line=" + String(e.line));
    } catch (_) {}
    try {
      if (e && e.source) detail.push("source=" + String(e.source).slice(0, 240));
    } catch (_) {}
    detail.push("若已从仓库更新扩展，请重新运行 install_cep.ps1 并重启 Photoshop");
    throw new Error(detail.join(" | "));
  }
  if (!$.global.WORD_IMPORT_API) throw new Error("导入核心 API 加载失败 | core=" + coreFile.fsName);
  return $.global.WORD_IMPORT_API;
};

$.global.WORD_IMPORT_CEP.captureCalibrationPoint = function (repoRootHint) {
  try {
    if (app.name !== "Adobe Photoshop") return "ERR|请在 Photoshop 中运行";
    if (app.documents.length <= 0) return "ERR|请先打开 PSD 文档";
    var doc = app.activeDocument;
    var b = doc.selection.bounds;
    if (!b || b.length < 4) return "ERR|请先在画布框选一个基准点（小选区）";
    var actual = {
      x: (Number(b[0].as("px")) + Number(b[2].as("px"))) / 2,
      y: (Number(b[1].as("px")) + Number(b[3].as("px"))) / 2
    };
    var probe = $.global.WORD_IMPORT_CEP._runCursorProbe(repoRootHint);
    if (!probe) probe = $.global.WORD_IMPORT_CEP._runCursorProbeOnce(repoRootHint);
    var raw = $.global.WORD_IMPORT_CEP._screenToDocPoint(doc, probe);
    if (!raw) {
      // Fallback: still allow calibration flow to proceed by using selection center.
      // This yields an identity-like mapping and avoids blocking users on probe issues.
      raw = { x: actual.x, y: actual.y };
    }

    var list = $.global.WORD_IMPORT_CURSOR_CALIB_POINTS || [];
    if (list.length >= 2) list = [];
    list.push({ rawX: raw.x, rawY: raw.y, actX: actual.x, actY: actual.y });
    $.global.WORD_IMPORT_CURSOR_CALIB_POINTS = list;
    return "OK|" + $.global.WORD_IMPORT_CEP._encodeJSON({ step: list.length });
  } catch (e) {
    return "ERR|" + e.message + " (line: " + (e.line || "?") + ")";
  }
};

$.global.WORD_IMPORT_CEP.finishCalibration = function (repoRootHint) {
  try {
    var list = $.global.WORD_IMPORT_CURSOR_CALIB_POINTS || [];
    if (!list || list.length < 2) return "ERR|请先记录两个基准点";
    var p1 = list[0], p2 = list[1];
    var dxRaw = p2.rawX - p1.rawX, dyRaw = p2.rawY - p1.rawY;
    var sx = Math.abs(dxRaw) > 1e-6 ? ((p2.actX - p1.actX) / dxRaw) : 1.0;
    var sy = Math.abs(dyRaw) > 1e-6 ? ((p2.actY - p1.actY) / dyRaw) : 1.0;
    var ox = p1.actX - sx * p1.rawX;
    var oy = p1.actY - sy * p1.rawY;
    var calib = { scaleX: sx, scaleY: sy, offsetX: ox, offsetY: oy };
    $.global.WORD_IMPORT_CEP._saveCalibration(repoRootHint, calib);
    $.global.WORD_IMPORT_CURSOR_CALIB_POINTS = [];
    return "OK|" + $.global.WORD_IMPORT_CEP._encodeJSON(calib);
  } catch (e) {
    return "ERR|" + e.message + " (line: " + (e.line || "?") + ")";
  }
};

$.global.WORD_IMPORT_CEP.clearCalibration = function (repoRootHint) {
  try {
    $.global.WORD_IMPORT_CURSOR_CALIB_POINTS = [];
    var f = $.global.WORD_IMPORT_CEP._getCalibrationFile(repoRootHint);
    if (f && f.exists) try { f.remove(); } catch (_) {}
    return "OK|" + $.global.WORD_IMPORT_CEP._encodeJSON({ cleared: true });
  } catch (e) {
    return "ERR|" + e.message + " (line: " + (e.line || "?") + ")";
  }
};

$.global.WORD_IMPORT_CEP.exportDocxToJsxdata = function (docxPath, outPath, repoRootHint) {
  var runner = null;
  try {
    var repoRoot = $.global.WORD_IMPORT_CEP._resolveRepoRootWithHint(repoRootHint);
    if (!repoRoot) return "ERR|扩展运行时缺失，请重新运行 install_cep.ps1 后重启 Photoshop";

    var scriptFile = new File(repoRoot.fsName + "/export_docx_styles.ps1");
    if (!scriptFile.exists) return "ERR|找不到导出脚本: " + scriptFile.fsName;

    var input = $.global.WORD_IMPORT_CEP._sanitizePathText(docxPath);
    if (!input) {
      var picked = File.openDialog("选择 Word 文件", "*.docx;*.doc");
      if (!picked) return "ERR|已取消 Word 文件选择";
      input = picked.fsName;
    }
    var docxFile = new File(input);
    if (!docxFile.exists) return "ERR|Word 文件不存在: " + input;

    var outputPath = $.global.WORD_IMPORT_CEP._sanitizePathText(outPath);
    if (!outputPath) {
      var base = $.global.WORD_IMPORT_CEP._jsxdataBaseNameFromDocxFile(docxFile);
      outputPath = docxFile.parent.fsName + "/" + base + ".jsxdata";
    }

    // UTF-8 BOM + PowerShell stub avoids cmd.exe codepage mangling paths with non-ASCII (CEP 含图 docx 与中文路径).
    var tempDir = Folder.temp;
    var runId = String(new Date().getTime());
    runner = new File(tempDir.fsName + "/word_import_export_jsxdata_" + runId + ".ps1");
    var capFile = new File(tempDir.fsName + "/word_import_export_cap_" + runId + ".txt");
    var sq = function (p) {
      return $.global.WORD_IMPORT_CEP._quoteForPs1Sq(p);
    };
    // -OutFile 用变量传递，避免路径中含 # 等字符时在参数字面量中被误解析；stdout/stderr 写入 cap 文件便于诊断 app.system 仅返回退出码的机器。
    var body =
      "$ErrorActionPreference='Stop'\r\n" +
      "$cap='" +
      sq(capFile.fsName) +
      "'\r\n" +
      "$outExpect='" +
      sq(outputPath) +
      "'\r\n" +
      "Remove-Item -LiteralPath $cap -ErrorAction SilentlyContinue\r\n" +
      "try {\r\n" +
      "  & '" +
      sq(scriptFile.fsName) +
      "' -DocxPath '" +
      sq(docxFile.fsName) +
      "' -OutFile $outExpect -Minify 2>&1 | ForEach-Object { Add-Content -LiteralPath $cap -Value $_ -Encoding UTF8 }\r\n" +
      "  if (-not (Test-Path -LiteralPath $outExpect)) { throw 'Export finished but output file is missing.' }\r\n" +
      "  exit 0\r\n" +
      "} catch {\r\n" +
      "  $_ | Out-String | Add-Content -LiteralPath $cap -Encoding UTF8\r\n" +
      "  exit 1\r\n" +
      "}\r\n";
    runner.encoding = "UTF-8";
    if (!runner.open("w")) return "ERR|无法写入临时导出脚本: " + runner.fsName;
    try {
      runner.write("\uFEFF" + body);
    } finally {
      runner.close();
    }

    var cmd =
      "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File " +
      $.global.WORD_IMPORT_CEP._quoteForCmd(runner.fsName);
    var output = "";
    try {
      output = String(app.system(cmd) || "");
    } catch (eSys) {
      try {
        if (runner && runner.exists) runner.remove();
      } catch (_) {}
      return "ERR|E_SHELL " + eSys.message;
    }

    try {
      if (runner && runner.exists) runner.remove();
    } catch (_) {}

    var capText = "";
    try {
      if (capFile.exists) {
        capFile.encoding = "UTF8";
        if (capFile.open("r")) {
          try {
            capText = capFile.read();
          } finally {
            capFile.close();
          }
        }
      }
    } catch (_) {}

    var outFile = new File(outputPath);

    // #region agent log
    try {
      var dbgLine = JSON.stringify({
        sessionId: "34d76a",
        hypothesisId: "H_export_capture",
        location: "exportDocxToJsxdata",
        message: "export shell done",
        data: {
          systemReturn: String(output || ""),
          outPathTail: outputPath.length > 120 ? outputPath.substring(outputPath.length - 120) : outputPath,
          capLen: capText ? capText.length : 0,
          outExists: !!outFile.exists
        },
        timestamp: new Date().getTime()
      });
      var adLog = $.getenv("APPDATA");
      if (adLog) {
        var dl = new File(adLog + "/com.word_to_photoshop/debug-34d76a.log");
        dl.encoding = "UTF8";
        if (dl.open("a")) {
          try {
            dl.writeln(dbgLine);
          } finally {
            dl.close();
          }
        }
      }
      var hl = new File(File($.fileName).parent.fsName + "/debug-34d76a.log");
      hl.encoding = "UTF8";
      if (hl.open("a")) {
        try {
          hl.writeln(dbgLine);
        } finally {
          hl.close();
        }
      }
    } catch (_) {}
    // #endregion

    if (!outFile.exists) {
      try {
        if (capFile.exists) capFile.remove();
      } catch (_) {}
      var capTrim =
        capText && capText.length > 4000 ? capText.substring(0, 4000) + "\n...(truncated)" : capText;
      var capPart = capTrim
        ? String(capTrim).replace(/\r\n/g, "\n").replace(/\n/g, " | ")
        : "";
      var exportTag = "";
      try {
        var capTagM = capText && String(capText).match(/\[E_[A-Z0-9_]+\]/);
        if (capTagM) exportTag = String(capTagM[0]).replace(/^\[|\]$/g, "") + " ";
      } catch (_) {}
      return (
        "ERR|" +
        exportTag +
        "导出失败，未生成文件。返回码/控制台: " +
        String(output || "").replace(/^\s+|\s+$/g, "") +
        (capPart ? " | 捕获: " + capPart : "")
      );
    }

    try {
      if (capFile.exists) capFile.remove();
    } catch (_) {}

    return "OK|" +
      $.global.WORD_IMPORT_CEP._encodeJSON({
        outFile: outFile.fsName,
        shellOutput: output
      });
  } catch (e) {
    try {
      if (runner && runner.exists) runner.remove();
    } catch (_) {}
    return "ERR|E_HOST " + e.message + " (line: " + (e.line || "?") + ")";
  }
};

$.global.WORD_IMPORT_CEP._getBubbleBoxesTargetFile = function (repoRootHint) {
  try {
    var api = $.global.WORD_IMPORT_CEP._loadCoreApi(repoRootHint);
    var ctx = api && api.buildDefaultContext ? api.buildDefaultContext() : null;
    var cfg = (ctx && ctx.cfg) ? ctx.cfg : {};
    if (ctx && ctx.autoDataFile && ctx.autoDataFile.exists) {
      var perDataFile = cfg && cfg.bubblePrecomputedPerDataFile !== false;
      var baseName = String(ctx.autoDataFile.name || "").replace(/\.[^\.]+$/, "");
      var fileName = perDataFile ? (baseName + ".bubbles.json") : String(cfg.bubblePrecomputedFileName || "bubble_boxes.json");
      return new File(ctx.autoDataFile.parent.fsName + "/" + fileName);
    }
    if (ctx && ctx.doc && ctx.doc.fullName && ctx.doc.fullName.parent) {
      return new File(ctx.doc.fullName.parent.fsName + "/" + String(cfg.bubblePrecomputedFileName || "bubble_boxes.json"));
    }
    return null;
  } catch (_) {
    return null;
  }
};

$.global.WORD_IMPORT_CEP.getBubbleBoxesStatus = function (repoRootHint) {
  try {
    var target = $.global.WORD_IMPORT_CEP._getBubbleBoxesTargetFile(repoRootHint);
    var out = {
      targetPath: target ? String(target.fsName) : "",
      exists: !!(target && target.exists)
    };
    return "OK|" + $.global.WORD_IMPORT_CEP._encodeJSON(out);
  } catch (e) {
    return "ERR|" + e.message + " (line: " + (e.line || "?") + ")";
  }
};

$.global.WORD_IMPORT_CEP.bindBubbleBoxesFile = function (repoRootHint) {
  try {
    var source = File.openDialog("选择预识别框文件（bubble_boxes.json）", "*.json");
    if (!source) return "ERR|已取消选择";
    if (!source.exists) return "ERR|文件不存在: " + source.fsName;
    var target = $.global.WORD_IMPORT_CEP._getBubbleBoxesTargetFile(repoRootHint);
    if (!target) return "ERR|无法确定 bubble_boxes.json 放置目录（请先绑定 .jsxdata 或打开 PSD）";

    source.encoding = "UTF-8";
    if (!source.open("r")) return "ERR|无法读取文件: " + source.fsName;
    var raw = "";
    try { raw = source.read(); } finally { source.close(); }
    if (!raw) return "ERR|文件内容为空";
    target.encoding = "UTF-8";
    if (!target.open("w")) return "ERR|无法写入目标文件: " + target.fsName;
    try { target.write(raw); } finally { target.close(); }
    return "OK|" + $.global.WORD_IMPORT_CEP._encodeJSON({
      sourcePath: String(source.fsName),
      targetPath: String(target.fsName),
      copied: true
    });
  } catch (e) {
    return "ERR|" + e.message + " (line: " + (e.line || "?") + ")";
  }
};

$.global.WORD_IMPORT_CEP.generateBubbleBoxesFile = function (repoRootHint) {
  try {
    var repoRoot = $.global.WORD_IMPORT_CEP._resolveRepoRootWithHint(repoRootHint);
    if (!repoRoot) return "ERR|扩展运行时缺失，请重新运行 install_cep.ps1 后重启 Photoshop";
    var scriptFile = new File(repoRoot.fsName + "/tools/extract_bubbles.py");
    if (!scriptFile.exists) return "ERR|找不到脚本: " + scriptFile.fsName;

    var maskFolder = Folder.selectDialog("选择 mask 图片目录（白色区域为对白框）");
    if (!maskFolder) return "ERR|已取消选择";
    if (!maskFolder.exists) return "ERR|目录不存在: " + maskFolder.fsName;

    var target = $.global.WORD_IMPORT_CEP._getBubbleBoxesTargetFile(repoRootHint);
    if (!target) return "ERR|无法确定输出路径（请先绑定 .jsxdata 或打开 PSD）";
    var tempDir = Folder.temp;
    var runId = String(new Date().getTime());
    var maskOutput = new File(tempDir.fsName + "/word_import_bubble_boxes_" + runId + ".json");
    var forcePage = "";
    try {
      var api = $.global.WORD_IMPORT_CEP._loadCoreApi(repoRootHint);
      var ctx = api && api.buildDefaultContext ? api.buildDefaultContext() : null;
      if (ctx && ctx.defaultPage) forcePage = String(ctx.defaultPage);
    } catch (_) {}

    var scriptArgs =
      $.global.WORD_IMPORT_CEP._quoteForCmd(scriptFile.fsName) +
      " --mask-dir " + $.global.WORD_IMPORT_CEP._quoteForCmd(maskFolder.fsName) +
      " --output " + $.global.WORD_IMPORT_CEP._quoteForCmd(maskOutput.fsName) +
      (forcePage ? (" --force-page " + $.global.WORD_IMPORT_CEP._quoteForCmd(forcePage)) : "");
    var logFile = new File(maskFolder.fsName + "/bubble_boxes_extract.log");
    var launchers = ["py", "python", "python3"];
    var output = "";
    var usedLauncher = "";
    for (var i = 0; i < launchers.length; i++) {
      var launcher = launchers[i];
      var runner = new File(tempDir.fsName + "/word_import_extract_bubbles_" + launcher + ".cmd");
      runner.encoding = "UTF-8";
      if (!runner.open("w")) {
        output += "[" + launcher + "] open_runner_failed ";
        continue;
      }
      try {
        runner.write("@echo off\r\n");
        runner.write(launcher + " " + scriptArgs +
          " > " + $.global.WORD_IMPORT_CEP._quoteForCmd(logFile.fsName) + " 2>&1\r\n");
        runner.write("exit /b %errorlevel%\r\n");
      } finally {
        runner.close();
      }
      var cmd = "cmd /d /c " + $.global.WORD_IMPORT_CEP._quoteForCmd(runner.fsName);
      var one = app.system(cmd);
      output += "[" + launcher + "] " + String(one || "") + " ";
      if (maskOutput.exists) {
        usedLauncher = launcher;
        break;
      }
    }
    var logText = "";
    var generatedMeta = null;
    try {
      if (logFile.exists) {
        logFile.encoding = "UTF-8";
        if (logFile.open("r")) {
          try { logText = String(logFile.read() || ""); } finally { logFile.close(); }
        }
      }
    } catch (_) {}
    var briefLog = logText ? logText.replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "") : "";
    if (briefLog.length > 260) briefLog = briefLog.slice(0, 260) + "...";
    if (!maskOutput.exists) {
      return "ERR|生成失败，未输出文件。返回: " + String(output || "") +
        (briefLog ? ("；日志: " + briefLog) : "") +
        "；完整日志: " + String(logFile.fsName);
    }
    try {
      var generated = new File(maskOutput.fsName);
      generated.encoding = "UTF-8";
      if (generated.open("r")) {
        var rawJson = "";
        try { rawJson = generated.read(); } finally { generated.close(); }
        if (rawJson) {
          if (typeof JSON !== "undefined" && JSON && JSON.parse) generatedMeta = JSON.parse(rawJson);
          else generatedMeta = eval("(" + rawJson + ")");
        }
      }
    } catch (_) {}
    try {
      maskOutput.copy(target.fsName);
    } catch (_) {
      var source = new File(maskOutput.fsName);
      source.encoding = "UTF-8";
      if (!source.open("r")) return "ERR|无法读取已生成文件: " + maskOutput.fsName;
      var raw = "";
      try { raw = source.read(); } finally { source.close(); }
      target.encoding = "UTF-8";
      if (!target.open("w")) return "ERR|无法写入目标文件: " + target.fsName;
      try { target.write(raw); } finally { target.close(); }
    }
    try {
      if (maskOutput.exists) maskOutput.remove();
    } catch (_) {}
    return "OK|" + $.global.WORD_IMPORT_CEP._encodeJSON({
      maskDir: String(maskFolder.fsName),
      maskOutputPath: "",
      targetPath: String(target.fsName),
      forcedPage: forcePage,
      launcher: usedLauncher,
      shellOutput: String(output || ""),
      shellLogPath: String(logFile.fsName),
      visualizationDir: generatedMeta && generatedMeta.visualizationDir ? String(generatedMeta.visualizationDir) : "",
      generatedFiles: generatedMeta && generatedMeta.files ? generatedMeta.files : []
    });
  } catch (e) {
    return "ERR|" + e.message + " (line: " + (e.line || "?") + ")";
  }
};

/**
 * 内置合成粗体：调用 tools/generate_synthetic_bold_font.py（仅依赖 pip fonttools），生成真实 .ttf 文件。
 */
$.global.WORD_IMPORT_CEP.generateSyntheticBoldTtf = function (repoRootHint) {
  try {
    var repoRoot = $.global.WORD_IMPORT_CEP._resolveRepoRootWithHint(repoRootHint);
    if (!repoRoot) return "ERR|扩展运行时缺失，请重新运行 install_cep.ps1 后重启 Photoshop";
    var scriptFile = new File(repoRoot.fsName + "/tools/generate_synthetic_bold_font.py");
    if (!scriptFile.exists) return "ERR|找不到脚本: " + scriptFile.fsName;

    var src = File.openDialog("选择 Regular 字体（需含 TrueType 轮廓 / glyf）", "*.ttf;*.ttc;*.otf");
    if (!src) return "ERR|已取消";
    if (!src.exists) return "ERR|文件不存在";

    var baseLeaf = String(src.name || "Font");
    var dot = baseLeaf.lastIndexOf(".");
    if (dot >= 0) baseLeaf = baseLeaf.substring(0, dot);
    var parentFs = src.parent ? String(src.parent.fsName) : "";
    if (!parentFs) return "ERR|无法确定源字体所在目录";
    var outFs = parentFs + "/" + baseLeaf + "-SynthBold.ttf";
    var dstTry = new File(outFs);
    if (dstTry.exists) {
      outFs = parentFs + "/" + baseLeaf + "-SynthBold-" + String(new Date().getTime()) + ".ttf";
    }
    var dstFile = new File(outFs);

    var tempDir = Folder.temp;
    var runId = String(new Date().getTime());
    var logFile = new File(tempDir.fsName + "/word_import_synth_bold_" + runId + ".log");

    var scriptArgs =
      $.global.WORD_IMPORT_CEP._quoteForCmd(scriptFile.fsName) +
      " --input " +
      $.global.WORD_IMPORT_CEP._quoteForCmd(src.fsName) +
      " --output " +
      $.global.WORD_IMPORT_CEP._quoteForCmd(dstFile.fsName) +
      " --shift-em 0.028";

    var launchers = [];
    try {
      var ad = $.getenv("APPDATA");
      if (ad) {
        var embPy = new File(ad + "/com.word_to_photoshop/python-embed-3.12/python.exe");
        if (embPy.exists) launchers.push($.global.WORD_IMPORT_CEP._quoteForCmd(embPy.fsName));
      }
    } catch (_) {}
    launchers.push("py -3", "py", "python", "python3");
    var output = "";
    var usedLauncher = "";
    var li;
    for (li = 0; li < launchers.length; li++) {
      var launcher = launchers[li];
      var safeLauncher = String(launcher).replace(/[^a-zA-Z0-9]+/g, "_");
      var runner = new File(tempDir.fsName + "/word_import_synth_bold_" + safeLauncher + "_" + runId + ".cmd");
      runner.encoding = "UTF-8";
      if (!runner.open("w")) {
        output += "[" + launcher + "] open_runner_failed ";
        continue;
      }
      try {
        runner.write($.global.WORD_IMPORT_CEP._synthRunnerCmdPreamble("WTP build SynthBold TTF"));
        runner.write(launcher + " " + scriptArgs + " > " + $.global.WORD_IMPORT_CEP._quoteForCmd(logFile.fsName) + " 2>&1\r\n");
        runner.write("exit /b %errorlevel%\r\n");
      } finally {
        runner.close();
      }
      var cmd = $.global.WORD_IMPORT_CEP._synthRunnerInvokeCmd(runner.fsName);
      var one = app.system(cmd);
      output += "[" + launcher + "] " + String(one || "") + " ";
      try {
        runner.remove();
      } catch (_) {}
      if (dstFile.exists) {
        usedLauncher = launcher;
        break;
      }
    }

    var logText = "";
    try {
      if (logFile.exists) {
        logFile.encoding = "UTF-8";
        if (logFile.open("r")) {
          try {
            logText = String(logFile.read() || "");
          } finally {
            logFile.close();
          }
        }
      }
    } catch (_) {}

    var briefLog = logText ? logText.replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "") : "";
    if (briefLog.length > 320) briefLog = briefLog.slice(0, 320) + "...";

    if (!dstFile.exists) {
      return (
        "ERR|生成失败，未写出文件。需本机 Python（建议 py launcher）且已 pip install fonttools；requirements 在扩展 host\\repo\\tools。返回: " +
        String(output || "") +
        (briefLog ? "；日志: " + briefLog : "") +
        "；完整日志: " +
        String(logFile.fsName)
      );
    }

    return "OK|" +
      $.global.WORD_IMPORT_CEP._encodeJSON({
        inputPath: String(src.fsName),
        outputPath: String(dstFile.fsName),
        launcher: usedLauncher,
        shellOutput: String(output || "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, ""),
        logHint: briefLog,
        logPath: String(logFile.fsName)
      });
  } catch (e) {
    return "ERR|" + e.message + " (line: " + (e.line || "?") + ")";
  }
};

$.global.WORD_IMPORT_CEP.generateBubbleMasks = function (repoRootHint) {
  try {
    var repoRoot = $.global.WORD_IMPORT_CEP._resolveRepoRootWithHint(repoRootHint);
    if (!repoRoot) return "ERR|扩展运行时缺失，请重新运行 install_cep.ps1 后重启 Photoshop";
    var launcherPs1 = new File(repoRoot.fsName + "/tools/launch_mask_gen_visible.ps1");
    if (!launcherPs1.exists) return "ERR|找不到启动脚本: " + launcherPs1.fsName;

    var inputFolder = Folder.selectDialog("选择页面图片目录（将自动生成 mask/ 黑白图）");
    if (!inputFolder) return "ERR|已取消选择";
    if (!inputFolder.exists) return "ERR|目录不存在: " + inputFolder.fsName;
    var outFolder = new Folder(inputFolder.fsName + "/mask");
    try { if (!outFolder.exists) outFolder.create(); } catch (_) {}

    // IMPORTANT: Never run `powershell … -Wait` inside app.system() — long blocking freezes / can crash PS during CEP.
    // Spawn a separate console via `start`; app.system exits as soon as the stub .cmd returns.
    var runId = String(new Date().getTime());
    var stubBat = new File(Folder.temp.fsName + "/word_import_mask_spawn_" + runId + ".cmd");
    stubBat.encoding = "UTF-8";
    if (!stubBat.open("w")) return "ERR|无法写入临时启动脚本: " + stubBat.fsName;
    try {
      stubBat.write("@echo off\r\n");
      stubBat.write("chcp 65001>nul\r\n");
      stubBat.write(
        "start \"Word Import - Mask Generation\" powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Normal -File "
      );
      stubBat.write($.global.WORD_IMPORT_CEP._quoteForBatLine(launcherPs1.fsName));
      stubBat.write(" -InputDir ");
      stubBat.write($.global.WORD_IMPORT_CEP._quoteForBatLine(inputFolder.fsName));
      stubBat.write(" -OutputDir ");
      stubBat.write($.global.WORD_IMPORT_CEP._quoteForBatLine(outFolder.fsName));
      stubBat.write(" -RepoRoot ");
      stubBat.write($.global.WORD_IMPORT_CEP._quoteForBatLine(repoRoot.fsName));
      stubBat.write(" -SaveDebug\r\n");
    } finally {
      stubBat.close();
    }

    var spawnCmd = "cmd.exe /d /c " + $.global.WORD_IMPORT_CEP._quoteForCmd(stubBat.fsName);
    var spawnOut = "";
    try {
      spawnOut = String(app.system(spawnCmd) || "");
    } finally {
      try {
        stubBat.remove();
      } catch (_) {}
    }

    return "OK|" + $.global.WORD_IMPORT_CEP._encodeJSON({
      inputDir: String(inputFolder.fsName),
      maskDir: String(outFolder.fsName),
      vizDir: String(outFolder.fsName + "/_viz"),
      launcher: "powershell-visible-detached",
      shellOutput: spawnOut.replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "") || "Detached window launched; do not close until mask run finishes.",
      shellLogPath: ""
    });
  } catch (e) {
    return "ERR|" + e.message + " (line: " + (e.line || "?") + ")";
  }
};

$.global.WORD_IMPORT_CEP.clearBubbleBoxesFile = function (repoRootHint) {
  try {
    var target = $.global.WORD_IMPORT_CEP._getBubbleBoxesTargetFile(repoRootHint);
    if (!target) return "ERR|无法确定目标路径";
    var existed = !!target.exists;
    if (target.exists) {
      try { target.remove(); } catch (_) {}
    }
    return "OK|" + $.global.WORD_IMPORT_CEP._encodeJSON({
      targetPath: String(target.fsName),
      existed: existed,
      cleared: true
    });
  } catch (e) {
    return "ERR|" + e.message + " (line: " + (e.line || "?") + ")";
  }
};

$.global.WORD_IMPORT_CEP.listQuotes = function (repoRootHint) {
  try {
    if (app.name !== "Adobe Photoshop") return "ERR|请在 Photoshop 中运行";
    var api = $.global.WORD_IMPORT_CEP._loadCoreApi(repoRootHint);
    var ctx = api.buildDefaultContext();
    var payload = ctx && ctx.payload ? ctx.payload : null;
    var result = {
      docName: (ctx && ctx.doc && ctx.doc.name) ? String(ctx.doc.name) : "",
      dataFile: (ctx && ctx.autoDataFile && ctx.autoDataFile.exists) ? String(ctx.autoDataFile.fsName) : "",
      defaultPage: (ctx && ctx.defaultPage) ? String(ctx.defaultPage) : "001",
      pages: []
    };
    if (!payload || !payload.pages || !payload.pages.length) {
      return "OK|" + $.global.WORD_IMPORT_CEP._encodeJSON(result);
    }

    for (var i = 0; i < payload.pages.length; i++) {
      var page = payload.pages[i] || {};
      var outPage = { page: String(page.page || ""), items: [] };
      var paragraphs = page.paragraphs || [];
      for (var p = 0; p < paragraphs.length; p++) {
        var para = paragraphs[p] || {};
        var segs = para.segments || [];
        var full = "";
        for (var s = 0; s < segs.length; s++) {
          var seg = segs[s] || {};
          full += (seg.text != null ? String(seg.text) : "");
        }
        if (!full) continue;
        outPage.items.push({
          paragraph: para.index != null ? para.index : (p + 1),
          text: full,
          segments: segs
        });
      }
      result.pages.push(outPage);
    }
    return "OK|" + $.global.WORD_IMPORT_CEP._encodeJSON(result);
  } catch (e) {
    return "ERR|" + e.message + " (line: " + (e.line || "?") + ")";
  }
};

$.global.WORD_IMPORT_CEP.lockSelectionRect = function () {
  try {
    if (app.name !== "Adobe Photoshop") return "ERR|请在 Photoshop 中运行";
    if (app.documents.length <= 0) return "ERR|请先打开 PSD 文档";
    var doc = app.activeDocument;
    function readSelectionRectByBounds(d) {
      try {
        var b = d.selection.bounds;
        if (!b || b.length < 4) return null;
        var l = Number(b[0].as("px"));
        var t = Number(b[1].as("px"));
        var r = Number(b[2].as("px"));
        var bt = Number(b[3].as("px"));
        if (!isFinite(l) || !isFinite(t) || !isFinite(r) || !isFinite(bt)) return null;
        var left = Math.min(l, r);
        var right = Math.max(l, r);
        var top = Math.min(t, bt);
        var bottom = Math.max(t, bt);
        if ((right - left) <= 0.01 || (bottom - top) <= 0.01) return null;
        return { left: left, top: top, right: right, bottom: bottom };
      } catch (_) {
        return null;
      }
    }

    function readSelectionRectByAM() {
      try {
        var ref = new ActionReference();
        ref.putProperty(charIDToTypeID("Prpr"), stringIDToTypeID("selection"));
        ref.putEnumerated(charIDToTypeID("Dcmn"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
        var desc = executeActionGet(ref);
        if (!desc || !desc.hasKey(stringIDToTypeID("selection"))) return null;
        var selDesc = desc.getObjectValue(stringIDToTypeID("selection"));
        if (!selDesc) return null;
        var l = selDesc.hasKey(charIDToTypeID("Left")) ? selDesc.getUnitDoubleValue(charIDToTypeID("Left")) : NaN;
        var t = selDesc.hasKey(charIDToTypeID("Top ")) ? selDesc.getUnitDoubleValue(charIDToTypeID("Top ")) : NaN;
        var r = selDesc.hasKey(charIDToTypeID("Rght")) ? selDesc.getUnitDoubleValue(charIDToTypeID("Rght")) : NaN;
        var b = selDesc.hasKey(charIDToTypeID("Btom")) ? selDesc.getUnitDoubleValue(charIDToTypeID("Btom")) : NaN;
        if (!isFinite(l) || !isFinite(t) || !isFinite(r) || !isFinite(b)) return null;
        var left = Math.min(l, r);
        var right = Math.max(l, r);
        var top = Math.min(t, b);
        var bottom = Math.max(t, b);
        if ((right - left) <= 0.01 || (bottom - top) <= 0.01) return null;
        return { left: left, top: top, right: right, bottom: bottom };
      } catch (_) {
        return null;
      }
    }

    var rect = readSelectionRectByBounds(doc);
    var source = "bounds";
    if (!rect) {
      rect = readSelectionRectByAM();
      source = "actionManager";
    }
    if (!rect) {
      return "ERR|选区无效，请重新框选后再试（建议用矩形选框工具并确保选区面积>0）";
    }
    $.global.WORD_IMPORT_CEP_LOCKED_RECT = rect;
    var out = {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      source: source
    };
    return "OK|" + $.global.WORD_IMPORT_CEP._encodeJSON(out);
  } catch (e) {
    return "ERR|" + e.message + " (line: " + (e.line || "?") + ")";
  }
};

$.global.WORD_IMPORT_CEP.clearLockedSelectionRect = function () {
  try {
    $.global.WORD_IMPORT_CEP_LOCKED_RECT = null;
    return "OK|" + $.global.WORD_IMPORT_CEP._encodeJSON({ cleared: true });
  } catch (e) {
    return "ERR|" + e.message + " (line: " + (e.line || "?") + ")";
  }
};

$.global.WORD_IMPORT_CEP.diagnoseSelection = function () {
  try {
    if (app.name !== "Adobe Photoshop") return "ERR|请在 Photoshop 中运行";
    if (app.documents.length <= 0) return "ERR|请先打开 PSD 文档";
    var doc = app.activeDocument;

    function byBounds(d) {
      try {
        var b = d.selection.bounds;
        if (!b || b.length < 4) return null;
        var l = Number(b[0].as("px"));
        var t = Number(b[1].as("px"));
        var r = Number(b[2].as("px"));
        var bt = Number(b[3].as("px"));
        if (!isFinite(l) || !isFinite(t) || !isFinite(r) || !isFinite(bt)) return null;
        return { left: l, top: t, right: r, bottom: bt, width: (r - l), height: (bt - t) };
      } catch (e1) {
        return { error: String(e1 && e1.message ? e1.message : e1) };
      }
    }

    function byAM() {
      try {
        var ref = new ActionReference();
        ref.putProperty(charIDToTypeID("Prpr"), stringIDToTypeID("selection"));
        ref.putEnumerated(charIDToTypeID("Dcmn"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
        var desc = executeActionGet(ref);
        if (!desc || !desc.hasKey(stringIDToTypeID("selection"))) return null;
        var selDesc = desc.getObjectValue(stringIDToTypeID("selection"));
        if (!selDesc) return null;
        var l = selDesc.hasKey(charIDToTypeID("Left")) ? selDesc.getUnitDoubleValue(charIDToTypeID("Left")) : NaN;
        var t = selDesc.hasKey(charIDToTypeID("Top ")) ? selDesc.getUnitDoubleValue(charIDToTypeID("Top ")) : NaN;
        var r = selDesc.hasKey(charIDToTypeID("Rght")) ? selDesc.getUnitDoubleValue(charIDToTypeID("Rght")) : NaN;
        var b = selDesc.hasKey(charIDToTypeID("Btom")) ? selDesc.getUnitDoubleValue(charIDToTypeID("Btom")) : NaN;
        if (!isFinite(l) || !isFinite(t) || !isFinite(r) || !isFinite(b)) return null;
        return { left: l, top: t, right: r, bottom: b, width: (r - l), height: (b - t) };
      } catch (e2) {
        return { error: String(e2 && e2.message ? e2.message : e2) };
      }
    }

    var toolName = "";
    try {
      var r = new ActionReference();
      r.putProperty(charIDToTypeID("Prpr"), stringIDToTypeID("tool"));
      r.putEnumerated(charIDToTypeID("capp"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
      var d = executeActionGet(r);
      if (d && d.hasKey(stringIDToTypeID("tool"))) {
        var td = d.getObjectValue(stringIDToTypeID("tool"));
        if (td && td.hasKey(stringIDToTypeID("title"))) toolName = String(td.getString(stringIDToTypeID("title")));
      }
    } catch (_) {}

    var out = {
      docName: String(doc.name || ""),
      tool: toolName,
      hasLockedRect: !!$.global.WORD_IMPORT_CEP_LOCKED_RECT,
      bounds: byBounds(doc),
      actionManager: byAM()
    };
    return "OK|" + $.global.WORD_IMPORT_CEP._encodeJSON(out);
  } catch (e) {
    return "ERR|" + e.message + " (line: " + (e.line || "?") + ")";
  }
};

$.global.WORD_IMPORT_CEP._clearAllColorSamplers = function (doc) {
  try {
    if (!doc || !doc.colorSamplers) return 0;
    var samplers = doc.colorSamplers;
    var removed = 0;
    var n = Number(samplers.length || 0);
    for (var i = n; i >= 1; i--) {
      try {
        var sp = null;
        try { sp = samplers[i]; } catch (_) { sp = null; }
        if (!sp) {
          try { sp = samplers[i - 1]; } catch (_) { sp = null; }
        }
        if (!sp) continue;
        sp.remove();
        removed++;
      } catch (_) {}
    }
    return removed;
  } catch (_) {
    return 0;
  }
};

$.global.WORD_IMPORT_CEP._setCurrentToolSafe = function (toolName) {
  try {
    app.currentTool = String(toolName || "");
    return true;
  } catch (_) {
    return false;
  }
};

$.global.WORD_IMPORT_CEP.beginSamplerAnchorMode = function () {
  try {
    if (app.name !== "Adobe Photoshop") return "ERR|请在 Photoshop 中运行";
    if (app.documents.length <= 0) return "ERR|请先打开 PSD 文档";
    var doc = app.activeDocument;
    var prevTool = "";
    try { prevTool = String(app.currentTool || ""); } catch (_) { prevTool = ""; }
    $.global.WORD_IMPORT_CEP_LAST_TOOL = prevTool;
    var removed = $.global.WORD_IMPORT_CEP._clearAllColorSamplers(doc);
    $.global.WORD_IMPORT_CEP._setCurrentToolSafe("colorSamplerTool");
    return "OK|" + $.global.WORD_IMPORT_CEP._encodeJSON({
      previousTool: prevTool,
      removedSamplers: removed,
      currentTool: String(app.currentTool || "")
    });
  } catch (e) {
    return "ERR|" + e.message + " (line: " + (e.line || "?") + ")";
  }
};

$.global.WORD_IMPORT_CEP.finishSamplerAnchorMode = function () {
  try {
    if (app.name !== "Adobe Photoshop") return "ERR|请在 Photoshop 中运行";
    if (app.documents.length <= 0) return "ERR|请先打开 PSD 文档";
    var doc = app.activeDocument;
    var removed = $.global.WORD_IMPORT_CEP._clearAllColorSamplers(doc);
    // User-requested: always return to move tool after one placement.
    $.global.WORD_IMPORT_CEP._setCurrentToolSafe("moveTool");
    return "OK|" + $.global.WORD_IMPORT_CEP._encodeJSON({
      removedSamplers: removed,
      currentTool: String(app.currentTool || "")
    });
  } catch (e) {
    return "ERR|" + e.message + " (line: " + (e.line || "?") + ")";
  }
};

$.global.WORD_IMPORT_CEP.insertBubbleText = function (payloadText, repoRootHint) {
  try {
    if (app.name !== "Adobe Photoshop") return "ERR|请在 Photoshop 中运行";
    if (app.documents.length <= 0) return "ERR|请先打开 PSD 文档";

    var payloadRaw = $.global.WORD_IMPORT_CEP._parseJSON(payloadText);
    var payload = null;
    try {
      if (typeof JSON !== "undefined" && JSON && JSON.parse) {
        payload = JSON.parse(payloadRaw);
      } else {
        payload = eval("(" + payloadRaw + ")");
      }
    } catch (_) {
      payload = null;
    }

    var hasSegments = !!(payload && payload.segments && payload.segments.length);
    var txt = !!(payload && payload.text != null && String(payload.text).length);
    if (!payload || (!hasSegments && !txt)) return "ERR|拖拽内容无效";

    function resolveSelectionInfoByAM() {
      try {
        var ref = new ActionReference();
        ref.putProperty(charIDToTypeID("Prpr"), stringIDToTypeID("selection"));
        ref.putEnumerated(charIDToTypeID("Dcmn"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
        var desc = executeActionGet(ref);
        if (!desc || !desc.hasKey(stringIDToTypeID("selection"))) return null;
        var selDesc = desc.getObjectValue(stringIDToTypeID("selection"));
        if (!selDesc) return null;
        var l = selDesc.hasKey(charIDToTypeID("Left")) ? selDesc.getUnitDoubleValue(charIDToTypeID("Left")) : NaN;
        var t = selDesc.hasKey(charIDToTypeID("Top ")) ? selDesc.getUnitDoubleValue(charIDToTypeID("Top ")) : NaN;
        var r = selDesc.hasKey(charIDToTypeID("Rght")) ? selDesc.getUnitDoubleValue(charIDToTypeID("Rght")) : NaN;
        var b = selDesc.hasKey(charIDToTypeID("Btom")) ? selDesc.getUnitDoubleValue(charIDToTypeID("Btom")) : NaN;
        if (!isFinite(l) || !isFinite(t) || !isFinite(r) || !isFinite(b) || r <= l || b <= t) return null;
        return {
          x: (l + r) / 2,
          y: (t + b) / 2,
          left: l,
          top: t,
          right: r,
          bottom: b
        };
      } catch (_) {
        return null;
      }
    }

    function resolveSelectionInfo(doc) {
      try {
        var b = doc.selection.bounds;
        if (!b || b.length < 4) return null;
        var l = Number(b[0].as("px"));
        var t = Number(b[1].as("px"));
        var r = Number(b[2].as("px"));
        var bt = Number(b[3].as("px"));
        if (isNaN(l) || isNaN(t) || isNaN(r) || isNaN(bt)) return null;
        return {
          x: (l + r) / 2,
          y: (t + bt) / 2,
          left: l,
          top: t,
          right: r,
          bottom: bt
        };
      } catch (_) {
        return resolveSelectionInfoByAM();
      }
    }

    var doc = app.activeDocument;
    function resolveSamplerPoint(doc0) {
      var out = { point: null, count: 0, index: -1 };
      try {
        if (!doc0 || !doc0.colorSamplers) return out;
        var samplers = doc0.colorSamplers;
        var count = Number(samplers.length || 0);
        out.count = isFinite(count) && count > 0 ? count : 0;
        if (!out.count) return out;
        for (var si = out.count; si >= 1; si--) {
          var sp = null;
          // Photoshop collections are usually 1-based; keep a 0-based fallback for safety.
          try { sp = samplers[si]; } catch (_) { sp = null; }
          if (!sp) {
            try { sp = samplers[si - 1]; } catch (_) { sp = null; }
          }
          if (!sp || !sp.position || sp.position.length < 2) continue;
          var sx = Number(sp.position[0] && sp.position[0].as ? sp.position[0].as("px") : sp.position[0]);
          var sy = Number(sp.position[1] && sp.position[1].as ? sp.position[1].as("px") : sp.position[1]);
          if (!isFinite(sx) || !isFinite(sy)) continue;
          out.point = { x: sx, y: sy, source: "colorSampler" };
          out.index = si;
          return out;
        }
      } catch (_) {}
      return out;
    }

    function resolveSamplerPointWithRetry(doc0, retryCount, waitMs) {
      var maxTry = Number(retryCount);
      if (!isFinite(maxTry) || maxTry < 1) maxTry = 1;
      var pause = Number(waitMs);
      if (!isFinite(pause) || pause < 0) pause = 0;
      for (var ti = 0; ti < maxTry; ti++) {
        var one = resolveSamplerPoint(doc0);
        if (one && one.point) return one;
        if (ti < maxTry - 1 && pause > 0) {
          try { $.sleep(pause); } catch (_) {}
        }
      }
      return resolveSamplerPoint(doc0);
    }

    var samplerInfo = resolveSamplerPointWithRetry(doc, 4, 60);
    // First click with colorSamplerTool can arrive slightly before sampler point is committed.
    // In direct-place flow, wait a bit longer to capture that first point and avoid second-click-only behavior.
    if ((!samplerInfo || !samplerInfo.point) && payload && payload.placeAtCursorOnly) {
      samplerInfo = resolveSamplerPointWithRetry(doc, 16, 80);
    }
    var pointFromSampler = samplerInfo.point;
    var probe = null;
    var probeFromPayload = false;
    var pointFromProbe = null;
    if (!pointFromSampler) {
      if (payload && payload.probeSnapshot) {
        var ps = payload.probeSnapshot;
        probe = {
          cursorX: $.global.WORD_IMPORT_CEP._parseProbeNumber(ps.cursorX),
          cursorY: $.global.WORD_IMPORT_CEP._parseProbeNumber(ps.cursorY),
          winL: $.global.WORD_IMPORT_CEP._parseProbeNumber(ps.winL),
          winT: $.global.WORD_IMPORT_CEP._parseProbeNumber(ps.winT),
          winR: $.global.WORD_IMPORT_CEP._parseProbeNumber(ps.winR),
          winB: $.global.WORD_IMPORT_CEP._parseProbeNumber(ps.winB),
          clientL: $.global.WORD_IMPORT_CEP._parseProbeNumber(ps.clientL),
          clientT: $.global.WORD_IMPORT_CEP._parseProbeNumber(ps.clientT),
          clientR: $.global.WORD_IMPORT_CEP._parseProbeNumber(ps.clientR),
          clientB: $.global.WORD_IMPORT_CEP._parseProbeNumber(ps.clientB)
        };
        probeFromPayload = true;
      }
      if (!probe && $.global.WORD_IMPORT_CEP._shouldUseCursorProbe(payload)) {
        probe = $.global.WORD_IMPORT_CEP._runCursorProbe(repoRootHint);
        if (!probe) probe = $.global.WORD_IMPORT_CEP._runCursorProbeOnce(repoRootHint);
      }
      pointFromProbe = $.global.WORD_IMPORT_CEP._screenToDocPoint(doc, probe);
      if (!pointFromProbe && payload && payload.placeAtCursorOnly && probe) {
        try {
          var cl = Number(probe.clientL), ct = Number(probe.clientT), cr = Number(probe.clientR), cb = Number(probe.clientB);
          var cx = Number(probe.cursorX), cy = Number(probe.cursorY);
          if (isFinite(cl) && isFinite(ct) && isFinite(cr) && isFinite(cb) && isFinite(cx) && isFinite(cy) && cr > cl && cb > ct) {
            var fx = (cx - cl) / (cr - cl);
            var fy = (cy - ct) / (cb - ct);
            if (fx < 0) fx = 0; if (fx > 1) fx = 1;
            if (fy < 0) fy = 0; if (fy > 1) fy = 1;
            var dw = Number(doc.width && doc.width.as ? doc.width.as("px") : doc.width);
            var dh = Number(doc.height && doc.height.as ? doc.height.as("px") : doc.height);
            if (isFinite(dw) && isFinite(dh) && dw > 0 && dh > 0) {
              pointFromProbe = { x: fx * dw, y: fy * dh };
              $.global.WORD_IMPORT_CEP._SCREEN_TO_DOC_LAST_FAIL = "fallback_payload_ratio";
            }
          }
        } catch (_) {}
      }
    }
    var calib = $.global.WORD_IMPORT_CEP._loadCalibration(repoRootHint);
    if (pointFromProbe && calib) {
      pointFromProbe = $.global.WORD_IMPORT_CEP._applyCalibration(pointFromProbe, calib);
    }
    var selInfo = resolveSelectionInfo(doc);
    var debugAnchorSource = "dragApprox";
    if (pointFromSampler) {
      payload.anchorMode = "docPoint";
      payload.docX = pointFromSampler.x;
      payload.docY = pointFromSampler.y;
      debugAnchorSource = "colorSampler";
    } else if (pointFromProbe) {
      payload.anchorMode = "docPoint";
      payload.docX = pointFromProbe.x;
      payload.docY = pointFromProbe.y;
      debugAnchorSource = "probe";
    } else if (selInfo) {
      payload.anchorMode = "docPoint";
      payload.docX = selInfo.x;
      payload.docY = selInfo.y;
      debugAnchorSource = "selection";
    }
    if (selInfo) {
      payload.selectionRect = {
        left: selInfo.left,
        top: selInfo.top,
        right: selInfo.right,
        bottom: selInfo.bottom
      };
      payload.preferSelectionRect = true;
    }
    var lockedRect = $.global.WORD_IMPORT_CEP_LOCKED_RECT || null;
    if (lockedRect && isFinite(Number(lockedRect.left)) && isFinite(Number(lockedRect.top)) && isFinite(Number(lockedRect.right)) && isFinite(Number(lockedRect.bottom))) {
      payload.selectionRect = {
        left: Number(lockedRect.left),
        top: Number(lockedRect.top),
        right: Number(lockedRect.right),
        bottom: Number(lockedRect.bottom)
      };
      payload.preferSelectionRect = true;
      payload.anchorMode = "docPoint";
      payload.docX = (payload.selectionRect.left + payload.selectionRect.right) / 2;
      payload.docY = (payload.selectionRect.top + payload.selectionRect.bottom) / 2;
      if (debugAnchorSource !== "colorSampler" && debugAnchorSource !== "probe") debugAnchorSource = "selection";
    }

    var api = $.global.WORD_IMPORT_CEP._loadCoreApi(repoRootHint);
    if (!api.insertBubbleParagraphCEP) return "ERR|导入核心版本过旧，请重装 CEP 扩展";
    if (payload && payload.previewCandidatesOnly) {
      payload.returnBubbleCandidates = true;
      payload.candidateTopN = payload.candidateTopN != null ? payload.candidateTopN : 5;
      payload.useCursorProbe = false;
      var preview = api.insertBubbleParagraphCEP(doc, payload);
      if (!preview) return "ERR|预览 insertBubbleParagraphCEP 返回空";
      return "OK|" + $.global.WORD_IMPORT_CEP._encodeJSON(preview || {});
    }
    var result = api.insertBubbleParagraphCEP(doc, payload);
    if (!result) return "ERR|insertBubbleParagraphCEP 返回空（请查看 PS 脚本错误提示或重装扩展）";
    try {
      result.debugSelInfo = !!selInfo;
      result.debugSelectionRectPassed = !!(payload && payload.selectionRect);
      result.debugPreferSelectionRect = !!(payload && payload.preferSelectionRect);
      result.debugLockedRect = !!lockedRect;
      result.debugProbeFromPayload = !!probeFromPayload;
      result.debugProbeAvailable = !!probe;
      result.debugPointFromProbe = !!pointFromProbe;
      result.debugProbeCursorX = probe && probe.cursorX != null ? Number(probe.cursorX) : null;
      result.debugProbeCursorY = probe && probe.cursorY != null ? Number(probe.cursorY) : null;
      result.debugScreenToDocFail = String($.global.WORD_IMPORT_CEP._SCREEN_TO_DOC_LAST_FAIL || "");
      result.debugAnchorSource = String(debugAnchorSource || "");
      result.debugSamplerCount = samplerInfo && samplerInfo.count != null ? Number(samplerInfo.count) : 0;
      result.debugSamplerIndex = samplerInfo && samplerInfo.index != null ? Number(samplerInfo.index) : -1;
      result.debugSamplerX = pointFromSampler ? Number(pointFromSampler.x) : null;
      result.debugSamplerY = pointFromSampler ? Number(pointFromSampler.y) : null;
      if (payload && payload.selectionRect) result.debugSelectionRect = payload.selectionRect;
    } catch (_) {}
    if (!result.anchorUsed && pointFromProbe) {
      result.anchorUsed = "cursorProbe";
      result.anchorDocX = pointFromProbe.x;
      result.anchorDocY = pointFromProbe.y;
    } else if (!result.anchorUsed && selInfo) {
      result.anchorUsed = "selectionCenter";
      result.anchorDocX = selInfo.x;
      result.anchorDocY = selInfo.y;
    } else if (!result.anchorUsed) {
      result.anchorUsed = "dragApprox";
    }
    return "OK|" + $.global.WORD_IMPORT_CEP._encodeJSON(result);
  } catch (e) {
    return "ERR|" + e.message + " (line: " + (e.line || "?") + ")";
  }
};

