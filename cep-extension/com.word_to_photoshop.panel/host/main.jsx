#target photoshop

if (!$.global.WORD_IMPORT_CEP) {
  $.global.WORD_IMPORT_CEP = {};
}

$.global.WORD_IMPORT_CEP.BUILD_ID = "2026-05-01T13:00+08 directPlace-v1";

$.global.WORD_IMPORT_CEP.ping = function () {
  return "PONG|Photoshop CEP Host Ready|build=" + ($.global.WORD_IMPORT_CEP.BUILD_ID || "");
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
    var repoRoot = $.global.WORD_IMPORT_CEP._resolveRepoRootWithHint(repoRootHint);
    if (!repoRoot) return null;
    return new File(repoRoot.fsName + "/cursor_calibration.json");
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
  if (!repoRoot) throw new Error("无法定位项目目录");
  var coreFile = new File(repoRoot.fsName + "/import_to_photoshop.jsx");
  if (!coreFile.exists) throw new Error("找不到导入核心: " + coreFile.fsName);
  $.global.WORD_IMPORT_PANEL_MODE = true;
  $.evalFile(coreFile);
  if (!$.global.WORD_IMPORT_API) throw new Error("导入核心 API 加载失败");
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
    if (!repoRoot) return "ERR|无法定位项目目录";
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

$.global.WORD_IMPORT_CEP.generateBubbleMasks = function (repoRootHint) {
  try {
    var repoRoot = $.global.WORD_IMPORT_CEP._resolveRepoRootWithHint(repoRootHint);
    if (!repoRoot) return "ERR|无法定位项目目录";
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

    var samplerInfo = resolveSamplerPoint(doc);
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
      return "OK|" + $.global.WORD_IMPORT_CEP._encodeJSON(preview || {});
    }
    var result = api.insertBubbleParagraphCEP(doc, payload);
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

