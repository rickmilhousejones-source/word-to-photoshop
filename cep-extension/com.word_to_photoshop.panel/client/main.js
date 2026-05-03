(function () {
  var BUILD_ID = "2026-05-03T12:00+08 cep-v1.2";
  /** Keep in sync with CSXS/manifest.xml ExtensionBundleVersion and release-channel.json. */
  var EXTENSION_BUNDLE_VERSION = "1.2.0";
  /** 检查更新（测试）：仅此渠道，直接打开腾讯文档，不请求 release-channel.json。 */
  var UPDATE_DOCS_URL = "https://docs.qq.com/doc/DRG9LcFd0S1pab1RZ";
  var logBox = document.getElementById("logBox");
  var pageSelect = document.getElementById("pageSelect");
  var quoteList = document.getElementById("quoteList");
  var devTools = document.getElementById("devTools");
  var repoRootHint = "";
  var quoteState = { pages: [], defaultPage: "001" };
  var pendingQuote = null;
  var pendingRowEl = null;
  var titleTapCount = 0;
  var titleTapTimer = 0;

  /** @type {string} */
  var probePathUtf8 = "";
  var placementArmTimerId = 0;
  var placementIntervalId = 0;
  var lastProbeLmbDown = false;
  var warnedProbeV1 = false;
  var isPlacingQuote = false;
  var lastPlacementTriggerTs = 0;
  var lastPlacementRejectLogTs = 0;
  var lastPlacementHeartbeatTs = 0;
  var hoverStableSinceTs = 0;
  var lastProbeCursorX = NaN;
  var lastProbeCursorY = NaN;
  var lastTickEarlyLogTs = 0;
  var lastProbeReadFailLogTs = 0;
  var requireMouseUpBeforeTrigger = false;
  var suppressTriggerUntilTs = 0;
  /** 限制日志体积，减轻长时间轮询下 PS 2026 CEP 面板压力 */
  var LOG_MAX_LINES = 200;
  var LOG_MAX_CHARS = 96000;
  /** 画布点击轮询间隔（毫秒）；由 30 调至 48 略降频率，减轻 CEP 压力 */
  var PLACEMENT_POLL_MS = 48;

  var CE_TEXT_ALIGN_KEY = "word_import_cep_text_align";

  function normalizeClientTextAlign(v) {
    var s = String(v == null ? "" : v).replace(/^\s+|\s+$/g, "").toLowerCase();
    if (s === "right") return "right";
    if (s === "center" || s === "centre" || s === "middle") return "center";
    return "left";
  }

  function getCeTextAlign() {
    try {
      if (window.localStorage) {
        var v = window.localStorage.getItem(CE_TEXT_ALIGN_KEY);
        if (v) return normalizeClientTextAlign(v);
      }
    } catch (_) {}
    return "center";
  }

  function setCeTextAlign(raw) {
    var v = normalizeClientTextAlign(raw);
    try {
      if (window.localStorage) window.localStorage.setItem(CE_TEXT_ALIGN_KEY, v);
    } catch (_) {}
    updateAlignToolbarUi();
    log("画布投放对齐已设为: " + v + "（将写入本次投放请求）。");
  }

  function updateAlignToolbarUi() {
    var cur = getCeTextAlign();
    var ids = { left: "btnAlignLeft", center: "btnAlignCenter", right: "btnAlignRight" };
    var k;
    for (k in ids) {
      if (!ids.hasOwnProperty(k)) continue;
      var el = document.getElementById(ids[k]);
      if (!el) continue;
      try {
        if (k === cur) el.classList.add("alignActive");
        else el.classList.remove("alignActive");
      } catch (_) {}
    }
  }

  function log(msg) {
    var now = new Date();
    var ts = now.toTimeString().slice(0, 8);
    var line = "[" + ts + "] " + msg;
    var next = logBox.value ? (logBox.value + "\n" + line) : line;
    if (next.length > LOG_MAX_CHARS) {
      var parts = next.split("\n");
      if (parts.length > LOG_MAX_LINES) {
        parts = parts.slice(parts.length - LOG_MAX_LINES);
        next = "…(已截断较早日志)\n" + parts.join("\n");
      } else {
        next = next.slice(next.length - LOG_MAX_CHARS);
        next = "…(已截断)\n" + next;
      }
    }
    logBox.value = next;
    logBox.scrollTop = logBox.scrollHeight;
  }

  /** 宿主返回的屏幕坐标映射诊断码（仅非 ok 时有意义） */
  function describeScreenToDocFail(code) {
    var c = String(code || "").replace(/^\s+|\s+$/g, "");
    if (!c || /^ok_/i.test(c)) return "";
    var map = {
      no_doc_or_probe: "无活动文档或探针未就绪",
      no_cursor: "无法读取 PS 光标/取样器",
      fallback_client_ratio_no_am_view: "无 AM 视口信息，已用客户端比例回退",
      no_am_view: "缺少 AM 视口数据",
      bad_am_zoom: "AM 缩放数据异常",
      bad_am_center: "AM 视口中心异常",
      bad_viewport: "视口换算异常",
      bad_doc_xy: "文档坐标换算结果异常",
      fallback_payload_ratio: "已用探针比例回退映射点击",
      exception: "屏幕到文档坐标映射异常"
    };
    return map[c] || c;
  }

  function isCepHost() {
    return !!(window.__adobe_cep__ && window.__adobe_cep__.evalScript);
  }

  var noCepCallHostLogged = false;
  function showNoCepBanner() {
    var shell = document.querySelector(".shell");
    if (!shell || document.getElementById("noCepBanner")) return;
    var bar = document.createElement("div");
    bar.id = "noCepBanner";
    bar.className = "noCepBanner";
    bar.setAttribute("role", "alert");
    bar.innerHTML =
      "<strong>未连接到 Photoshop（非 CEP 环境）</strong>" +
      "本界面必须在 Photoshop 内通过菜单打开，例如：<kbd>窗口</kbd> → <kbd>扩展功能（旧版）</kbd> → <kbd>Word Import CEP</kbd>。" +
      "请勿用 Chrome / Edge 直接打开 <code>index.html</code>，也不要用「在浏览器中打开」预览扩展文件夹。" +
      "若用户已按上述方式打开仍出现本提示，请重新安装扩展包或清理 CEP 缓存后重启 Photoshop。";
    shell.insertBefore(bar, shell.firstChild);
  }

  function callHost(script, done) {
    if (!isCepHost()) {
      if (!noCepCallHostLogged) {
        noCepCallHostLogged = true;
        log(
          "当前环境不是 CEP（缺少 __adobe_cep__）。请从 Photoshop 内打开本面板，勿在独立浏览器中预览。"
        );
      }
      if (typeof done === "function") done("ERR|NO_CEP");
      return;
    }
    window.__adobe_cep__.evalScript(script, function (result) {
      if (result === "" || result == null) {
        log(
          "[diag] evalScript 返回空值；若仅在第二次打开 PS 后出现，可尝试「扩展开发模式」或清理 CEP 缓存后重载扩展。"
        );
      }
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

  function openUrlInDefaultBrowser(url) {
    var u = String(url || "").trim();
    if (!u) return;
    try {
      if (window.cep && window.cep.util && typeof window.cep.util.openURLInDefaultBrowser === "function") {
        window.cep.util.openURLInDefaultBrowser(u);
        log("已在系统浏览器中打开链接。");
        return;
      }
    } catch (e1) {
      log("打开链接（cep.util）失败: " + (e1 && e1.message ? e1.message : e1));
    }
    callHost('WORD_IMPORT_CEP.openUrlInDefaultBrowser("' + escHostString(u) + '")', function (r) {
      if (r && r.indexOf("OK|") === 0) log("已在系统浏览器中打开链接（Host）。");
      else log("打开浏览器失败: " + String(r || ""));
    });
  }

  function checkForUpdates() {
    log(
      "检查更新（测试）：打开腾讯文档（当前扩展 v=" +
        EXTENSION_BUNDLE_VERSION +
        " build=" +
        BUILD_ID +
        "）。"
    );
    openUrlInDefaultBrowser(UPDATE_DOCS_URL);
  }

  function decodePayload(text) {
    var raw = String(text == null ? "" : text);
    try { raw = decodeURIComponent(raw); } catch (_) {}
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  function getPanelScreenRect() {
    try {
      var sx = Number(window.screenX);
      var sy = Number(window.screenY);
      if (!isFinite(sx)) sx = Number(window.screenLeft);
      if (!isFinite(sy)) sy = Number(window.screenTop);
      var ow = Number(window.outerWidth);
      var oh = Number(window.outerHeight);
      if (!isFinite(sx) || !isFinite(sy) || !isFinite(ow) || !isFinite(oh) || ow <= 0 || oh <= 0) return null;
      return { left: sx, top: sy, right: sx + ow, bottom: sy + oh };
    } catch (_) {
      return null;
    }
  }

  function buildCandidatePromptText(previewInfo) {
    var list = (previewInfo && previewInfo.candidates) ? previewInfo.candidates : [];
    if (!list.length) return "";
    var lines = [];
    lines.push("请选择目标气泡编号（1-" + list.length + "），取消则放弃本次投放：");
    for (var i = 0; i < list.length; i++) {
      var c = list[i] || {};
      var w = Math.max(0, Number(c.right) - Number(c.left));
      var h = Math.max(0, Number(c.bottom) - Number(c.top));
      var dist = Number(c.distancePx);
      var distText = isFinite(dist) ? dist.toFixed(1) : "?";
      lines.push(
        (i + 1) + ". 距离 " + distText + "px，框 " + Math.round(w) + "x" + Math.round(h) +
        (c.layerName ? ("，" + c.layerName) : "")
      );
    }
    return lines.join("\n");
  }

  function pickBubbleCandidate(previewInfo) {
    var list = (previewInfo && previewInfo.candidates) ? previewInfo.candidates : [];
    if (!list.length) return 0;
    var answer = window.prompt(buildCandidatePromptText(previewInfo), "1");
    if (answer == null) return null;
    var n = parseInt(String(answer).trim(), 10);
    if (!isFinite(n) || n < 1 || n > list.length) return -1;
    return n - 1;
  }

  function exportDocxToJsxdata() {
    log("开始导出（将弹出 Word 文件选择框）...");
    var script = 'WORD_IMPORT_CEP.exportDocxToJsxdata("","","' + escHostString(repoRootHint) + '")';
    callHost(script, function (result) {
      if (!result || result.indexOf("OK|") !== 0) {
        // #region agent log
        try {
          fetch("http://127.0.0.1:7706/ingest/e060ea63-a144-43df-ae0b-adf401789755", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Debug-Session-Id": "34d76a"
            },
            body: JSON.stringify({
              sessionId: "34d76a",
              hypothesisId: "H_export_client",
              location: "main.js:exportDocxToJsxdata",
              message: "export ERR host result",
              data: { resultPreview: String(result || "").slice(0, 900) },
              timestamp: Date.now()
            })
          }).catch(function () {});
        } catch (_) {}
        // #endregion
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

  function refreshBubbleBoxesStatus() { /* deprecated */ }

  function stopPlacementWatch() {
    if (placementArmTimerId) {
      try { window.clearTimeout(placementArmTimerId); } catch (_) {}
      placementArmTimerId = 0;
    }
    if (placementIntervalId) {
      try { window.clearInterval(placementIntervalId); } catch (_) {}
      placementIntervalId = 0;
    }
    // Keep last down state across arm cycles; prevents false retrigger while holding mouse.
    hoverStableSinceTs = 0;
    lastProbeCursorX = NaN;
    lastProbeCursorY = NaN;
    requireMouseUpBeforeTrigger = false;
  }

  function startPlacementWatch() {
    if (placementIntervalId) return;
    if (!pendingQuote) {
      log("调试: 未启动轮询（pendingQuote 为空）");
      return;
    }
    if (!probePathUtf8) {
      log("调试: 未启动轮询（probePath 为空），尝试重新绑定探针。");
      fetchProbePathFromHost();
      return;
    }
    placementIntervalId = window.setInterval(tickPlacementWatch, PLACEMENT_POLL_MS);
    log("调试: 画布点击轮询已启动。");
  }

  function schedulePlacementArm() {
    stopPlacementWatch();
    if (!pendingQuote) return;
    requireMouseUpBeforeTrigger = true;
    log("调试: 已进入待点击状态（400ms 后开始监听）。");
    placementArmTimerId = window.setTimeout(function () {
      placementArmTimerId = 0;
      startPlacementWatch();
    }, 400);
  }

  function tickPlacementWatch() {
    if (!pendingQuote || isPlacingQuote) {
      return;
    }
    if (!probePathUtf8 || !window.cep || !window.cep.fs) {
      return;
    }
    var hbNow = Date.now();
    if (hbNow - lastPlacementHeartbeatTs > 2400) {
      lastPlacementHeartbeatTs = hbNow;
      log("调试: 监听中，等待在 PS 画布单击...");
    }
    var res = window.cep.fs.readFile(probePathUtf8);
    if (!res || res.err !== 0 || res.data == null) {
      var tProbe = Date.now();
      if (tProbe - lastProbeReadFailLogTs > 3000) {
        lastProbeReadFailLogTs = tProbe;
        log(
          "探针 readFile 失败: err=" + String(res && res.err != null ? res.err : "n/a") +
            " path=" + String(probePathUtf8 || "").slice(0, 120)
        );
      }
      return;
    }
    var o = null;
    try {
      var rawProbe = String(res.data == null ? "" : res.data);
      if (rawProbe.length && rawProbe.charCodeAt(0) === 0xfeff) {
        rawProbe = rawProbe.slice(1);
      }
      o = JSON.parse(rawProbe);
    } catch (_) {
      var t1 = Date.now();
      if (t1 - lastTickEarlyLogTs > 1000) {
        lastTickEarlyLogTs = t1;
      }
      return;
    }
    if (!o || (o.probeVersion || 0) < 2) {
      if (!warnedProbeV1) {
        warnedProbeV1 = true;
        log("画布点击投放需要新版鼠标探针：请重启 Photoshop 一次。");
      }
      return;
    }
    var down = !!o.lmbDown;
    var wasDown = !!lastProbeLmbDown;
    var edgeDown = down && !wasDown;
    var edgeUp = !down && wasDown;
    lastProbeLmbDown = down;
    if (requireMouseUpBeforeTrigger) {
      if (!down) requireMouseUpBeforeTrigger = false;
      return;
    }
    var nowTs = Date.now();
    if (nowTs - lastPlacementTriggerTs < 600) return;
    if (nowTs < suppressTriggerUntilTs) {
      return;
    }

    var okFg = !!o.foregroundIsPhotoshop;
    var okAligned = !!o.cursorFgAligned;
    var okInClient = !!o.cursorInForegroundClient;
    if (!okFg || !okAligned || !okInClient) {
      hoverStableSinceTs = 0;
      lastProbeCursorX = NaN;
      lastProbeCursorY = NaN;
      if (nowTs - lastPlacementRejectLogTs > 1200) {
        lastPlacementRejectLogTs = nowTs;
        log(
          "点击未触发：foregroundIsPhotoshop=" + okFg +
            ", cursorFgAligned=" + okAligned +
            ", cursorInForegroundClient=" + okInClient +
            ", fgProc=" + String(o.foregroundProcessName || "")
        );
      }
      return;
    }

    var panelRect = getPanelScreenRect();
    if (panelRect) {
      var inPanel =
        Number(o.cursorX) >= panelRect.left &&
        Number(o.cursorX) < panelRect.right &&
        Number(o.cursorY) >= panelRect.top &&
        Number(o.cursorY) < panelRect.bottom;
      if (inPanel) {
        return;
      }
    }

    // Primary trigger: release edge (mouseup). For color sampler, point is committed after click completes.
    var shouldAttempt = edgeUp;
    if (shouldAttempt) {
      lastPlacementTriggerTs = nowTs;
      log("检测到画布点击，开始直投...");
      triggerInsertQuoteToPs(pendingQuote, { directPlace: true, probeSnapshot: o });
      return;
    }

    // Keep one explicit click -> one placement. Do not auto-trigger by hover.
  }

  function triggerInsertQuoteToPs(item, options) {
    stopPlacementWatch();
    isPlacingQuote = true;
    insertQuoteToPs(item, options || {}, function () {
      isPlacingQuote = false;
      if (pendingQuote) schedulePlacementArm();
    });
  }

  function fetchProbePathFromHost() {
    callHost("WORD_IMPORT_CEP.getCursorProbePathEncoded()", function (r) {
      if (r && r.indexOf("OK|") === 0) {
        try {
          probePathUtf8 = decodeURIComponent(String(r.slice(3)));
        } catch (_) {
          probePathUtf8 = String(r.slice(3));
        }
        log("画布点击投放：已连接探针文件。");
      } else {
        probePathUtf8 = "";
        log("画布点击投放：无法读取探针路径（" + String(r || "") + "）。");
      }
    });
  }

  function bootstrapCursorProbe() {
    callHost(
      'WORD_IMPORT_CEP.restartCursorDaemonForProbeV2("' + escHostString(repoRootHint) + '")',
      function (r) {
        if (r && r.indexOf("OK|") === 0) {
          log("鼠标助手已就绪（画布点击投放）。");
        } else {
          log("鼠标助手启动：" + String(r || "") + "。");
        }
        window.setTimeout(fetchProbePathFromHost, 250);
      }
    );
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

  function selectQuoteItem(item, rowEl) {
    if (pendingRowEl && pendingRowEl !== rowEl) {
      try { pendingRowEl.classList.remove("quoteItemSelected"); } catch (_) {}
    }
    pendingQuote = item;
    pendingRowEl = rowEl;
    try { rowEl.classList.add("quoteItemSelected"); } catch (_) {}
    log(
      "已选择 #" + item.page + " 段 " + item.paragraph +
        "：请切换到 Photoshop，在画布上单击要投放的位置。"
    );
    callHost("WORD_IMPORT_CEP.beginSamplerAnchorMode()", function (r) {
      if (r && r.indexOf("OK|") === 0) {
        log("已切换到颜色取样点工具，请在画布单击一次目标位置。");
      } else {
        log("切换颜色取样点工具失败，将继续使用原有点击映射: " + String(r || "UNKNOWN_ERROR"));
      }
    });
    suppressTriggerUntilTs = Date.now() + 700;
    schedulePlacementArm();
  }

  function clearPendingSelection() {
    if (pendingRowEl) {
      try { pendingRowEl.classList.remove("quoteItemSelected"); } catch (_) {}
    }
    pendingQuote = null;
    pendingRowEl = null;
    stopPlacementWatch();
  }

  function insertQuoteToPs(item, options, onFlowEnd) {
    options = options || {};
    function end() {
      if (typeof onFlowEnd === "function") {
        try { onFlowEnd(); } catch (_) {}
      }
    }
    if (!item) {
      log("未选择台词：请先点击列表中的一条。");
      end();
      return;
    }
    var payload = {
      page: item.page,
      paragraph: item.paragraph,
      text: item.text,
      segments: item.segments || [],
      anchorMode: "fraction",
      fracX: 0.5,
      fracY: 0.5,
      useCursorProbe: true,
      textAlign: getCeTextAlign()
    };

    if (options.directPlace) {
      payload.placeAtCursorOnly = true;
      if (options.probeSnapshot) payload.probeSnapshot = options.probeSnapshot;
      var payloadText0 = encodeURIComponent(JSON.stringify(payload));
      var script0 =
        'WORD_IMPORT_CEP.insertBubbleText("' +
        escHostString(payloadText0) +
        '","' +
        escHostString(repoRootHint) +
        '")';
      callHost(script0, function (result0) {
        function finalizeSamplerAndEnd() {
          callHost("WORD_IMPORT_CEP.finishSamplerAnchorMode()", function (r2) {
            if (!(r2 && r2.indexOf("OK|") === 0)) {
              log("恢复移动工具/清理取样点失败: " + String(r2 || "UNKNOWN_ERROR"));
            }
            end();
          });
        }
        if (result0 && result0.indexOf("OK|") === 0) {
          var info0 = decodePayload(result0.slice(3)) || {};
          var anchorMsg0 = "（按鼠标点击位置直投）";
          if (info0.anchorUsed) anchorMsg0 += "（anchor: " + info0.anchorUsed + "）";
          log("已投放到 PS: " + (info0.layerName || ("#" + item.page + "-" + item.paragraph)) + anchorMsg0);
          if (String(info0.debugAnchorSource || "") === "colorSampler") {
            log("锚点来源：已用颜色取样点坐标投放（缩放无关）。");
          } else {
            log("锚点来源：未检测到颜色取样点，已回退到画布点击映射。");
          }
          var mapHint0 = describeScreenToDocFail(info0.debugScreenToDocFail);
          if (mapHint0) log("坐标映射: " + mapHint0);
          clearPendingSelection();
          log("已取消当前对白选中。");
        } else {
          log("投放失败: " + (result0 || "UNKNOWN_ERROR"));
        }
        finalizeSamplerAndEnd();
      });
      return;
    }

    var previewPayload = JSON.parse(JSON.stringify(payload));
    previewPayload.previewCandidatesOnly = true;
    previewPayload.candidateTopN = 5;
    var previewText = encodeURIComponent(JSON.stringify(previewPayload));
    var previewScript = 'WORD_IMPORT_CEP.insertBubbleText("' + escHostString(previewText) + '","' + escHostString(repoRootHint) + '")';
    callHost(previewScript, function (previewResult) {
      if (!previewResult || previewResult.indexOf("OK|") !== 0) {
        log("获取候选气泡失败: " + (previewResult || "UNKNOWN_ERROR"));
        end();
        return;
      }
      var previewInfo = decodePayload(previewResult.slice(3)) || {};
      var picked = null;
      if (options.autoPickNearest) {
        var list = (previewInfo && previewInfo.candidates) ? previewInfo.candidates : [];
        picked = list.length ? 0 : -1;
      } else {
        picked = pickBubbleCandidate(previewInfo);
      }
      if (picked === null) {
        log("已取消本次投放。");
        end();
        return;
      }
      if (picked === -1) {
        if (options.autoPickNearest) {
          log("本次点击附近未找到可用对白框，请重试或重新生成 mask。");
          end();
          return;
        }
        log("输入无效：请选择 1-" + ((previewInfo.candidates && previewInfo.candidates.length) || 0) + "。");
        end();
        return;
      }
      payload.selectedBubbleIndex = picked;
      payload.useCursorProbe = false;
      payload.anchorMode = "docPoint";
      if (isFinite(Number(previewInfo.hintDocX)) && isFinite(Number(previewInfo.hintDocY))) {
        payload.docX = Number(previewInfo.hintDocX);
        payload.docY = Number(previewInfo.hintDocY);
      }
      var payloadText = encodeURIComponent(JSON.stringify(payload));
      var script = 'WORD_IMPORT_CEP.insertBubbleText("' + escHostString(payloadText) + '","' + escHostString(repoRootHint) + '")';
      callHost(script, function (result) {
        if (result && result.indexOf("OK|") === 0) {
          var info = decodePayload(result.slice(3)) || {};
          var anchorMsg = "（按鼠标位置匹配对白框）";
          if (info.anchorUsed === "selectionBubbleSnap") anchorMsg = "（按 PS 小选区吸附对白框）";
          else if (info.anchorUsed === "bubbleSnap") anchorMsg = "（已吸附到识别对白框）";
          else if (info.anchorUsed === "cursorProbe") anchorMsg = "（按系统鼠标坐标投放）";
          else if (info.anchorUsed === "selectionCenter") anchorMsg = "（按 PS 选区中心精确投放）";
          if (typeof info.detectedBubbles === "number") {
            anchorMsg += "（候选框: " + info.detectedBubbles + "）";
          }
          if (info.bubbleSource) {
            anchorMsg += "（来源: " + info.bubbleSource + "）";
          }
          if (info.maskPath) {
            anchorMsg += "（mask: " + info.maskPath + "）";
          }
          log("已投放到 PS: " + (info.layerName || ("#" + item.page + "-" + item.paragraph)) + anchorMsg);
          log(
            "调试: anchor=" + (info.anchorUsed || "none") +
            ", bubbleSource=" + (info.bubbleSource || "unknown") +
            ", maskStatus=" + (info.maskStatus || "") +
            ", maskPass=" + (info.maskPass || "")
          );
          var mapHint = describeScreenToDocFail(info.debugScreenToDocFail);
          if (mapHint) log("坐标映射: " + mapHint);
        } else {
          log("投放失败: " + (result || "UNKNOWN_ERROR"));
        }
        end();
      });
    });
  }

  function renderQuoteList() {
    quoteList.innerHTML = "";
    var pageObj = getSelectedPageObj();
    var items = (pageObj && pageObj.items) ? pageObj.items : [];
    if (!items.length) {
      var empty = document.createElement("div");
      empty.className = "quoteEmpty";
      empty.textContent = "当前页无可选台词。";
      quoteList.appendChild(empty);
      return;
    }
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var row = document.createElement("div");
      row.className = "quoteItem";
      row.setAttribute("role", "button");
      row.tabIndex = 0;

      var meta = document.createElement("div");
      meta.className = "quoteMeta";
      meta.textContent = "#" + it.page + " · 段落 " + it.paragraph;
      row.appendChild(meta);

      var text = document.createElement("div");
      text.className = "quoteText";
      text.textContent = it.text;
      row.appendChild(text);

      (function (item, el) {
        el.addEventListener("click", function () {
          selectQuoteItem(item, el);
        });
        el.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            selectQuoteItem(item, el);
          }
        });
      })(it, row);

      if (pendingQuote &&
          String(pendingQuote.page) === String(it.page) &&
          Number(pendingQuote.paragraph) === Number(it.paragraph)) {
        row.classList.add("quoteItemSelected");
        pendingRowEl = row;
      }

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
    // The host (host\main.jsx) is now self-contained: runtime scripts live in
    // host\repo\ inside the extension itself, so no client-side hint is needed.
    // We still read the legacy host\repo_path.txt silently to preserve old setups
    // (older installer versions or dev workflows) without spamming the log.
    try {
      if (!window.__adobe_cep__ || !window.__adobe_cep__.getSystemPath || !window.cep || !window.cep.fs) return;
      var extPath = window.__adobe_cep__.getSystemPath("extension");
      if (!extPath) return;
      var marker = extPath + "/host/repo_path.txt";
      var res = window.cep.fs.readFile(marker);
      if (res && res.err === 0) {
        repoRootHint = sanitizeRepoText(res.data);
      }
    } catch (_) {}
  }

  function logRuntimeSource() {
    callHost("WORD_IMPORT_CEP.getRuntimeSource()", function (r) {
      var s = String(r || "");
      if (s.indexOf("OK|") !== 0) return;
      var rest = s.slice(3);
      var sep = rest.indexOf("|");
      var kind = sep >= 0 ? rest.slice(0, sep) : rest;
      var path = sep >= 0 ? rest.slice(sep + 1) : "";
      var label;
      if (kind === "bundled") label = "脚本运行时来源：内置（host\\repo）";
      else if (kind === "legacy") label = "脚本运行时来源：外部（兼容旧版安装）";
      else if (kind === "missing") label = "脚本运行时缺失，请重新运行 install_cep.ps1";
      else label = "脚本运行时来源：" + kind;
      log(label + (path ? "，路径=" + path : ""));
    });
  }

  document.getElementById("btnOpenPanel").addEventListener("click", function () {
    runFromRepo("import_panel.jsx");
  });

  (function bindCheckUpdate() {
    var el = document.getElementById("btnCheckUpdate");
    if (!el) return;
    el.addEventListener("click", function () {
      if (!isCepHost()) {
        log("检查更新需要在 Photoshop CEP 面板内使用（需联网）。");
        return;
      }
      checkForUpdates();
    });
  })();

  try {
    var titleEl = document.querySelector(".appTitle");
    if (titleEl) {
      titleEl.addEventListener("click", function () {
        try {
          titleTapCount++;
          if (titleTapTimer) window.clearTimeout(titleTapTimer);
          titleTapTimer = window.setTimeout(function () { titleTapCount = 0; }, 800);
          if (titleTapCount >= 6) {
            titleTapCount = 0;
            if (devTools) {
              devTools.style.display = (devTools.style.display === "none" || !devTools.style.display) ? "block" : "none";
              log("开发者工具区已" + (devTools.style.display === "none" ? "隐藏" : "显示") + "。");
            }
          }
        } catch (_) {}
      });
    }
  } catch (_) {}

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

  function bindAlignBtn(id, alignKey) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("click", function () {
      setCeTextAlign(alignKey);
    });
  }
  bindAlignBtn("btnAlignLeft", "left");
  bindAlignBtn("btnAlignCenter", "center");
  bindAlignBtn("btnAlignRight", "right");

  document.getElementById("btnCalibPoint1").addEventListener("click", function () {
    callHost('WORD_IMPORT_CEP.captureCalibrationPoint("' + escHostString(repoRootHint) + '")', function (result) {
      if (!result || result.indexOf("OK|") !== 0) {
        log("记录基准点1失败: " + (result || "UNKNOWN_ERROR"));
        return;
      }
      log("已记录基准点 1。请在 PS 里框选第二个基准点后点“记录基准点2并完成”。");
    });
  });

  document.getElementById("btnCalibPoint2").addEventListener("click", function () {
    callHost('WORD_IMPORT_CEP.captureCalibrationPoint("' + escHostString(repoRootHint) + '")', function (r1) {
      if (!r1 || r1.indexOf("OK|") !== 0) {
        log("记录基准点2失败: " + (r1 || "UNKNOWN_ERROR"));
        return;
      }
      callHost('WORD_IMPORT_CEP.finishCalibration("' + escHostString(repoRootHint) + '")', function (r2) {
        if (!r2 || r2.indexOf("OK|") !== 0) {
          log("完成校准失败: " + (r2 || "UNKNOWN_ERROR"));
          return;
        }
        log("两点校准完成，后续拖拽将应用校准参数。");
      });
    });
  });

  document.getElementById("btnCalibReset").addEventListener("click", function () {
    callHost('WORD_IMPORT_CEP.clearCalibration("' + escHostString(repoRootHint) + '")', function (result) {
      if (!result || result.indexOf("OK|") !== 0) {
        log("清除校准失败: " + (result || "UNKNOWN_ERROR"));
        return;
      }
      log("已清除校准参数。");
    });
  });

  document.getElementById("btnLockSelRect").addEventListener("click", function () {
    callHost('WORD_IMPORT_CEP.lockSelectionRect()', function (result) {
      if (!result || result.indexOf("OK|") !== 0) {
        log("锁定目标框失败: " + (result || "UNKNOWN_ERROR"));
        return;
      }
      var info = decodePayload(result.slice(3)) || {};
      log(
        "已锁定当前小选区为目标框。source=" + (info.source || "unknown") +
        ", rect=" + JSON.stringify({
          left: info.left,
          top: info.top,
          right: info.right,
          bottom: info.bottom
        })
      );
    });
  });

  document.getElementById("btnClearSelRect").addEventListener("click", function () {
    callHost('WORD_IMPORT_CEP.clearLockedSelectionRect()', function (result) {
      if (!result || result.indexOf("OK|") !== 0) {
        log("清除锁定目标框失败: " + (result || "UNKNOWN_ERROR"));
        return;
      }
      log("已清除锁定目标框。");
    });
  });

  document.getElementById("btnDiagSel").addEventListener("click", function () {
    callHost('WORD_IMPORT_CEP.diagnoseSelection()', function (result) {
      if (!result || result.indexOf("OK|") !== 0) {
        log("诊断选区失败: " + (result || "UNKNOWN_ERROR"));
        return;
      }
      var info = decodePayload(result.slice(3)) || {};
      var b = info.bounds || null;
      var am = info.actionManager || null;
      log(
        "选区诊断: tool=" + (info.tool || "unknown") +
        ", bounds=" + (b ? JSON.stringify(b) : "null") +
        ", AM=" + (am ? JSON.stringify(am) : "null") +
        ", locked=" + (!!info.hasLockedRect)
      );
    });
  });

  document.getElementById("btnExportDocx").addEventListener("click", function () {
    exportDocxToJsxdata();
  });

  document.getElementById("btnGenMasks").addEventListener("click", function () {
    callHost('WORD_IMPORT_CEP.generateBubbleMasks("' + escHostString(repoRootHint) + '")', function (result) {
      if (!result || result.indexOf("OK|") !== 0) {
        log("生成 mask 失败: " + (result || "UNKNOWN_ERROR"));
        return;
      }
      var info = decodePayload(result.slice(3)) || {};
      log("已生成黑白 mask：输出目录=" + (info.maskDir || "unknown"));
      if (info.vizDir) log("可视化检查图目录: " + info.vizDir);
      if (info.shellOutput)
        log("mask 日志: " + String(info.shellOutput).replace(/\s+/g, " ").trim());
      if (info.launcher === "powershell-visible-detached")
        log("提示：已在独立 PowerShell 窗口中运行；处理完成前请勿关闭该窗口。");
    });
  });

  document.getElementById("btnReloadQuotes").addEventListener("click", function () {
    reloadQuotes();
  });

  pageSelect.addEventListener("change", function () {
    stopPlacementWatch();
    pendingQuote = null;
    pendingRowEl = null;
    renderQuoteList();
  });

  updateAlignToolbarUi();
  renderPageOptions();
  renderQuoteList();

  if (!isCepHost()) {
    showNoCepBanner();
    log(
      "漫画汉化导入助手 1.2 已加载，但未检测到 CEP（无法与 Photoshop 通信）。build=" +
        BUILD_ID +
        " v=" +
        EXTENSION_BUNDLE_VERSION
    );
    return;
  }

  initRepoRootHint();
  bootstrapCursorProbe();
  reloadQuotes();
  log(
    "漫画汉化导入助手 1.2（CEP）已启动。build=" + BUILD_ID + " v=" + EXTENSION_BUNDLE_VERSION
  );
  callHost("WORD_IMPORT_CEP.ping()", function (r) {
    var s = String(r || "");
    if (s.indexOf("PONG") >= 0) log("Host 预热成功: " + s.slice(0, 96));
    else log("[diag] Host 预热: " + (s || "(空响应)"));
  });
  logRuntimeSource();

  document.addEventListener("visibilitychange", function () {
    try {
      if (document.hidden) stopPlacementWatch();
    } catch (_) {}
  });
})();
