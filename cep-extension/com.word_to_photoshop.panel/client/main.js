(function () {
  var logBox = document.getElementById("logBox");
  var pageSelect = document.getElementById("pageSelect");
  var quoteList = document.getElementById("quoteList");
  var panelWrap = document.querySelector(".wrap");
  var repoRootHint = "";
  var quoteState = { pages: [], defaultPage: "001" };

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

  function escHostString(s) {
    return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function decodePayload(text) {
    var raw = String(text == null ? "" : text);
    try { raw = decodeURIComponent(raw); } catch (_) {}
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  function sanitizeForDrag(text) {
    return String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  }

  function exportDocxToJsxdata() {
    log("开始导出（将弹出 Word 文件选择框）...");
    var script = 'WORD_IMPORT_CEP.exportDocxToJsxdata("","","' + escHostString(repoRootHint) + '")';
    callHost(script, function (result) {
      if (!result || result.indexOf("OK|") !== 0) {
        log("导出失败: " + (result || "UNKNOWN_ERROR"));
        return;
      }
      var payload = decodePayload(result.slice(3)) || {};
      log("导出完成: " + (payload.outFile || ""));
      if (payload.shellOutput) {
        log("导出日志: " + payload.shellOutput.replace(/\s+/g, " ").trim());
      }
      reloadQuotes();
    });
  }

  function getSelectedPageObj() {
    var page = String(pageSelect.value || quoteState.defaultPage || "");
    for (var i = 0; i < quoteState.pages.length; i++) {
      if (String(quoteState.pages[i].page) === page) return quoteState.pages[i];
    }
    return null;
  }

  function renderPageOptions() {
    pageSelect.innerHTML = "";
    if (!quoteState.pages.length) {
      var optEmpty = document.createElement("option");
      optEmpty.value = "";
      optEmpty.textContent = "无可用页码";
      pageSelect.appendChild(optEmpty);
      pageSelect.disabled = true;
      return;
    }
    pageSelect.disabled = false;
    for (var i = 0; i < quoteState.pages.length; i++) {
      var p = quoteState.pages[i];
      var opt = document.createElement("option");
      opt.value = String(p.page);
      opt.textContent = "#" + String(p.page);
      pageSelect.appendChild(opt);
    }
    var selected = String(quoteState.defaultPage || "");
    if (selected) pageSelect.value = selected;
    if (!pageSelect.value) pageSelect.selectedIndex = 0;
  }

  function insertQuoteToPs(item, ev) {
    var vw = Math.max(1, window.innerWidth || 360);
    var vh = Math.max(1, window.innerHeight || 520);
    var cx = ev && typeof ev.clientX === "number" ? ev.clientX : NaN;
    var cy = ev && typeof ev.clientY === "number" ? ev.clientY : NaN;
    var rQl = quoteList.getBoundingClientRect();
    var inQuoteList =
      !isNaN(cx) &&
      !isNaN(cy) &&
      cx >= rQl.left &&
      cx <= rQl.right &&
      cy >= rQl.top &&
      cy <= rQl.bottom;
    var rPanel = panelWrap ? panelWrap.getBoundingClientRect() : null;
    var rUse = inQuoteList ? rQl : rPanel && rPanel.width >= 80 ? rPanel : null;
    if (!rUse) {
      rUse = { left: 0, top: 0, width: vw, height: vh };
    }
    if (isNaN(cx) || isNaN(cy) || (cx === 0 && cy === 0)) {
      cx = rUse.left + rUse.width * 0.52;
      cy = rUse.top + rUse.height * 0.45;
    }
    var ww = Math.max(1, rUse.width);
    var hh = Math.max(1, rUse.height);
    var fracX = Math.max(0, Math.min(1, (cx - rUse.left) / ww));
    var fracY = Math.max(0, Math.min(1, (cy - rUse.top) / hh));
    var payload = {
      page: item.page,
      paragraph: item.paragraph,
      text: item.text,
      segments: item.segments || [],
      fracX: fracX,
      fracY: fracY
    };
    var payloadText = encodeURIComponent(JSON.stringify(payload));
    var script = 'WORD_IMPORT_CEP.insertBubbleText("' + escHostString(payloadText) + '","' + escHostString(repoRootHint) + '")';
    callHost(script, function (result) {
      if (result && result.indexOf("OK|") === 0) {
        var info = decodePayload(result.slice(3)) || {};
        log("已投放到 PS: " + (info.layerName || ("#" + item.page + "-" + item.paragraph)));
      } else {
        log("投放失败: " + (result || "UNKNOWN_ERROR"));
      }
    });
  }

  function renderQuoteList() {
    quoteList.innerHTML = "";
    var pageObj = getSelectedPageObj();
    var items = (pageObj && pageObj.items) ? pageObj.items : [];
    if (!items.length) {
      var empty = document.createElement("div");
      empty.className = "quoteEmpty";
      empty.textContent = "当前页无可拖拽台词。";
      quoteList.appendChild(empty);
      return;
    }
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var row = document.createElement("div");
      row.className = "quoteItem";
      row.draggable = true;

      var meta = document.createElement("div");
      meta.className = "quoteMeta";
      meta.textContent = "#" + it.page + " · 段落 " + it.paragraph;
      row.appendChild(meta);

      var text = document.createElement("div");
      text.className = "quoteText";
      text.textContent = it.text;
      row.appendChild(text);

      row.addEventListener("dragstart", (function (item, el) {
        return function (e) {
          var dragText = sanitizeForDrag(item.text);
          try { e.dataTransfer.setData("text/plain", dragText); } catch (_) {}
          try { e.dataTransfer.effectAllowed = "copy"; } catch (_) {}
          el.classList.add("dragging");
          log("开始拖拽: #" + item.page + " 段 " + item.paragraph);
        };
      })(it, row));

      row.addEventListener("dragend", (function (item, el) {
        return function (e) {
          el.classList.remove("dragging");
          insertQuoteToPs(item, e);
        };
      })(it, row));

      quoteList.appendChild(row);
    }
  }

  function reloadQuotes() {
    var script = 'WORD_IMPORT_CEP.listQuotes("' + escHostString(repoRootHint) + '")';
    callHost(script, function (result) {
      if (!result || result.indexOf("OK|") !== 0) {
        quoteState = { pages: [], defaultPage: "001" };
        renderPageOptions();
        renderQuoteList();
        log("读取台词失败: " + (result || "UNKNOWN_ERROR"));
        return;
      }
      var payload = decodePayload(result.slice(3)) || {};
      var pages = payload.pages || [];
      var normalizedPages = [];
      for (var i = 0; i < pages.length; i++) {
        var p = pages[i] || {};
        var srcItems = p.items || [];
        var outItems = [];
        for (var k = 0; k < srcItems.length; k++) {
          outItems.push({
            page: String(p.page || ""),
            paragraph: srcItems[k].paragraph,
            text: String(srcItems[k].text || ""),
            segments: srcItems[k].segments || []
          });
        }
        normalizedPages.push({ page: String(p.page || ""), items: outItems });
      }
      quoteState = {
        pages: normalizedPages,
        defaultPage: String(payload.defaultPage || (normalizedPages[0] ? normalizedPages[0].page : "001"))
      };
      renderPageOptions();
      renderQuoteList();
      log("台词已刷新：共 " + normalizedPages.length + " 页。");
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

  document.getElementById("btnClearDialogues").addEventListener("click", function () {
    var ok = window.confirm(
      "将删除当前 PSD 内所有由本工具生成的对话文本图层：\n名称以 「Word Import #」或「Bubble #」开头的文本图层（含图层组内）。\n\n此操作不可撤销。确定要继续吗？"
    );
    if (!ok) {
      log("已取消清除。");
      return;
    }
    callHost('WORD_IMPORT_CEP.clearImportedDialogues()', function (result) {
      if (!result || result.indexOf("OK|") !== 0) {
        log("清除失败: " + (result || "UNKNOWN_ERROR"));
        return;
      }
      var payload = decodePayload(result.slice(3)) || {};
      log("已删除导入对话文本图层，共 " + (payload.removedCount != null ? payload.removedCount : "?") + " 个。");
    });
  });

  document.getElementById("btnPing").addEventListener("click", function () {
    callHost("WORD_IMPORT_CEP.ping()", function (result) {
      log(result || "NO_RESPONSE");
    });
  });

  document.getElementById("btnExportDocx").addEventListener("click", function () {
    exportDocxToJsxdata();
  });

  document.getElementById("btnReloadQuotes").addEventListener("click", function () {
    reloadQuotes();
  });

  pageSelect.addEventListener("change", function () {
    renderQuoteList();
  });

  initRepoRootHint();
  renderPageOptions();
  renderQuoteList();
  reloadQuotes();
  log("漫画汉化导入助手（CEP）已启动。");
})();
