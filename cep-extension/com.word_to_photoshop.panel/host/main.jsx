#target photoshop

if (!$.global.WORD_IMPORT_CEP) {
  $.global.WORD_IMPORT_CEP = {};
}

$.global.WORD_IMPORT_CEP.ping = function () {
  return "PONG|Photoshop CEP Host Ready";
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
  s = s.replace(/\r/g, "").replace(/\n/g, "");
  while (s.length && (s.charAt(0) === " " || s.charAt(0) === "\t" || s.charAt(0) === "\"" || s.charAt(0) === "'")) s = s.substring(1);
  while (s.length && (s.charAt(s.length - 1) === " " || s.charAt(s.length - 1) === "\t" || s.charAt(s.length - 1) === "\"" || s.charAt(s.length - 1) === "'")) s = s.substring(0, s.length - 1);
  return s;
};

$.global.WORD_IMPORT_CEP.diagnoseRepoRoot = function () {
  var extRoot = new File($.fileName).parent.parent;
  var marker = new File(extRoot.fsName + "/host/repo_path.txt");
  var out = [];
  out.push("host=" + $.fileName);
  try { out.push("env=" + $.getenv("WORD_IMPORT_REPO_PATH")); } catch (_) {}
  out.push("extRoot=" + extRoot.fsName);
  out.push("marker=" + marker.fsName);
  out.push("markerExists=" + marker.exists);
  try {
    if (marker.exists && marker.open("r")) {
      var raw = marker.read();
      marker.close();
      var p = $.global.WORD_IMPORT_CEP._sanitizePathText(raw);
      out.push("markerRawLen=" + String(raw).length);
      out.push("markerPath=" + p);
      var f = new Folder(p);
      out.push("folderExists=" + f.exists);
    }
  } catch (e) {
    out.push("markerReadErr=" + e.message);
  }
  return out.join("; ");
};

$.global.WORD_IMPORT_CEP.getRepoRoot = function () {
  // Most reliable: user env var set by installer.
  try {
    var envPath = $.getenv("WORD_IMPORT_REPO_PATH");
    envPath = $.global.WORD_IMPORT_CEP._sanitizePathText(envPath);
    if (envPath) {
      var envFolder = new Folder(envPath);
      if (envFolder.exists) return envFolder;
    }
  } catch (_) {}

  var extRoot = new File($.fileName).parent.parent;

  // Preferred: install script writes the real repo root here.
  try {
    var marker = new File(extRoot.fsName + "/host/repo_path.txt");
    if (marker.exists && marker.open("r")) {
      var raw = marker.read();
      marker.close();
      var p = $.global.WORD_IMPORT_CEP._sanitizePathText(raw);
      if (p) {
        var f = new Folder(p);
        if (f.exists) return f;
      }
    }
  } catch (_) {}

  // Dev fallback: if extension lives inside repo/cep-extension/...
  try {
    if (extRoot.parent && extRoot.parent.parent && extRoot.parent.parent.parent) {
      var fallback = extRoot.parent.parent.parent;
      if (fallback && fallback.exists) return fallback;
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
    if (!repoRoot) return "ERR|无法定位项目目录（repo_path.txt 缺失或无效） | " + $.global.WORD_IMPORT_CEP.diagnoseRepoRoot();
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
  if (!repoRoot) throw new Error("无法定位项目目录");
  var coreFile = new File(repoRoot.fsName + "/import_to_photoshop.jsx");
  if (!coreFile.exists) throw new Error("找不到导入核心: " + coreFile.fsName);
  $.global.WORD_IMPORT_PANEL_MODE = true;
  $.evalFile(coreFile);
  if (!$.global.WORD_IMPORT_API) throw new Error("导入核心 API 加载失败");
  return $.global.WORD_IMPORT_API;
};

$.global.WORD_IMPORT_CEP.exportDocxToJsxdata = function (docxPath, outPath, repoRootHint) {
  try {
    var repoRoot = $.global.WORD_IMPORT_CEP._resolveRepoRootWithHint(repoRootHint);
    if (!repoRoot) return "ERR|无法定位项目目录";

    var scriptFile = new File(repoRoot.fsName + "/export_docx_styles.ps1");
    if (!scriptFile.exists) return "ERR|找不到导出脚本: " + scriptFile.fsName;

    var input = $.global.WORD_IMPORT_CEP._sanitizePathText(docxPath);
    if (!input) {
      var picked = File.openDialog("选择 Word 文件", "*.docx");
      if (!picked) return "ERR|已取消 Word 文件选择";
      input = picked.fsName;
    }
    var docxFile = new File(input);
    if (!docxFile.exists) return "ERR|Word 文件不存在: " + input;

    var outputPath = $.global.WORD_IMPORT_CEP._sanitizePathText(outPath);
    if (!outputPath) {
      var base = docxFile.name.replace(/\.[^\.]+$/, "");
      outputPath = docxFile.parent.fsName + "/" + base + ".jsxdata";
    }

    var cmd = "powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File " +
      $.global.WORD_IMPORT_CEP._quoteForCmd(scriptFile.fsName) +
      " -DocxPath " + $.global.WORD_IMPORT_CEP._quoteForCmd(docxFile.fsName) +
      " -OutFile " + $.global.WORD_IMPORT_CEP._quoteForCmd(outputPath) +
      " -Minify";

    var output = app.system(cmd);
    var outFile = new File(outputPath);
    if (!outFile.exists) {
      return "ERR|导出失败，未生成文件。输出: " + String(output || "");
    }

    var result = {
      outFile: outFile.fsName,
      shellOutput: String(output || "")
    };
    return "OK|" + $.global.WORD_IMPORT_CEP._encodeJSON(result);
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

    var api = $.global.WORD_IMPORT_CEP._loadCoreApi(repoRootHint);
    if (!api.insertBubbleParagraphCEP) return "ERR|导入核心版本过旧，请重装 CEP 扩展";
    var result = api.insertBubbleParagraphCEP(app.activeDocument, payload);
    return "OK|" + $.global.WORD_IMPORT_CEP._encodeJSON(result);
  } catch (e) {
    return "ERR|" + e.message + " (line: " + (e.line || "?") + ")";
  }
};
