#target photoshop
#targetengine "word_import_panel_engine"

(function () {
  try {
  if (app.name !== "Adobe Photoshop") {
    alert("请在 Photoshop 中运行此脚本。");
    return;
  }

  // Second click closes the palette. Cannot use a blocking loop below or this block never runs again.
  var existingPanelWin = $.global.WORD_IMPORT_PANEL_WINDOW;
  if (existingPanelWin) {
    var wasOpen = false;
    try {
      wasOpen = existingPanelWin.visible === true;
    } catch (_) {
      $.global.WORD_IMPORT_PANEL_WINDOW = null;
      wasOpen = false;
    }
    try {
      if (wasOpen) {
        existingPanelWin.close();
      }
    } catch (_) {}
    $.global.WORD_IMPORT_PANEL_WINDOW = null;
    if (wasOpen) {
      return;
    }
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

  var DEFAULT_FONT_FAMILY_FALLBACK = ["Microsoft YaHei", "微软雅黑", "Microsoft YaHei UI"];
  var DEFAULT_FONT_REGULAR_FALLBACK = ["MicrosoftYaHei", "MicrosoftYaHeiUI", "MicrosoftYaHeiUI-Regular"];
  var DEFAULT_FONT_BOLD_FALLBACK = ["MicrosoftYaHei-Bold", "MicrosoftYaHeiUI-Bold"];

  function getUserDataFolder() {
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
  }

  function getBundledFontsFolder() {
    try {
      var root = File($.fileName).parent;
      if (!root) return null;
      var f = new Folder(root.fsName + "/fonts");
      return f.exists ? f : null;
    } catch (_) {
      return null;
    }
  }

  function getUserFontsFolder(create) {
    var root = getUserDataFolder();
    if (!root) return null;
    var fonts = new Folder(root.fsName + "/fonts");
    if (!fonts.exists) {
      if (!create) return null;
      try { fonts.create(); } catch (_) {}
    }
    return fonts.exists ? fonts : null;
  }

  var w = new Window("palette", "漫画汉化导入助手 1.2 · 设置面板", undefined, { resizeable: true });
  w.orientation = "column";
  w.alignChildren = "fill";
  w.spacing = 12;
  w.margins = 14;
  w.minimumSize = [520, 680];
  w.preferredSize = [560, 760];

  var topBar = w.add("group");
  topBar.orientation = "column";
  topBar.alignment = "fill";
  topBar.spacing = 6;
  var topLine = topBar.add("group");
  topLine.orientation = "row";
  topLine.alignment = "fill";
  topLine.spacing = 6;
  var brandTitle = topLine.add("statictext", undefined, "漫画汉化导入助手 1.2 · 设置面板");
  var topSpacer = topLine.add("statictext", undefined, "");
  topSpacer.alignment = ["fill", "center"];
  var btnClosePanel = topLine.add("button", undefined, "×");
  btnClosePanel.preferredSize = [24, 24];
  btnClosePanel.helpTip = "关闭设置面板";
  var topSub = topBar.add(
    "statictext",
    undefined,
    "流程：绑定数据 -> 选择页码 -> 导入当前页/全部页（可先微调字号、行距、颜色）"
  );

  var bindingPanel = w.add("panel", undefined, "文件绑定");
  bindingPanel.orientation = "column";
  bindingPanel.alignChildren = "fill";
  bindingPanel.spacing = 6;
  bindingPanel.margins = 12;
  var psdText = bindingPanel.add("statictext", undefined, "PSD: -");
  var dataText = bindingPanel.add("statictext", undefined, "数据: 未绑定");
  var bindBtns = bindingPanel.add("group");
  bindBtns.spacing = 8;
  var btnRescan = bindBtns.add("button", undefined, "重新扫描");
  var btnChooseData = bindBtns.add("button", undefined, "手动选择数据");

  var previewPanel = w.add("panel", undefined, "页码预览");
  previewPanel.orientation = "column";
  previewPanel.alignChildren = "fill";
  previewPanel.spacing = 6;
  previewPanel.margins = 12;
  var pageList = previewPanel.add("listbox", undefined, [], { multiselect: false });
  pageList.preferredSize.height = 170;
  var pageInfo = previewPanel.add("statictext", undefined, "页信息: -（默认按当前页）");

  var actionPanel = w.add("panel", undefined, "导入操作（核心）");
  actionPanel.orientation = "column";
  actionPanel.alignChildren = "fill";
  actionPanel.spacing = 8;
  actionPanel.margins = 12;
  var actionHint = actionPanel.add("statictext", undefined, "建议先点“导入当前页”确认样式，再执行“导入全部页”。");
  var actionBtns = actionPanel.add("group");
  actionBtns.orientation = "row";
  actionBtns.alignChildren = "fill";
  actionBtns.spacing = 8;
  var btnImportCurrent = actionBtns.add("button", undefined, "导入当前页（推荐）");
  var btnImportAll = actionBtns.add("button", undefined, "导入全部页");

  var cfgPanel = w.add("panel", undefined, "全局排版与颜色");
  cfgPanel.orientation = "column";
  cfgPanel.alignChildren = "fill";
  cfgPanel.spacing = 6;
  cfgPanel.margins = 12;
  var rowFont = cfgPanel.add("group");
  rowFont.spacing = 8;
  rowFont.add("statictext", undefined, "全局字号(pt)");
  var inputFontSize = rowFont.add("edittext", undefined, "");
  inputFontSize.characters = 5;
  rowFont.add("statictext", undefined, "行间距(pt)");
  var inputLineSpacing = rowFont.add("edittext", undefined, "");
  inputLineSpacing.characters = 5;

  var rowColor = cfgPanel.add("group");
  rowColor.spacing = 8;
  rowColor.add("statictext", undefined, "字体颜色");
  var inputColorHex = rowColor.add("edittext", undefined, "");
  inputColorHex.characters = 10;
  inputColorHex.helpTip = "十六进制，如 #222222";

  var cfgJsonHint = cfgPanel.add(
    "statictext",
    undefined,
    "提示：框宽、起始坐标、列间距等参数请在 settings.json 中调整（位置：%APPDATA%\\com.word_to_photoshop\\settings.json）。",
    { multiline: false }
  );

  var rowFontSelect = cfgPanel.add("group");
  rowFontSelect.orientation = "column";
  rowFontSelect.alignChildren = "fill";
  rowFontSelect.spacing = 6;
  var rowRegular = rowFontSelect.add("group");
  rowRegular.spacing = 8;
  rowRegular.add("statictext", undefined, "正文字体");
  var btnPickRegularFont = rowRegular.add("button", undefined, "选择…");
  btnPickRegularFont.helpTip = "在列表中选取正文字体（写入 settings.json 并用于导入）";
  var txtRegularPicked = rowRegular.add("statictext", undefined, "");
  var rowBold = rowFontSelect.add("group");
  rowBold.spacing = 8;
  rowBold.add("statictext", undefined, "加粗字体");
  var btnPickBoldFont = rowBold.add("button", undefined, "选择…");
  btnPickBoldFont.helpTip = "在列表中选取加粗字体；首项为无（仿加粗）";
  var txtBoldPicked = rowBold.add("statictext", undefined, "");

  var rowFontImport = cfgPanel.add("group");
  rowFontImport.spacing = 8;
  var btnPickFontFile = rowFontImport.add("button", undefined, "刷新系统字体列表");
  btnPickFontFile.helpTip = "扫描扩展内置 fonts/ 与 %APPDATA%\\com.word_to_photoshop\\fonts，并刷新可选字体列表";
  var btnSaveDefaults = rowFontImport.add("button", undefined, "保存为默认");

  var rowFontImport2 = cfgPanel.add("group");
  rowFontImport2.spacing = 8;
  var btnRestoreDefaultFont = rowFontImport2.add("button", undefined, "恢复默认字体（微软雅黑）");
  btnRestoreDefaultFont.helpTip =
    "将正文恢复为微软雅黑常规、加粗恢复为微软雅黑 Bold 候选，并写入 settings.json";

  var logPanel = w.add("panel", undefined, "日志");
  logPanel.orientation = "column";
  logPanel.alignChildren = "fill";
  logPanel.spacing = 6;
  logPanel.margins = 12;
  var logText = logPanel.add("edittext", undefined, "", { multiline: true, readonly: true, scrolling: true });
  logText.preferredSize.height = 220;
  var logBtns = logPanel.add("group");
  logBtns.spacing = 8;
  var btnClearLog = logBtns.add("button", undefined, "清空日志");
  var btnCopyLog = logBtns.add("button", undefined, "复制日志");
  function setButtonSize(btn, w0, h0) {
    try {
      btn.preferredSize = [w0, h0];
    } catch (_) {}
  }
  setButtonSize(btnRescan, 108, 28);
  setButtonSize(btnChooseData, 124, 28);
  setButtonSize(btnPickFontFile, 132, 28);
  setButtonSize(btnSaveDefaults, 108, 28);
  setButtonSize(btnRestoreDefaultFont, 200, 28);
  setButtonSize(btnPickRegularFont, 88, 28);
  setButtonSize(btnPickBoldFont, 88, 28);
  setButtonSize(btnImportCurrent, 188, 34);
  setButtonSize(btnImportAll, 146, 34);
  setButtonSize(btnClearLog, 92, 28);
  setButtonSize(btnCopyLog, 92, 28);
  try { inputFontSize.preferredSize = [72, 24]; } catch (_) {}
  try { inputLineSpacing.preferredSize = [72, 24]; } catch (_) {}
  try { inputColorHex.preferredSize = [100, 24]; } catch (_) {}
  try { txtRegularPicked.preferredSize = [420, 24]; } catch (_) {}
  try { txtBoldPicked.preferredSize = [420, 24]; } catch (_) {}
  try { btnPickRegularFont.enabled = false; } catch (_) {}
  try { btnPickBoldFont.enabled = false; } catch (_) {}
  // 主色对齐 CEP .btnPrimary 基色 #3988e8；次要文字对齐 appLead / sectionHint 弱对比
  var colorAccent = [57 / 255, 136 / 255, 232 / 255];
  var colorMuted = [0.52, 0.54, 0.58];
  var colorMutedHint = [0.48, 0.5, 0.54];
  var colorLabel = [0.42, 0.44, 0.48];
  safeSetTextColor(brandTitle, colorAccent);
  safeSetTextColor(topSub, colorMuted);
  safeSetTextColor(cfgJsonHint, colorMutedHint);
  safeSetTextColor(psdText, colorLabel);
  safeSetTextColor(dataText, colorLabel);
  safeSetTextColor(actionHint, [0.35, 0.5, 0.35]);
  safeSetTextColor(pageInfo, [0.35, 0.35, 0.58]);

  function log(msg) {
    var now = new Date();
    var hh = pad2(now.getHours());
    var mm = pad2(now.getMinutes());
    var ss = pad2(now.getSeconds());
    var line = "[" + hh + ":" + mm + ":" + ss + "] " + msg;
    logText.text = logText.text ? (logText.text + "\n" + line) : line;
  }

  // #region agent log
  function agentDbgLog(location, message, data, hypothesisId) {
    try {
      var logF = new File(File($.fileName).parent.fsName + "/debug-b3ad94.log");
      logF.encoding = "UTF8";
      logF.open("a");
      var payload = {
        sessionId: "b3ad94",
        location: String(location || ""),
        message: String(message || ""),
        data: data || {},
        hypothesisId: String(hypothesisId || ""),
        timestamp: new Date().getTime()
      };
      logF.writeln(JSON.stringify(payload));
      logF.close();
    } catch (_) {}
  }
  // #endregion

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function parseNum(value, fallback) {
    var n = parseFloat(value);
    return isNaN(n) ? fallback : n;
  }

  function uniqStrings(list) {
    var seen = {};
    var out = [];
    if (!list || !list.length) return out;
    for (var i = 0; i < list.length; i++) {
      var s = String(list[i] == null ? "" : list[i]).replace(/^\s+|\s+$/g, "");
      if (!s) continue;
      var k = s.toLowerCase();
      if (seen[k]) continue;
      seen[k] = true;
      out.push(s);
    }
    return out;
  }
  function decodeMaybeURIComponent(s) {
    var raw = String(s == null ? "" : s);
    if (!raw) return "";
    // Some Windows/ExtendScript font/file names may appear as URL-encoded tokens.
    if (/%[0-9a-fA-F]{2}/.test(raw)) {
      try { return decodeURIComponent(raw); } catch (_) {}
    }
    return raw;
  }

  var fontUiState = {
    allEntries: []
  };

  function normalizeFontToken(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "");
  }
  function isBoldStyleName(styleName) {
    return /(bold|black|heavy|semibold|demibold|extrabold|粗|黑)/i.test(String(styleName || ""));
  }
  function isGarbageFontToken(v) {
    var s = String(v == null ? "" : v).replace(/^\s+|\s+$/g, "");
    if (!s) return true;
    // Observed bad entries like "60039f7144532" (hex-like meaningless token).
    if (/^[0-9a-f]{8,}$/i.test(s)) return true;
    return false;
  }
  function containsCjkUi(s) {
    return /[\u4e00-\u9fff]/.test(String(s || ""));
  }
  /** Prefer localized name: Photoshop may expose only en-US family (e.g. HYLiLiangHeiJ) while name record has zh-CN in the font file. */
  function pickFontUiDisplayName(scriptPaletteName, scriptFamily) {
    var n = String(scriptPaletteName || "").replace(/^\s+|\s+$/g, "");
    var fam = String(scriptFamily || "").replace(/^\s+|\s+$/g, "");
    if (containsCjkUi(n)) return n;
    if (containsCjkUi(fam)) return fam;
    if (n) return n;
    if (fam) return fam;
    return "";
  }
  function fontLabel(entry) {
    var ps = decodeMaybeURIComponent(entry.postScriptName || "").replace(/^\s+|\s+$/g, "");
    var sty = decodeMaybeURIComponent(entry.style || "").replace(/^\s+|\s+$/g, "");
    var fam = decodeMaybeURIComponent(entry.family || "").replace(/^\s+|\s+$/g, "");
    var ui = "";
    try {
      ui = decodeMaybeURIComponent(String(entry.uiName != null ? entry.uiName : "")).replace(/^\s+|\s+$/g, "");
    } catch (_) {
      ui = "";
    }
    var primary = ui || fam || ps || "?";
    var parts = [primary];
    if (sty) parts.push(sty);
    var base = parts.join(" · ");
    var hasCjk = /[\u4e00-\u9fff]/.test(primary);
    var showPs =
      !!ps &&
      ps !== primary &&
      String(ps).toLowerCase() !== String(primary).toLowerCase() &&
      !hasCjk;
    return showPs ? base + " [" + ps + "]" : base;
  }
  function displayLabelByPostScript(psName) {
    var ps = String(psName || "").toLowerCase();
    if (!ps || !fontUiState.allEntries || !fontUiState.allEntries.length) return "";
    for (var i = 0; i < fontUiState.allEntries.length; i++) {
      var e = fontUiState.allEntries[i];
      if (String(e.postScriptName || "").toLowerCase() === ps) return fontLabel(e);
    }
    return "";
  }
  /**
   * 仅从 Photoshop 内置字体枚举读取（不扫 Windows 目录）。
   * 优先 app.textFonts；若为空则回退 app.fonts（部分版本/环境下 textFonts 始终为空但 fonts 可用）。
   * 每条字体单独 try/catch，避免单个损坏条目拖垮整表。
   */
  function collectInstalledFontsMappedFromProjectFonts() {
    var out = [];
    var seen = {};
    function pushFromFontLike(f) {
      var family = "";
      var style = "";
      try {
        family = decodeMaybeURIComponent(String(f.family || ""));
      } catch (_) {}
      try {
        style = decodeMaybeURIComponent(String(f.style || ""));
      } catch (_) {}
      var ps = "";
      try {
        ps = decodeMaybeURIComponent(String(f.postScriptName || ""));
      } catch (_) {}
      var rawPaletteName = "";
      try {
        rawPaletteName = decodeMaybeURIComponent(String(f.name != null ? f.name : ""));
      } catch (_) {}
      if (!family && rawPaletteName) family = rawPaletteName;
      var uiName = pickFontUiDisplayName(rawPaletteName, family);
      if (!ps) return;
      if (isGarbageFontToken(ps) || isGarbageFontToken(family)) return;
      var key = String(ps).toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      out.push({
        family: family,
        style: style,
        postScriptName: ps,
        uiName: uiName,
        sourceFile: "",
        isBold: isBoldStyleName(style)
      });
    }
    function enumerateCollection(coll) {
      if (!coll || typeof coll.length !== "number" || coll.length < 1) return;
      var j;
      for (j = 0; j < coll.length; j++) {
        try {
          pushFromFontLike(coll[j]);
        } catch (_) {}
      }
    }
    try {
      enumerateCollection(app.textFonts);
    } catch (_) {}
    if (!out.length) {
      try {
        enumerateCollection(app.fonts);
      } catch (_) {}
    }
    out.sort(function (a, b) {
      var fa = String(a.family || "").toLowerCase();
      var fb = String(b.family || "").toLowerCase();
      if (fa < fb) return -1;
      if (fa > fb) return 1;
      var sa = String(a.style || "").toLowerCase();
      var sb = String(b.style || "").toLowerCase();
      if (sa < sb) return -1;
      if (sa > sb) return 1;
      return 0;
    });
    return out;
  }
  function pickAutoBoldForRegular(regularEntry) {
    if (!regularEntry) return null;
    var family = String(regularEntry.family || "").toLowerCase();
    var src = String(regularEntry.sourceFile || "").toLowerCase();
    for (var i = 0; i < fontUiState.allEntries.length; i++) {
      var b = fontUiState.allEntries[i];
      if (String(b.family || "").toLowerCase() !== family) continue;
      if (isBoldStyleName(b.style)) return b;
    }
    for (var j = 0; j < fontUiState.allEntries.length; j++) {
      var b2 = fontUiState.allEntries[j];
      if (String(b2.sourceFile || "").toLowerCase() !== src) continue;
      if (isBoldStyleName(b2.style)) return b2;
    }
    return null;
  }
  /** dialogOpts.pinnedCount：列表前若干项不参与搜索筛选（加粗对话框首项「无（仿加粗）」固定置顶）。 */
  function showListPickDialog(title, optionLabels, initialIndex, dialogOpts) {
    dialogOpts = dialogOpts || {};
    var pinnedCount = Math.max(0, Math.floor(Number(dialogOpts.pinnedCount) || 0));
    if (!optionLabels || !optionLabels.length) return -1;
    var allLabels = [];
    var li;
    for (li = 0; li < optionLabels.length; li++) allLabels.push(String(optionLabels[li]));

    var dlg = new Window("dialog", title);
    dlg.orientation = "column";
    dlg.alignChildren = "fill";
    dlg.spacing = 10;
    dlg.margins = 16;

    var searchRow = dlg.add("group");
    searchRow.orientation = "row";
    searchRow.alignChildren = "center";
    searchRow.spacing = 8;
    searchRow.add("statictext", undefined, "搜索:");
    var searchEdit = searchRow.add("edittext", undefined, "");
    searchEdit.characters = 36;
    searchEdit.helpTip = "按列表显示文字筛选（不区分大小写）";

    var lb = dlg.add("listbox", undefined, undefined, { multiselect: false });
    lb.preferredSize = [580, 340];

    var mapOrig = [];
    var ini = Number(initialIndex);
    if (isNaN(ini)) ini = 0;
    ini = Math.max(0, Math.min(ini, allLabels.length - 1));
    var pendingSelectOrig = ini;

    function clearLb() {
      try {
        while (lb.items.length > 0) lb.remove(0);
      } catch (_) {}
    }

    function rebuildFilter() {
      var q = String(searchEdit.text || "")
        .replace(/^\s+|\s+$/g, "")
        .toLowerCase();
      clearLb();
      mapOrig = [];
      var i;
      for (i = 0; i < pinnedCount && i < allLabels.length; i++) {
        lb.add("item", allLabels[i]);
        mapOrig.push(i);
      }
      var matchCt = 0;
      for (i = pinnedCount; i < allLabels.length; i++) {
        if (!q || String(allLabels[i]).toLowerCase().indexOf(q) >= 0) {
          lb.add("item", allLabels[i]);
          mapOrig.push(i);
          matchCt++;
        }
      }
      if (matchCt === 0 && q.length > 0 && pinnedCount === 0 && allLabels.length > 0) {
        lb.add("item", "（无匹配字体，请修改搜索词）");
        mapOrig.push(-1);
      }
      var selPos = 0;
      var k;
      for (k = 0; k < mapOrig.length; k++) {
        if (mapOrig[k] === pendingSelectOrig) {
          selPos = k;
          break;
        }
      }
      try {
        if (lb.items.length) lb.selection = lb.items[selPos];
      } catch (_) {}
    }

    lb.onChange = function () {
      try {
        if (lb.selection && mapOrig.length && lb.selection.index >= 0) {
          var mo = mapOrig[lb.selection.index];
          if (mo >= 0) pendingSelectOrig = mo;
        }
      } catch (_) {}
    };

    searchEdit.onChanging = function () {
      rebuildFilter();
    };

    var g = dlg.add("group");
    g.orientation = "row";
    g.alignment = "center";
    g.spacing = 10;
    var bnOk = g.add("button", undefined, "确定", { name: "ok" });
    var bnCancel = g.add("button", undefined, "取消", { name: "cancel" });
    bnOk.onClick = function () {
      dlg.close(1);
    };
    bnCancel.onClick = function () {
      dlg.close(0);
    };

    rebuildFilter();

    if (dlg.show() !== 1) return -1;
    try {
      if (!lb.selection || !mapOrig.length) return -1;
      var origIx = mapOrig[lb.selection.index];
      if (origIx < 0) return -1;
      return Number(origIx);
    } catch (_) {
      return -1;
    }
  }
  function buildExplicitFontCandidates(entry) {
    if (!entry) return [];
    var prim = [];
    var psP = decodeMaybeURIComponent(entry.postScriptName || "");
    var famP = decodeMaybeURIComponent(entry.family || "");
    var uiP = "";
    try {
      uiP = decodeMaybeURIComponent(String(entry.uiName != null ? entry.uiName : ""));
    } catch (_) {
      uiP = "";
    }
    function pushU(s) {
      var v = String(s || "").replace(/^\s+|\s+$/g, "");
      if (!v) return;
      var k = v.toLowerCase();
      var ii;
      for (ii = 0; ii < prim.length; ii++) if (String(prim[ii]).toLowerCase() === k) return;
      prim.push(v);
    }
    pushU(psP);
    pushU(famP);
    pushU(uiP);
    return prim;
  }
  /** 在 app.textFonts 或 app.fonts 中按 PostScript 名严格命中（大小写不敏感）。 */
  function isPostScriptInTextFonts(psName) {
    var want = String(psName || "").replace(/^\s+|\s+$/g, "");
    if (!want) return false;
    var wantLow = want.toLowerCase();
    function scan(coll) {
      if (!coll || typeof coll.length !== "number") return false;
      var i;
      for (i = 0; i < coll.length; i++) {
        try {
          var ps = String(coll[i].postScriptName || "");
          if (ps.toLowerCase() === wantLow) return true;
        } catch (_) {}
      }
      return false;
    }
    return scan(app.textFonts) || scan(app.fonts);
  }
  function buildExplicitFamilyNames(entry) {
    if (!entry) return [];
    var famP = decodeMaybeURIComponent(entry.family || "");
    var uiP = "";
    try {
      uiP = decodeMaybeURIComponent(String(entry.uiName != null ? entry.uiName : ""));
    } catch (_) {
      uiP = "";
    }
    var prim = [];
    function pushU(s) {
      var v = String(s || "").replace(/^\s+|\s+$/g, "");
      if (!v) return;
      var k = v.toLowerCase();
      var ii;
      for (ii = 0; ii < prim.length; ii++) if (String(prim[ii]).toLowerCase() === k) return;
      prim.push(v);
    }
    pushU(famP);
    pushU(uiP);
    return prim;
  }
  function applyRegularFontFromEntry(picked) {
    if (!picked || !state || !state.cfg) return;
    var pickedPs = String(decodeMaybeURIComponent(picked.postScriptName || "")).replace(/^\s+|\s+$/g, "");
    if (!pickedPs || !isPostScriptInTextFonts(pickedPs)) {
      log("拒绝保存：所选字体未在 Photoshop 枚举（textFonts / fonts）中命中 (postScriptName=\"" + pickedPs + "\")。请刷新字体列表或重启 Photoshop 后重试。");
      try { alert("该字体未被 Photoshop 识别（textFonts / fonts 均未命中），无法保存。\n请重启 Photoshop 后再试。"); } catch (_) {}
      // #region agent log
      try { agentDbgLog("import_panel.jsx:applyRegularFontFromEntry", "rejected_unknown_ps", { pickedPs: pickedPs, family: picked.family, uiName: picked.uiName }, "H_strictPick"); } catch (_) {}
      // #endregion
      return;
    }
    var cfg = state.cfg;
    var expReg = buildExplicitFontCandidates(picked);
    cfg.fontRegularCandidates = expReg.length ? mergeFontCandidates(expReg, [], []) : mergeFontCandidates([], [], DEFAULT_FONT_REGULAR_FALLBACK);
    var expFam = buildExplicitFamilyNames(picked);
    cfg.fontFamilyNames = expFam.length ? mergeFontCandidates(expFam, [], []) : mergeFontCandidates([], [], DEFAULT_FONT_FAMILY_FALLBACK);
    cfg.fontSourceFile = "";
    var autoBold = pickAutoBoldForRegular(picked);
    if (autoBold) {
      var expBold = buildExplicitFontCandidates(autoBold);
      cfg.fontBoldCandidates = expBold.length ? mergeFontCandidates(expBold, [], []) : mergeFontCandidates([], [], DEFAULT_FONT_BOLD_FALLBACK);
      var regPs0 = cfg.fontRegularCandidates && cfg.fontRegularCandidates.length ? cfg.fontRegularCandidates[0] : "";
      cfg.fontHasRealBold = String(decodeMaybeURIComponent(autoBold.postScriptName || "")).toLowerCase() !== String(regPs0 || "").toLowerCase();
    } else {
      cfg.fontBoldCandidates = [];
      var cr = cfg.fontRegularCandidates || [];
      var ci;
      for (ci = 0; ci < cr.length; ci++) cfg.fontBoldCandidates.push(cr[ci]);
      if (!cfg.fontBoldCandidates.length) {
        cfg.fontBoldCandidates = mergeFontCandidates([], [], DEFAULT_FONT_BOLD_FALLBACK);
      }
      cfg.fontHasRealBold = false;
    }
    // #region agent log
    agentDbgLog("import_panel.jsx:applyRegularFontFromEntry", "applied", { postScriptName: picked.postScriptName, autoBoldPs: autoBold ? autoBold.postScriptName : "", fontHasRealBold: cfg.fontHasRealBold }, "H_direct_apply");
    // #endregion
    persistFontSelectionNow();
  }

  /** 恢复与项目默认 settings 一致的微软雅黑候选（不依赖当前字体列表是否已刷新）。 */
  function restoreDefaultMicrosoftYaheiFont() {
    if (!state || !state.cfg || !state.context || !state.context.settingsFile) {
      try {
        alert("上下文未就绪，请重新打开面板或点击「重新扫描」。");
      } catch (_) {}
      return;
    }
    var cfg = state.cfg;
    cfg.fontRegularCandidates = mergeFontCandidates(DEFAULT_FONT_REGULAR_FALLBACK, [], []);
    cfg.fontFamilyNames = mergeFontCandidates(DEFAULT_FONT_FAMILY_FALLBACK, [], []);
    cfg.fontBoldCandidates = mergeFontCandidates([], [], DEFAULT_FONT_BOLD_FALLBACK);
    cfg.fontHasRealBold = true;
    cfg.fontSourceFile = "";
    try {
      readCfgInputs();
      api.saveSettingsToDisk(state.context.settingsFile, cfg);
      updateFontPickedLabels(cfg);
      log("已恢复默认字体（微软雅黑候选），并已保存到 settings.json。");
    } catch (e) {
      try {
        alert("保存失败: " + (e && e.message ? e.message : e));
      } catch (_) {}
      log("恢复默认字体失败: " + (e && e.message ? e.message : e));
    }
  }

  function applyBoldFontFromDialogIndex(listIndex) {
    if (!state || !state.cfg) return;
    var cfg = state.cfg;
    if (Number(listIndex) === 0) {
      cfg.fontBoldCandidates = [];
      var cr0 = cfg.fontRegularCandidates || [];
      var cj;
      for (cj = 0; cj < cr0.length; cj++) cfg.fontBoldCandidates.push(cr0[cj]);
      if (!cfg.fontBoldCandidates.length) {
        cfg.fontBoldCandidates = mergeFontCandidates([], [], DEFAULT_FONT_BOLD_FALLBACK);
      }
      cfg.fontHasRealBold = false;
    } else {
      var idx = Number(listIndex) - 1;
      var picked = fontUiState.allEntries[idx];
      if (!picked) return;
      var pickedBoldPs = String(decodeMaybeURIComponent(picked.postScriptName || "")).replace(/^\s+|\s+$/g, "");
      if (!pickedBoldPs || !isPostScriptInTextFonts(pickedBoldPs)) {
        log("拒绝保存加粗字体：未在 Photoshop 枚举（textFonts / fonts）中命中 (postScriptName=\"" + pickedBoldPs + "\")。");
        try { alert("该加粗字体未被 Photoshop 识别（textFonts / fonts 均未命中），无法保存。"); } catch (_) {}
        // #region agent log
        try { agentDbgLog("import_panel.jsx:applyBoldFontFromDialogIndex", "rejected_unknown_ps", { pickedPs: pickedBoldPs, family: picked.family, uiName: picked.uiName }, "H_strictPick"); } catch (_) {}
        // #endregion
        return;
      }
      var expB = buildExplicitFontCandidates(picked);
      cfg.fontBoldCandidates = expB.length ? mergeFontCandidates(expB, [], []) : mergeFontCandidates([], [], DEFAULT_FONT_BOLD_FALLBACK);
      var regPs2 = cfg.fontRegularCandidates && cfg.fontRegularCandidates.length ? cfg.fontRegularCandidates[0] : "";
      cfg.fontHasRealBold = pickedBoldPs.toLowerCase() !== String(regPs2 || "").toLowerCase();
    }
    // #region agent log
    agentDbgLog("import_panel.jsx:applyBoldFontFromDialogIndex", "applied", { listIndex: listIndex, bold0: (cfg.fontBoldCandidates && cfg.fontBoldCandidates[0]) || "", fontHasRealBold: cfg.fontHasRealBold }, "H_direct_apply");
    // #endregion
    persistFontSelectionNow();
  }
  function openRegularFontPicker() {
    if (!fontUiState.allEntries || !fontUiState.allEntries.length) {
      log("字体列表为空，请先点「刷新系统字体列表」。");
      alert("请先在「刷新系统字体列表」后再选择字体。");
      return;
    }
    var labels = [];
    var a;
    for (a = 0; a < fontUiState.allEntries.length; a++) labels.push(fontLabel(fontUiState.allEntries[a]));
    var prePs = state.cfg && state.cfg.fontRegularCandidates && state.cfg.fontRegularCandidates.length ? String(state.cfg.fontRegularCandidates[0]) : "";
    var startIdx = 0;
    for (a = 0; a < fontUiState.allEntries.length; a++) {
      if (String(fontUiState.allEntries[a].postScriptName || "").toLowerCase() === String(prePs).toLowerCase()) {
        startIdx = a;
        break;
      }
    }
    var ix = showListPickDialog("选择正文字体", labels, startIdx, { pinnedCount: 0 });
    // #region agent log
    agentDbgLog("import_panel.jsx:openRegularFontPicker", "dialog closed", { ix: ix, startIdx: startIdx }, "H_dialog");
    // #endregion
    if (ix < 0) return;
    applyRegularFontFromEntry(fontUiState.allEntries[ix]);
  }
  function openBoldFontPicker() {
    if (!fontUiState.allEntries || !fontUiState.allEntries.length) {
      log("字体列表为空，请先点「刷新系统字体列表」。");
      alert("请先在「刷新系统字体列表」后再选择字体。");
      return;
    }
    var labels = ["无（仿加粗）"];
    var a;
    for (a = 0; a < fontUiState.allEntries.length; a++) labels.push(fontLabel(fontUiState.allEntries[a]));
    var cfg = state.cfg || {};
    var startIdx = 0;
    if (cfg.fontHasRealBold === false) {
      startIdx = 0;
    } else if (cfg.fontBoldCandidates && cfg.fontBoldCandidates.length) {
      var bps = String(cfg.fontBoldCandidates[0]);
      for (var bi = 0; bi < fontUiState.allEntries.length; bi++) {
        if (String(fontUiState.allEntries[bi].postScriptName || "").toLowerCase() === bps.toLowerCase()) {
          startIdx = bi + 1;
          break;
        }
      }
    }
    var ix = showListPickDialog("选择加粗字体", labels, startIdx, { pinnedCount: 1 });
    // #region agent log
    agentDbgLog("import_panel.jsx:openBoldFontPicker", "dialog closed", { ix: ix, startIdx: startIdx }, "H_dialog");
    // #endregion
    if (ix < 0) return;
    applyBoldFontFromDialogIndex(ix);
  }
  function refreshFontDropdownsFromProject(cfg, reason) {
    try {
      var all = collectInstalledFontsMappedFromProjectFonts();
      fontUiState.allEntries = all;
      var hasFonts = !!(all && all.length);
      try { btnPickRegularFont.enabled = hasFonts; } catch (_) {}
      try { btnPickBoldFont.enabled = hasFonts; } catch (_) {}
      if (!all.length) {
        log(
          "字体列表: app.textFonts 与 app.fonts 均未枚举到字体。请确认在 Photoshop 内运行脚本、已打开文档后再试，或重启 Photoshop。"
        );
      } else {
        log("字体列表已刷新: total=" + all.length + "（来源：Photoshop 内置枚举 textFonts→fonts，严格模式）。");
      }
      if (cfg) updateFontPickedLabels(cfg);
      // #region agent log
      agentDbgLog("import_panel.jsx:refreshFontDropdownsFromProject", "refresh", { reason: String(reason || ""), total: all.length, hasFonts: hasFonts }, "H_refresh");
      // #endregion
    } catch (e) {
      log("刷新字体列表失败: " + (e && e.message ? e.message : e));
    }
  }
  function persistFontSelectionNow() {
    try {
      if (!state || !state.cfg || !state.context || !state.context.settingsFile) return;
      readCfgInputs();
      api.saveSettingsToDisk(state.context.settingsFile, state.cfg);
      updateFontPickedLabels(state.cfg);
      log(
        "字体选择已应用: regular=" + String((state.cfg.fontRegularCandidates && state.cfg.fontRegularCandidates[0]) || "") +
        ", bold=" + String((state.cfg.fontBoldCandidates && state.cfg.fontBoldCandidates[0]) || "")
      );
      // #region agent log
      agentDbgLog("import_panel.jsx:persistFontSelectionNow", "saved", { regular0: (state.cfg.fontRegularCandidates && state.cfg.fontRegularCandidates[0]) || "", bold0: (state.cfg.fontBoldCandidates && state.cfg.fontBoldCandidates[0]) || "", fontHasRealBold: state.cfg.fontHasRealBold }, "H_persist");
      // #endregion
    } catch (e) {
      log("字体选择保存失败: " + (e && e.message ? e.message : e));
    }
  }

  function updateFontPickedLabels(cfg) {
    try {
      var r0 = cfg && cfg.fontRegularCandidates && cfg.fontRegularCandidates.length ? String(cfg.fontRegularCandidates[0]) : "";
      var b0 = cfg && cfg.fontBoldCandidates && cfg.fontBoldCandidates.length ? String(cfg.fontBoldCandidates[0]) : "";
      var rLabel = displayLabelByPostScript(r0);
      var bLabel = displayLabelByPostScript(b0);
      var rOk = r0 ? isPostScriptInTextFonts(r0) : false;
      var bOk = b0 ? isPostScriptInTextFonts(b0) : false;
      var rPrefix = r0 && !rOk ? "当前(未识别): " : "当前: ";
      var bPrefix = b0 && !bOk ? "当前(未识别): " : "当前: ";
      txtRegularPicked.text = r0 ? (rPrefix + (rLabel || r0)) : "当前: (未设置)";
      if (cfg && cfg.fontHasRealBold === false) {
        txtBoldPicked.text = "当前: 无（仿加粗）";
      } else {
        txtBoldPicked.text = b0 ? (bPrefix + (bLabel || b0)) : "当前: (未设置)";
      }
      if (r0 && !rOk) {
        log("提示: 已保存的正文字体「" + r0 + "」在当前 PS 字体列表中未识别，请重新选择字体。");
        // #region agent log
        try { agentDbgLog("import_panel.jsx:updateFontPickedLabels", "stale_regular", { regular0: r0 }, "H_strictPick"); } catch (_) {}
        // #endregion
      }
      if (b0 && !bOk && cfg && cfg.fontHasRealBold !== false) {
        log("提示: 已保存的加粗字体「" + b0 + "」在当前 PS 字体列表中未识别，请重新选择字体。");
      }
    } catch (_) {}
  }

  function mergeFontCandidates(primary, fallbackA, fallbackB) {
    return uniqStrings((primary || []).concat(fallbackA || []).concat(fallbackB || []));
  }

  function ensureDefaultYaHeiBaseline(logFn) {
    try {
      var dirs = [];
      var bundled = getBundledFontsFolder(); if (bundled) dirs.push(bundled);
      var userDir = getUserFontsFolder(false); if (userDir) dirs.push(userDir);
      if (!dirs.length) {
        if (typeof logFn === "function") logFn("字体基线检查: fonts/ 目录不存在（内置与 %APPDATA%\\com.word_to_photoshop\\fonts 均缺失）。");
        return;
      }
      var hitRegular = false;
      var hitBold = false;
      var hitFrom = "";
      for (var i = 0; i < dirs.length; i++) {
        var f1 = new File(dirs[i].fsName + "/msyh.ttc");
        var f2 = new File(dirs[i].fsName + "/msyhbd.ttc");
        if (f1.exists) { hitRegular = true; hitFrom = dirs[i].fsName; }
        if (f2.exists) { hitBold = true; hitFrom = dirs[i].fsName; }
        if (hitRegular && hitBold) break;
      }
      if (typeof logFn !== "function") return;
      if (hitRegular && hitBold) {
        logFn("字体基线检查: 已检测到默认微软雅黑资源（msyh.ttc + msyhbd.ttc，目录=" + hitFrom + "）。");
      } else {
        logFn("字体基线检查: 缺少默认微软雅黑资源，请补齐 msyh.ttc / msyhbd.ttc。");
      }
    } catch (e) {
      if (typeof logFn === "function") logFn("字体基线检查失败: " + e.message);
    }
  }

  function rgbToHex(rgb) {
    if (!rgb || rgb.length < 3) return "#222222";
    function h(n0) {
      var n = Math.max(0, Math.min(255, Math.round(Number(n0))));
      var s = n.toString(16);
      return s.length === 1 ? "0" + s : s;
    }
    return "#" + h(rgb[0]) + h(rgb[1]) + h(rgb[2]);
  }

  function parseHexColor(str, fb) {
    var fallback = fb && fb.length >= 3 ? fb : [34, 34, 34];
    var s = String(str || "").replace(/^\s*#?\s*/, "").replace(/\s*$/,"");
    if (/^[0-9a-fA-F]{6}$/.test(s)) {
      return [
        parseInt(s.substring(0, 2), 16),
        parseInt(s.substring(2, 4), 16),
        parseInt(s.substring(4, 6), 16)
      ];
    }
    return [fallback[0], fallback[1], fallback[2]];
  }

  function readCfgInputs() {
    var cfg = state.cfg;
    cfg.fontSizePt = parseNum(inputFontSize.text, cfg.fontSizePt != null ? cfg.fontSizePt : 26);
    cfg.lineSpacingPt = parseNum(inputLineSpacing.text, cfg.lineSpacingPt != null ? cfg.lineSpacingPt : 31);
    cfg.textColorRgb = parseHexColor(inputColorHex.text, cfg.textColorRgb || [34, 34, 34]);
    // 正文字体 / 加粗字体仅由「选择…」列表对话框写入 cfg，不再从下拉读取（避免 Win ScriptUI 下拉不同步）。
    // #region agent log
    agentDbgLog("import_panel.jsx:readCfgInputs", "scalars only", { regular0: (cfg.fontRegularCandidates && cfg.fontRegularCandidates[0]) || "", bold0: (cfg.fontBoldCandidates && cfg.fontBoldCandidates[0]) || "", fontHasRealBold: cfg.fontHasRealBold }, "H_readCfg");
    // #endregion
  }

  function writeCfgInputs(cfg) {
    inputFontSize.text = String(cfg.fontSizePt != null ? cfg.fontSizePt : 26);
    inputLineSpacing.text = String(cfg.lineSpacingPt != null ? cfg.lineSpacingPt : 31);
    inputColorHex.text = rgbToHex(cfg.textColorRgb || [34, 34, 34]);
    refreshFontDropdownsFromProject(cfg, "writeCfgInputs");
    updateFontPickedLabels(cfg);
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
    safeSetTextColor(psdText, [0.42, 0.44, 0.48]);

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
    ensureDefaultYaHeiBaseline(log);
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

  btnPickFontFile.onClick = function () {
    try {
      refreshFontDropdownsFromProject(state.cfg || {}, "btnPickFontFile");
    } catch (e) {
      log("刷新字体列表失败: " + e.message);
    }
  };

  btnRestoreDefaultFont.onClick = function () {
    try {
      restoreDefaultMicrosoftYaheiFont();
    } catch (e) {
      log("恢复默认字体异常: " + (e && e.message ? e.message : e));
    }
  };

  btnPickRegularFont.onClick = function () {
    try {
      openRegularFontPicker();
    } catch (e) {
      log("正文字体选择失败: " + (e && e.message ? e.message : e));
    }
  };
  btnPickBoldFont.onClick = function () {
    try {
      openBoldFontPicker();
    } catch (e) {
      log("加粗字体选择失败: " + (e && e.message ? e.message : e));
    }
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
      updateFontPickedLabels(state.cfg);
      log("已保存当前参数到 settings.json");
    } catch (e) {
      alert("保存设置失败: " + e.message);
      log("保存设置失败: " + e.message);
    }
  };

  w.onClose = function () {
    try {
      $.global.WORD_IMPORT_PANEL_WINDOW = null;
    } catch (_) {}
    return true;
  };
  btnClosePanel.onClick = function () {
    try {
      $.global.WORD_IMPORT_PANEL_WINDOW = null;
    } catch (_) {}
    try {
      w.close();
    } catch (_) {}
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
  w.onActivate = function () {};
  w.onResizing = w.onResize = function () { this.layout.resize(); };
  w.center();
  $.global.WORD_IMPORT_PANEL_WINDOW = w;
  w.show();
  // Do NOT spin here — a blocking loop would prevent future evalScript (e.g. CEP second click/toggle).
  // #targetengine "word_import_panel_engine" retains globals; palette stays open until explicit close().
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

