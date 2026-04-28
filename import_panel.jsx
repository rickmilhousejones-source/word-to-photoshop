#target photoshop
#targetengine "word_import_panel_engine"

(function () {
  try {
  if (app.name !== "Adobe Photoshop") {
    alert("请在 Photoshop 中运行此脚本。");
    return;
  }

  $.global.WORD_IMPORT_PANEL_MODE = true;
  var coreFile = new File(File($.fileName).parent.fsName + "/import_to_photoshop.jsx");
  if (!coreFile.exists) {
    alert("找不到 import_to_photoshop.jsx");
    return;
  }
  $.evalFile(coreFile);
  var api = $.global.WORD_IMPORT_API;
  if (!api) {
    alert("导入核心未加载成功。");
    return;
  }

  var state = {
    context: null,
    payload: null,
    dataFile: null,
    cfg: null
  };

  var w = new Window("palette", "Word Import Panel", undefined, { resizeable: true });
  w.orientation = "column";
  w.alignChildren = "fill";

  var bindingPanel = w.add("panel", undefined, "文件绑定");
  bindingPanel.orientation = "column";
  bindingPanel.alignChildren = "fill";
  var psdText = bindingPanel.add("statictext", undefined, "PSD: -");
  var dataText = bindingPanel.add("statictext", undefined, "数据: 未绑定");
  var bindBtns = bindingPanel.add("group");
  var btnRescan = bindBtns.add("button", undefined, "重新扫描");
  var btnChooseData = bindBtns.add("button", undefined, "手动选择数据");

  var previewPanel = w.add("panel", undefined, "页码预览");
  previewPanel.orientation = "column";
  previewPanel.alignChildren = "fill";
  var pageList = previewPanel.add("listbox", undefined, [], { multiselect: false });
  pageList.preferredSize.height = 150;
  var pageInfo = previewPanel.add("statictext", undefined, "页信息: -");

  var cfgPanel = w.add("panel", undefined, "布局参数");
  cfgPanel.orientation = "column";
  cfgPanel.alignChildren = "fill";
  var row1 = cfgPanel.add("group");
  row1.add("statictext", undefined, "字号");
  var inputFontSize = row1.add("edittext", undefined, "");
  inputFontSize.characters = 6;
  row1.add("statictext", undefined, "起始X");
  var inputStartX = row1.add("edittext", undefined, "");
  inputStartX.characters = 6;
  row1.add("statictext", undefined, "起始Y");
  var inputStartY = row1.add("edittext", undefined, "");
  inputStartY.characters = 6;

  var row2 = cfgPanel.add("group");
  row2.add("statictext", undefined, "文本框宽");
  var inputBoxWidth = row2.add("edittext", undefined, "");
  inputBoxWidth.characters = 6;
  row2.add("statictext", undefined, "文本框高");
  var inputBoxHeight = row2.add("edittext", undefined, "");
  inputBoxHeight.characters = 6;
  row2.add("statictext", undefined, "垂直间距");
  var inputVerticalGap = row2.add("edittext", undefined, "");
  inputVerticalGap.characters = 6;

  var row3 = cfgPanel.add("group");
  row3.add("statictext", undefined, "水平间距");
  var inputHorizontalGap = row3.add("edittext", undefined, "");
  inputHorizontalGap.characters = 6;
  var chkAutoGap = row3.add("checkbox", undefined, "自动列间距");
  var chkWrap = row3.add("checkbox", undefined, "自动换列");
  var btnSaveDefaults = row3.add("button", undefined, "保存为默认");

  var actionPanel = w.add("panel", undefined, "导入操作");
  actionPanel.orientation = "row";
  actionPanel.alignChildren = "left";
  var btnImportCurrent = actionPanel.add("button", undefined, "导入当前页");
  var btnImportAll = actionPanel.add("button", undefined, "导入全部页");
  var btnClosePanel = actionPanel.add("button", undefined, "关闭面板");

  var logPanel = w.add("panel", undefined, "日志");
  logPanel.orientation = "column";
  logPanel.alignChildren = "fill";
  var logText = logPanel.add("edittext", undefined, "", { multiline: true, readonly: true, scrolling: true });
  logText.preferredSize.height = 180;
  var logBtns = logPanel.add("group");
  var btnClearLog = logBtns.add("button", undefined, "清空日志");
  var btnCopyLog = logBtns.add("button", undefined, "复制日志");

  function log(msg) {
    var now = new Date();
    var hh = pad2(now.getHours());
    var mm = pad2(now.getMinutes());
    var ss = pad2(now.getSeconds());
    var line = "[" + hh + ":" + mm + ":" + ss + "] " + msg;
    logText.text = logText.text ? (logText.text + "\n" + line) : line;
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function parseNum(value, fallback) {
    var n = parseFloat(value);
    return isNaN(n) ? fallback : n;
  }

  function readCfgInputs() {
    var cfg = state.cfg;
    cfg.fontSizePt = parseNum(inputFontSize.text, cfg.fontSizePt);
    cfg.startX = parseNum(inputStartX.text, cfg.startX);
    cfg.startY = parseNum(inputStartY.text, cfg.startY);
    cfg.boxWidth = parseNum(inputBoxWidth.text, cfg.boxWidth);
    cfg.boxHeight = parseNum(inputBoxHeight.text, cfg.boxHeight);
    cfg.verticalGap = parseNum(inputVerticalGap.text, cfg.verticalGap);
    cfg.horizontalGap = parseNum(inputHorizontalGap.text, cfg.horizontalGap);
    cfg.autoHorizontalGap = !!chkAutoGap.value;
    cfg.wrapToNextColumn = !!chkWrap.value;
  }

  function writeCfgInputs(cfg) {
    inputFontSize.text = String(cfg.fontSizePt);
    inputStartX.text = String(cfg.startX);
    inputStartY.text = String(cfg.startY);
    inputBoxWidth.text = String(cfg.boxWidth);
    inputBoxHeight.text = String(cfg.boxHeight);
    inputVerticalGap.text = String(cfg.verticalGap);
    inputHorizontalGap.text = String(cfg.horizontalGap);
    chkAutoGap.value = !!cfg.autoHorizontalGap;
    chkWrap.value = !!cfg.wrapToNextColumn;
  }

  function refreshPages() {
    pageList.removeAll();
    if (!state.payload || !state.payload.pages || !state.payload.pages.length) {
      pageInfo.text = "页信息: -";
      return;
    }
    for (var i = 0; i < state.payload.pages.length; i++) {
      var p = state.payload.pages[i];
      pageList.add("item", "#" + p.page);
    }
    var defaultPage = api.normalizePageNumber(state.context.defaultPage);
    var selectedIndex = 0;
    for (var j = 0; j < state.payload.pages.length; j++) {
      if (String(state.payload.pages[j].page) === String(defaultPage)) {
        selectedIndex = j;
        break;
      }
    }
    pageList.selection = pageList.items[selectedIndex];
    updatePageInfo();
  }

  function updatePageInfo() {
    if (!state.payload || !pageList.selection) {
      pageInfo.text = "页信息: -";
      return;
    }
    var idx = pageList.selection.index;
    var p = state.payload.pages[idx];
    pageInfo.text = "页信息: #" + p.page;
  }

  function loadContextAndBinding() {
    state.context = api.buildDefaultContext();
    state.cfg = state.context.cfg;
    writeCfgInputs(state.cfg);

    psdText.text = "PSD: " + (state.context.doc && state.context.doc.name ? state.context.doc.name : "-");

    if (state.context.autoDataFile && state.context.autoDataFile.exists) {
      state.dataFile = state.context.autoDataFile;
      state.payload = state.context.payload;
      dataText.text = "数据: " + state.dataFile.name + " (自动匹配)";
      safeSetTextColor(dataText, [0, 0.5, 0]);
    } else {
      state.dataFile = null;
      state.payload = null;
      dataText.text = "数据: 未绑定（请手动选择）";
      safeSetTextColor(dataText, [0.8, 0, 0]);
      log("未自动匹配到 .jsxdata，请点击“手动选择数据”。");
    }
    refreshPages();
  }

  function selectDataFileManually() {
    var f = api.chooseDataFile();
    if (!f) return;
    try {
      state.payload = api.readPayloadFromFile(f);
      state.dataFile = f;
      dataText.text = "数据: " + f.name + " (手动选择)";
      safeSetTextColor(dataText, [0, 0.5, 0]);
      state.context.defaultPage = (state.payload.pages && state.payload.pages.length) ? state.payload.pages[0].page : "001";
      refreshPages();
      log("已绑定数据文件: " + f.fsName);
    } catch (e) {
      alert("读取数据文件失败: " + e.message);
      log("读取数据失败: " + e.message);
    }
  }

  function getSelectedPage() {
    if (!state.payload || !state.payload.pages || !state.payload.pages.length) return null;
    if (!pageList.selection) return String(state.payload.pages[0].page);
    return String(state.payload.pages[pageList.selection.index].page);
  }

  function ensureReadyForImport() {
    if (!state.payload || !state.payload.pages || !state.payload.pages.length) {
      alert("当前未绑定有效的 .jsxdata，不能导入。");
      log("导入中止：未绑定有效数据。");
      return false;
    }
    return true;
  }

  btnRescan.onClick = function () {
    try {
      loadContextAndBinding();
      log("已重新扫描当前 PSD 绑定。");
    } catch (e) {
      alert("重新扫描失败: " + e.message);
      log("重新扫描失败: " + e.message);
    }
  };

  btnChooseData.onClick = function () {
    selectDataFileManually();
  };

  pageList.onChange = function () { updatePageInfo(); };

  btnImportCurrent.onClick = function () {
    if (!ensureReadyForImport()) return;
    try {
      readCfgInputs();
      var page = getSelectedPage();
      var result = api.performImport(app.activeDocument, state.payload, { mode: "currentPage", page: page }, state.cfg, log);
      log("导入完成（当前页）: #" + page + "，文本框 " + (result.importedCount || 0));
    } catch (e) {
      alert("导入失败: " + e.message);
      log("导入失败: " + e.message);
    }
  };

  btnImportAll.onClick = function () {
    if (!ensureReadyForImport()) return;
    try {
      readCfgInputs();
      var result = api.performImport(app.activeDocument, state.payload, { mode: "allPages", page: getSelectedPage() }, state.cfg, log);
      log("导入完成（全部页）: 总文本框 " + (result.importedCount || 0));
    } catch (e) {
      alert("导入失败: " + e.message);
      log("导入失败: " + e.message);
    }
  };

  btnSaveDefaults.onClick = function () {
    try {
      readCfgInputs();
      api.saveSettingsToDisk(state.context.settingsFile, state.cfg);
      log("已保存当前参数到 settings.json");
    } catch (e) {
      alert("保存设置失败: " + e.message);
      log("保存设置失败: " + e.message);
    }
  };

  var keepAlive = true;
  w.onClose = function () {
    keepAlive = false;
    return true;
  };
  btnClosePanel.onClick = function () {
    keepAlive = false;
    try { w.close(); } catch (_) {}
  };

  btnClearLog.onClick = function () { logText.text = ""; };
  btnCopyLog.onClick = function () {
    try {
      logText.active = true;
      logText.textselection = logText.text;
      app.copy();
      log("日志已复制到剪贴板。");
    } catch (e) {
      alert("复制日志失败: " + e.message);
    }
  };

  loadContextAndBinding();
  w.onResizing = w.onResize = function () { this.layout.resize(); };
  w.center();
  $.global.WORD_IMPORT_PANEL_WINDOW = w;
  w.show();
  // Keep script context alive for Photoshop builds where palette can be GC'd
  // after script exit even with targetengine.
  while (keepAlive && w.visible) {
    try { app.refresh(); } catch (_) {}
    $.sleep(120);
  }
  } catch (e) {
    alert("面板初始化失败: " + e.message + "\n(行号: " + (e.line || "?") + ")");
  }

  function safeSetTextColor(uiText, rgb) {
    try {
      if (!uiText || !uiText.graphics) return;
      uiText.graphics.foregroundColor = uiText.graphics.newPen(uiText.graphics.PenType.SOLID_COLOR, rgb, 1);
    } catch (_) {}
  }
})();

