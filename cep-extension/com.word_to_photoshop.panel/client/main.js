(function () {
  var BUILD_ID = "2026-05-01T13:00+08 directPlace-v1";
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
  var requireMouseUpBeforeTrigger = false;
  var suppressTriggerUntilTs = 0;

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

  function debugLog(hypothesisId, location, message, data) {
    // #region agent log
    try {
      if (typeof fetch === "function") {
        fetch('http://127.0.0.1:7706/ingest/e060ea63-a144-43df-ae0b-adf401789755',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'2cdb9a'},body:JSON.stringify({sessionId:'2cdb9a',runId:'run-client-placement',hypothesisId:hypothesisId,location:location,message:message,data:data||{},timestamp:Date.now()})}).catch(()=>{});
      }
    } catch (_) {}
    // #endregion
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
    debugLog("H6", "client/main.js:pickBubbleCandidate:entry", "candidate picker opened", {
      candidateCount: list.length,
      detectedBubbles: previewInfo && previewInfo.detectedBubbles != null ? previewInfo.detectedBubbles : null,
      precomputedStatus: previewInfo && previewInfo.precomputedStatus ? previewInfo.precomputedStatus : "",
      bubbleSource: previewInfo && previewInfo.bubbleSource ? previewInfo.bubbleSource : ""
    });
    if (!list.length) return 0;
    var answer = window.prompt(buildCandidatePromptText(previewInfo), "1");
    debugLog("H7", "client/main.js:pickBubbleCandidate:answer", "raw answer received", {
      answer: answer == null ? null : String(answer)
    });
    if (answer == null) return null;
    var n = parseInt(String(answer).trim(), 10);
    debugLog("H7", "client/main.js:pickBubbleCandidate:parsed", "parsed answer", {
      parsed: isFinite(n) ? n : null,
      min: 1,
      max: list.length
    });
    if (!isFinite(n) || n < 1 || n > list.length) return -1;
    return n - 1;
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
    placementIntervalId = window.setInterval(tickPlacementWatch, 30);
    // #region agent log
    debugLog("H5", "client/main.js:startPlacementWatch", "watch loop started", {
      hasPendingQuote: !!pendingQuote,
      probePathLen: probePathUtf8 ? String(probePathUtf8).length : 0
    });
    // #endregion
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
      // #region agent log
      debugLog("H6", "client/main.js:tickPlacementWatch", "tick early return pending/placing", {
        hasPendingQuote: !!pendingQuote,
        isPlacingQuote: !!isPlacingQuote
      });
      // #endregion
      return;
    }
    if (!probePathUtf8 || !window.cep || !window.cep.fs) {
      // #region agent log
      debugLog("H6", "client/main.js:tickPlacementWatch", "tick early return probe path or cep fs unavailable", {
        hasProbePath: !!probePathUtf8,
        hasCepObj: !!window.cep,
        hasCepFs: !!(window.cep && window.cep.fs)
      });
      // #endregion
      return;
    }
    var hbNow = Date.now();
    if (hbNow - lastPlacementHeartbeatTs > 1200) {
      lastPlacementHeartbeatTs = hbNow;
      log("调试: 监听中，等待在 PS 画布单击...");
    }
    var res = window.cep.fs.readFile(probePathUtf8);
    if (!res || res.err !== 0 || res.data == null) {
      var t0 = Date.now();
      if (t0 - lastTickEarlyLogTs > 1000) {
        lastTickEarlyLogTs = t0;
        // #region agent log
        debugLog("H6", "client/main.js:tickPlacementWatch", "probe read failed", {
          hasRes: !!res,
          err: res ? Number(res.err) : null,
          hasData: !!(res && res.data != null),
          probePath: String(probePathUtf8 || "")
        });
        // #endregion
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
        // #region agent log
        debugLog("H7", "client/main.js:tickPlacementWatch", "probe json parse failed", {
          dataHead: String(res.data || "").slice(0, 120)
        });
        // #endregion
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
      // #region agent log
      debugLog("H10", "client/main.js:tickPlacementWatch", "trigger suppressed by post-select cooldown", {
        remainMs: suppressTriggerUntilTs - nowTs
      });
      // #endregion
      return;
    }

    var okFg = !!o.foregroundIsPhotoshop;
    var okAligned = !!o.cursorFgAligned;
    var okInClient = !!o.cursorInForegroundClient;
    if (!okFg || !okAligned || !okInClient) {
      // #region agent log
      debugLog("H2", "client/main.js:tickPlacementWatch", "probe rejected by foreground constraints", {
        okFg: okFg,
        okAligned: okAligned,
        okInClient: okInClient,
        fgProc: String(o.foregroundProcessName || "")
      });
      // #endregion
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
        // #region agent log
        debugLog("H9", "client/main.js:tickPlacementWatch", "cursor is inside CEP panel rect; ignore trigger", {
          cursorX: Number(o.cursorX),
          cursorY: Number(o.cursorY),
          panelLeft: panelRect.left,
          panelTop: panelRect.top,
          panelRight: panelRect.right,
          panelBottom: panelRect.bottom
        });
        // #endregion
        return;
      }
    }

    // Primary trigger: release edge (mouseup). For color sampler, point is committed after click completes.
    var shouldAttempt = edgeUp;
    if (shouldAttempt) {
      // #region agent log
      debugLog("H1", "client/main.js:tickPlacementWatch", "trigger condition passed", {
        down: down,
        edgeDown: edgeDown,
        edgeUp: edgeUp,
        cursorX: Number(o.cursorX),
        cursorY: Number(o.cursorY)
      });
      // #endregion
      lastPlacementTriggerTs = nowTs;
      log("检测到画布点击，开始直投...");
      triggerInsertQuoteToPs(pendingQuote, { directPlace: true, probeSnapshot: o });
      return;
    }

    // Keep one explicit click -> one placement. Do not auto-trigger by hover.
  }

  function triggerInsertQuoteToPs(item, options) {
    // #region agent log
    debugLog("H3", "client/main.js:triggerInsertQuoteToPs", "insert trigger entered", {
      hasItem: !!item,
      directPlace: !!(options && options.directPlace),
      isPlacingQuote: !!isPlacingQuote
    });
    // #endregion
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
    // #region agent log
    debugLog("H1", "client/main.js:selectQuoteItem", "quote selected and armed", {
      page: String(item && item.page || ""),
      paragraph: Number(item && item.paragraph),
      hasSegments: !!(item && item.segments && item.segments.length)
    });
    // #endregion
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
      useCursorProbe: true
    };

    if (options.directPlace) {
      payload.placeAtCursorOnly = true;
      if (options.probeSnapshot) payload.probeSnapshot = options.probeSnapshot;
      // #region agent log
      debugLog("H3", "client/main.js:insertQuoteToPs", "sending directPlace request", {
        page: String(payload.page || ""),
        paragraph: Number(payload.paragraph),
        placeAtCursorOnly: !!payload.placeAtCursorOnly,
        hasProbeSnapshot: !!payload.probeSnapshot,
        probeCursorX: payload.probeSnapshot ? Number(payload.probeSnapshot.cursorX) : null,
        probeCursorY: payload.probeSnapshot ? Number(payload.probeSnapshot.cursorY) : null,
        probeClientL: payload.probeSnapshot ? Number(payload.probeSnapshot.clientL) : null,
        probeClientT: payload.probeSnapshot ? Number(payload.probeSnapshot.clientT) : null,
        probeClientR: payload.probeSnapshot ? Number(payload.probeSnapshot.clientR) : null,
        probeClientB: payload.probeSnapshot ? Number(payload.probeSnapshot.clientB) : null
      });
      // #endregion
      var payloadText0 = encodeURIComponent(JSON.stringify(payload));
      var script0 =
        'WORD_IMPORT_CEP.insertBubbleText("' +
        escHostString(payloadText0) +
        '","' +
        escHostString(repoRootHint) +
        '")';
      callHost(script0, function (result0) {
        // #region agent log
        debugLog("H4", "client/main.js:insertQuoteToPs:directPlaceCallback", "host returned directPlace result", {
          okPrefix: !!(result0 && result0.indexOf("OK|") === 0),
          resultHead: String(result0 || "").slice(0, 160)
        });
        // #endregion
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
          // #region agent log
          debugLog("H8", "client/main.js:insertQuoteToPs:directPlaceCallback", "decoded host placement result", {
            anchorUsed: String(info0.anchorUsed || ""),
            anchorDocX: Number(info0.anchorDocX),
            anchorDocY: Number(info0.anchorDocY),
            x: Number(info0.x),
            y: Number(info0.y),
            debugAnchorSource: String(info0.debugAnchorSource || ""),
            debugSamplerCount: info0.debugSamplerCount == null ? null : Number(info0.debugSamplerCount),
            debugSamplerIndex: info0.debugSamplerIndex == null ? null : Number(info0.debugSamplerIndex),
            debugSamplerX: info0.debugSamplerX == null ? null : Number(info0.debugSamplerX),
            debugSamplerY: info0.debugSamplerY == null ? null : Number(info0.debugSamplerY),
            debugProbeFromPayload: !!info0.debugProbeFromPayload,
            debugProbeAvailable: !!info0.debugProbeAvailable,
            debugPointFromProbe: !!info0.debugPointFromProbe,
            debugProbeCursorX: info0.debugProbeCursorX == null ? null : Number(info0.debugProbeCursorX),
            debugProbeCursorY: info0.debugProbeCursorY == null ? null : Number(info0.debugProbeCursorY),
            debugScreenToDocFail: String(info0.debugScreenToDocFail || "")
          });
          // #endregion
          var anchorMsg0 = "（按鼠标点击位置直投）";
          if (info0.anchorUsed) anchorMsg0 += "（anchor: " + info0.anchorUsed + "）";
          log("已投放到 PS: " + (info0.layerName || ("#" + item.page + "-" + item.paragraph)) + anchorMsg0);
          if (String(info0.debugAnchorSource || "") === "colorSampler") {
            log("锚点来源：已用颜色取样点坐标投放（缩放无关）。");
          } else {
            log("锚点来源：未检测到颜色取样点，已回退到画布点击映射。");
          }
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
        debugLog("H8", "client/main.js:insertQuoteToPs:previewError", "preview call failed", {
          result: String(previewResult || "")
        });
        end();
        return;
      }
      var previewInfo = decodePayload(previewResult.slice(3)) || {};
      debugLog("H6", "client/main.js:insertQuoteToPs:previewOk", "preview result decoded", {
        candidateCount: previewInfo && previewInfo.candidates ? previewInfo.candidates.length : 0,
        detectedBubbles: previewInfo && previewInfo.detectedBubbles != null ? previewInfo.detectedBubbles : null,
        precomputedStatus: previewInfo && previewInfo.precomputedStatus ? previewInfo.precomputedStatus : "",
        bubbleSource: previewInfo && previewInfo.bubbleSource ? previewInfo.bubbleSource : ""
      });
      var picked = null;
      if (options.autoPickNearest) {
        var list = (previewInfo && previewInfo.candidates) ? previewInfo.candidates : [];
        picked = list.length ? 0 : -1;
      } else {
        picked = pickBubbleCandidate(previewInfo);
      }
      if (picked === null) {
        log("已取消本次投放。");
        debugLog("H7", "client/main.js:insertQuoteToPs:cancelled", "user cancelled candidate pick", {});
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
        debugLog("H7", "client/main.js:insertQuoteToPs:invalid", "user input invalid for candidate range", {
          candidateCount: previewInfo && previewInfo.candidates ? previewInfo.candidates.length : 0
        });
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
      debugLog("H8", "client/main.js:insertQuoteToPs:finalPayload", "sending final insert payload", {
        selectedBubbleIndex: payload.selectedBubbleIndex,
        anchorMode: payload.anchorMode,
        docX: payload.docX,
        docY: payload.docY
      });
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
    debugLog("H1", "client/main.js:reloadQuotes:start", "reloadQuotes invoked", {
      repoRootHint: String(repoRootHint || "")
    });
    var script = 'WORD_IMPORT_CEP.listQuotes("' + escHostString(repoRootHint) + '")';
    callHost(script, function (result) {
      debugLog("H2", "client/main.js:reloadQuotes:result", "listQuotes raw result", {
        okPrefix: !!(result && result.indexOf("OK|") === 0),
        resultHead: String(result || "").slice(0, 220)
      });
      if (!result || result.indexOf("OK|") !== 0) {
        quoteState = { pages: [], defaultPage: "001" };
        renderPageOptions();
        renderQuoteList();
        log("读取台词失败: " + (result || "UNKNOWN_ERROR"));
        debugLog("H3", "client/main.js:reloadQuotes:error", "listQuotes returned non-OK", {
          result: String(result || "")
        });
        return;
      }
      var payload = decodePayload(result.slice(3)) || {};
      debugLog("H4", "client/main.js:reloadQuotes:payload", "decoded payload summary", {
        defaultPage: String(payload.defaultPage || ""),
        pagesCount: payload.pages && payload.pages.length ? payload.pages.length : 0
      });
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

  initRepoRootHint();
  bootstrapCursorProbe();
  renderPageOptions();
  renderQuoteList();
  reloadQuotes();
  log("漫画汉化导入助手 1.0（CEP）已启动。build=" + BUILD_ID);
})();
