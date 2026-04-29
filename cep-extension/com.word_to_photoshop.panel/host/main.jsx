#target photoshop

if (!$.global.WORD_IMPORT_CEP) {
  $.global.WORD_IMPORT_CEP = {};
}

$.global.WORD_IMPORT_CEP.ping = function () {
  return "PONG|Photoshop CEP Host Ready";
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
