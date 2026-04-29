(function () {
  var logBox = document.getElementById("logBox");
  var repoRootHint = "";

  function log(msg) {
    var now = new Date();
    var ts = now.toTimeString().slice(0, 8);
    var line = "[" + ts + "] " + msg;
    logBox.value = logBox.value ? (logBox.value + "\n" + line) : line;
    logBox.scrollTop = logBox.scrollHeight;
  }

  function callHost(script, done) {
    if (!window.__adobe_cep__ || !window.__adobe_cep__.evalScript) {
      log("当前环境不是 CEP（缺少 __adobe_cep__）");
      if (typeof done === "function") done("ERR|NO_CEP");
      return;
    }
    window.__adobe_cep__.evalScript(script, function (result) {
      if (typeof done === "function") done(result);
    });
  }

  function runFromRepo(filename) {
    var escaped = filename.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    var escapedRepo = String(repoRootHint || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    var script = 'WORD_IMPORT_CEP.runRepoScript("' + escaped + '","' + escapedRepo + '")';
    callHost(script, function (result) {
      if (result && result.indexOf("OK|") === 0) {
        log("执行成功: " + filename);
      } else {
        log("执行失败: " + result);
      }
    });
  }

  function sanitizeRepoText(raw) {
    var s = String(raw == null ? "" : raw);
    if (s.charCodeAt && s.length && s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    s = s.replace(/\r/g, "").replace(/\n/g, "").trim();
    s = s.replace(/^["']|["']$/g, "");
    return s;
  }

  function initRepoRootHint() {
    try {
      if (!window.__adobe_cep__ || !window.__adobe_cep__.getSystemPath || !window.cep || !window.cep.fs) {
        log("未检测到 CEP 文件系统 API，将使用 Host 侧自动定位。");
        return;
      }
      var extPath = window.__adobe_cep__.getSystemPath("extension");
      if (!extPath) return;
      var marker = extPath + "/host/repo_path.txt";
      var res = window.cep.fs.readFile(marker);
      if (res && res.err === 0) {
        repoRootHint = sanitizeRepoText(res.data);
        if (repoRootHint) log("已读取项目路径标记。");
      } else {
        log("未读取到项目路径标记，将使用 Host 侧自动定位。");
      }
    } catch (e) {
      log("读取项目路径标记失败: " + e.message);
    }
  }

  document.getElementById("btnOpenPanel").addEventListener("click", function () {
    runFromRepo("import_panel.jsx");
  });

  document.getElementById("btnQuickImport").addEventListener("click", function () {
    runFromRepo("import_to_photoshop.jsx");
  });

  document.getElementById("btnPing").addEventListener("click", function () {
    callHost("WORD_IMPORT_CEP.ping()", function (result) {
      log(result || "NO_RESPONSE");
    });
  });

  initRepoRootHint();
  log("漫画汉化导入助手（CEP）已启动。");
})();
