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

  var w = new Window("palette", "漫画汉化导入助手 1.2 · 完整导入面板", undefined, { resizeable: true });
  w.orientation = "column";
  w.alignChildren = "fill";
  w.spacing = 10;
  w.margins = 12;
  w.minimumSize = [520, 680];
  w.preferredSize = [560, 760];

  var topBar = w.add("group");
  topBar.orientation = "column";
  topBar.alignment = "fill";
  topBar.spacing = 4;
  var topLine = topBar.add("group");
  topLine.orientation = "row";
  topLine.alignment = "fill";
  var brandTitle = topLine.add("statictext", undefined, "漫画汉化导入助手 1.2 · 完整导入面板");
  var topSpacer = topLine.add("statictext", undefined, "");
  topSpacer.alignment = ["fill", "center"];
  var btnClosePanel = topLine.add("button", undefined, "×");
  btnClosePanel.preferredSize = [24, 24];
  btnClosePanel.helpTip = "关闭面板";
  var topSub = topBar.add(
    "statictext",
    undefined,
    "流程：绑定数据 -> 选择页码 -> 导入当前页/全部页（可先微调字号、行距、颜色）"
  );

  var bindingPanel = w.add("panel", undefined, "文件绑定");
  bindingPanel.orientation = "column";
  bindingPanel.alignChildren = "fill";
  bindingPanel.spacing = 6;
  bindingPanel.margins = 10;
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
  previewPanel.margins = 10;
  var pageList = previewPanel.add("listbox", undefined, [], { multiselect: false });
  pageList.preferredSize.height = 170;
  var pageInfo = previewPanel.add("statictext", undefined, "页信息: -（默认按当前页）");

  var actionPanel = w.add("panel", undefined, "导入操作（核心）");
  actionPanel.orientation = "column";
  actionPanel.alignChildren = "fill";
  actionPanel.spacing = 8;
  actionPanel.margins = 10;
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
  cfgPanel.margins = 10;
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

  cfgPanel.add(
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
  var ddRegularFont = rowRegular.add("dropdownlist", undefined, []);
  var txtRegularPicked = rowRegular.add("statictext", undefined, "");
  var rowBold = rowFontSelect.add("group");
  rowBold.spacing = 8;
  rowBold.add("statictext", undefined, "加粗字体");
  var ddBoldFont = rowBold.add("dropdownlist", undefined, []);
  var txtBoldPicked = rowBold.add("statictext", undefined, "");

  var rowFontImport = cfgPanel.add("group");
  rowFontImport.spacing = 8;
  var btnPickFontFile = rowFontImport.add("button", undefined, "刷新系统字体列表");
  btnPickFontFile.helpTip = "扫描扩展内置 fonts/ 与 %APPDATA%\\com.word_to_photoshop\\fonts，并刷新字体下拉项";
  var btnSaveDefaults = rowFontImport.add("button", undefined, "保存为默认");

  var rowFontImport2 = cfgPanel.add("group");
  rowFontImport2.spacing = 8;
  var btnCopyFontToRepo = rowFontImport2.add("button", undefined, "复制字体到用户目录…");
  btnCopyFontToRepo.helpTip = "选择 ttf/otf/ttc，复制到 %APPDATA%\\com.word_to_photoshop\\fonts 并尝试写入当前排版字体设置";
  var btnInstallFontUser = rowFontImport2.add("button", undefined, "安装字体到当前用户…");
  btnInstallFontUser.helpTip = "复制到 Windows 用户字体目录并注册（仅当前用户）；可能需要重启 PS 后在下拉中看到";

  var logPanel = w.add("panel", undefined, "日志");
  logPanel.orientation = "column";
  logPanel.alignChildren = "fill";
  logPanel.spacing = 6;
  logPanel.margins = 10;
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
  setButtonSize(btnCopyFontToRepo, 168, 28);
  setButtonSize(btnInstallFontUser, 168, 28);
  setButtonSize(btnImportCurrent, 188, 34);
  setButtonSize(btnImportAll, 146, 34);
  setButtonSize(btnClearLog, 92, 28);
  setButtonSize(btnCopyLog, 92, 28);
  try { inputFontSize.preferredSize = [72, 24]; } catch (_) {}
  try { inputLineSpacing.preferredSize = [72, 24]; } catch (_) {}
  try { inputColorHex.preferredSize = [100, 24]; } catch (_) {}
  try { ddRegularFont.preferredSize = [320, 24]; } catch (_) {}
  try { ddBoldFont.preferredSize = [320, 24]; } catch (_) {}
  try { txtRegularPicked.preferredSize = [240, 24]; } catch (_) {}
  try { txtBoldPicked.preferredSize = [240, 24]; } catch (_) {}
  safeSetTextColor(brandTitle, [0.18, 0.50, 0.92]);
  safeSetTextColor(topSub, [0.56, 0.56, 0.56]);
  safeSetTextColor(actionHint, [0.35, 0.50, 0.35]);
  safeSetTextColor(pageInfo, [0.35, 0.35, 0.58]);

  function log(msg) {
    var now = new Date();
    var hh = pad2(now.getHours());
    var mm = pad2(now.getMinutes());
    var ss = pad2(now.getSeconds());
    var line = "[" + hh + ":" + mm + ":" + ss + "] " + msg;
    logText.text = logText.text ? (logText.text + "\n" + line) : line;
  }

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

  var BOLD_NONE_ID = "__NONE_FAUX_BOLD__";
  var fontUiState = {
    allEntries: []
  };
  var _fontUiProgrammaticSync = false;
  var _fontUiLastUserChangeTs = 0;
  var _fontUiLastUserRegularIdx = -1;
  var _fontUiLastUserBoldIdx = -1;

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
  function fontLabel(entry) {
    var fam = decodeMaybeURIComponent(entry.family || "?");
    var sty = decodeMaybeURIComponent(entry.style || "");
    var ps = decodeMaybeURIComponent(entry.postScriptName || "");
    var famS = String(fam || "?");
    var styS = String(sty || "-");
    var psS = String(ps || "");
    var suffix = (psS && psS !== famS) ? (" [" + psS + "]") : "";
    return famS + " | " + styS + suffix;
  }
  function normalizeUiLabelText(s) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
  }
  function getDropdownStableText(dd) {
    try {
      var t = dd && dd.text != null ? String(dd.text) : "";
      if (t) return t;
    } catch (_) {}
    try {
      var s = dd && dd.selection && dd.selection.text != null ? String(dd.selection.text) : "";
      if (s) return s;
    } catch (_) {}
    return "";
  }
  function findEntryByDropdownLabel(entries, rawText) {
    if (!entries || !entries.length) return null;
    var want = normalizeUiLabelText(rawText);
    if (!want) return null;
    var i = 0;
    for (i = 0; i < entries.length; i++) {
      if (normalizeUiLabelText(fontLabel(entries[i])) === want) return entries[i];
    }
    var noSuffix = want.replace(/\s*\[[^\]]+\]\s*$/, "");
    for (i = 0; i < entries.length; i++) {
      var one = normalizeUiLabelText(fontLabel(entries[i]));
      if (one === noSuffix || one.indexOf(noSuffix + " [") === 0) return entries[i];
    }
    return null;
  }
  function resolveDropdownEntry(dd, entries, role, offset) {
    var out = {
      entry: null,
      source: "none",
      index: -1,
      rawText: ""
    };
    var baseOffset = isNaN(Number(offset)) ? 0 : Number(offset);
    if (dd && dd.selection && entries && entries.length) {
      var idx = Number(dd.selection.index) - baseOffset;
      if (idx >= 0 && idx < entries.length) {
        out.entry = entries[idx];
        out.source = "selectionIndex";
        out.index = idx;
        out.rawText = dd.selection && dd.selection.text != null ? String(dd.selection.text) : "";
        return out;
      }
    }
    var labelText = getDropdownStableText(dd);
    if (labelText) {
      var byText = findEntryByDropdownLabel(entries, labelText);
      if (byText) {
        out.entry = byText;
        out.source = "dropdownText";
        out.index = -1;
        out.rawText = labelText;
        return out;
      }
    }
    var lastUserIdx = role === "bold" ? Number(_fontUiLastUserBoldIdx) - baseOffset : Number(_fontUiLastUserRegularIdx);
    if (entries && entries.length && lastUserIdx >= 0 && lastUserIdx < entries.length) {
      out.entry = entries[lastUserIdx];
      out.source = "lastUserIndex";
      out.index = lastUserIdx;
      out.rawText = labelText;
      return out;
    }
    out.rawText = labelText;
    return out;
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
  function clearDropdown(dd) {
    try { dd.removeAll(); } catch (_) {}
  }
  function matchFontFilesInProject() {
    var out = [];
    var seen = {};
    var dirs = [];
    try { var bundled = getBundledFontsFolder(); if (bundled) dirs.push(bundled); } catch (_) {}
    try { var userDir = getUserFontsFolder(false); if (userDir) dirs.push(userDir); } catch (_) {}
    for (var i = 0; i < dirs.length; i++) {
      var fontsDir = dirs[i];
      var files = null;
      try {
        files = fontsDir.getFiles(function (f) {
          try { return f instanceof File && /\.(ttf|otf|ttc|otc)$/i.test(f.name); } catch (_) { return false; }
        });
      } catch (_) { files = null; }
      if (!files) continue;
      for (var k = 0; k < files.length; k++) {
        var key = String(files[k].fsName).toLowerCase();
        if (seen[key]) continue;
        seen[key] = true;
        out.push(files[k]);
      }
    }
    return out;
  }
  function collectSystemFontFileEntries() {
    var out = [];
    var seen = {};
    var dirs = [];
    try { dirs.push(new Folder("C:/Windows/Fonts")); } catch (_) {}
    try {
      var laf = $.getenv("LOCALAPPDATA");
      if (laf) dirs.push(new Folder(String(laf).replace(/[\/\\]+$/, "") + "/Microsoft/Windows/Fonts"));
    } catch (_) {}
    for (var di = 0; di < dirs.length; di++) {
      var dir = dirs[di];
      if (!dir || !dir.exists) continue;
      var files = [];
      try {
        files = dir.getFiles(function (f) {
          try { return f instanceof File && /\.(ttf|otf|ttc|otc)$/i.test(f.name); } catch (_) { return false; }
        }) || [];
      } catch (_) { files = []; }
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var name = String(f.name || "");
        var stem = name.replace(/\.[^\.]+$/, "");
        var key = String(stem).toLowerCase();
        if (!stem || seen[key]) continue;
        if (isGarbageFontToken(stem)) continue;
        seen[key] = true;
        out.push({
          family: decodeMaybeURIComponent(stem),
          style: "",
          postScriptName: decodeMaybeURIComponent(stem),
          sourceFile: decodeMaybeURIComponent(name),
          isBold: isBoldStyleName(stem)
        });
      }
    }
    return out;
  }
  function collectInstalledFontsMappedFromProjectFonts() {
    var out = [];
    var seen = {};
    try {
      var fonts = app.textFonts;
      for (var j = 0; j < fonts.length; j++) {
        var f = fonts[j];
        var family = decodeMaybeURIComponent(String(f.family || ""));
        var style = decodeMaybeURIComponent(String(f.style || ""));
        var ps = decodeMaybeURIComponent(String(f.postScriptName || ""));
        if (!ps) continue;
        if (isGarbageFontToken(ps) || isGarbageFontToken(family)) continue;
        var key = String(ps).toLowerCase();
        if (seen[key]) continue;
        seen[key] = true;
        out.push({
          family: family,
          style: style,
          postScriptName: ps,
          sourceFile: "",
          isBold: isBoldStyleName(style)
        });
      }
    } catch (_) {}
    if (!out.length) {
      // Fallback: if app.textFonts is unavailable in current session, still provide selectable system fonts.
      out = collectSystemFontFileEntries();
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
  function setDropdownByPostScript(dd, entries, psName) {
    if (!dd || !entries || !entries.length) return false;
    var want = String(psName || "").toLowerCase();
    if (!want) return false;
    for (var i = 0; i < entries.length; i++) {
      if (String(entries[i].postScriptName || "").toLowerCase() === want) {
        dd.selection = i;
        return true;
      }
    }
    return false;
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
  function refreshFontDropdownsFromProject(cfg, reason) {
    _fontUiProgrammaticSync = true;
    try {
      var all = collectInstalledFontsMappedFromProjectFonts();
      fontUiState.allEntries = all;

      clearDropdown(ddRegularFont);
      clearDropdown(ddBoldFont);
      if (!all.length) {
        ddRegularFont.add("item", "未检测到可用字体（已尝试 app.textFonts + Windows Fonts）");
        ddRegularFont.selection = 0;
        ddRegularFont.enabled = false;
      } else {
        ddRegularFont.enabled = true;
        for (var r = 0; r < all.length; r++) ddRegularFont.add("item", fontLabel(all[r]));
        var regularCfg = cfg && cfg.fontRegularCandidates && cfg.fontRegularCandidates.length ? cfg.fontRegularCandidates[0] : "";
        if (!setDropdownByPostScript(ddRegularFont, all, regularCfg)) ddRegularFont.selection = 0;
        // If selected entry is still invalid for any reason, move to first valid font.
        if (ddRegularFont.selection) {
          var sidx = Number(ddRegularFont.selection.index);
          if (sidx >= 0 && sidx < all.length) {
            var se = all[sidx];
            if (isGarbageFontToken(se.postScriptName) || isGarbageFontToken(se.family)) {
              ddRegularFont.selection = 0;
            }
          }
        }
      }

      ddBoldFont.add("item", "无（仿加粗）");
      for (var b = 0; b < all.length; b++) ddBoldFont.add("item", fontLabel(all[b]));
      ddBoldFont.selection = 0;
      ddBoldFont.enabled = true;

      var boldCfg = cfg && cfg.fontBoldCandidates && cfg.fontBoldCandidates.length ? cfg.fontBoldCandidates[0] : "";
      var regularCfg0 = cfg && cfg.fontRegularCandidates && cfg.fontRegularCandidates.length ? cfg.fontRegularCandidates[0] : "";
      if (boldCfg && String(boldCfg).toLowerCase() !== String(regularCfg0).toLowerCase()) {
        for (var bi = 0; bi < all.length; bi++) {
          if (String(all[bi].postScriptName || "").toLowerCase() === String(boldCfg).toLowerCase()) {
            ddBoldFont.selection = bi + 1;
            break;
          }
        }
      } else if (all.length && ddRegularFont.selection && ddRegularFont.selection.index >= 0) {
        var pickedRegular = all[ddRegularFont.selection.index];
        var autoBold = pickAutoBoldForRegular(pickedRegular);
        if (autoBold) {
          for (var bj = 0; bj < all.length; bj++) {
            if (String(all[bj].postScriptName) === String(autoBold.postScriptName)) {
              ddBoldFont.selection = bj + 1;
              break;
            }
          }
        }
      }

      if (!all.length) {
        log("字体列表: 未检测到可用字体（app.textFonts 与 Windows Fonts 均为空）。");
      } else {
        log("字体列表已刷新: total=" + all.length + "（来源：app.textFonts，必要时回退 Windows Fonts 目录）。");
      }
    } finally {
      _fontUiProgrammaticSync = false;
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
      txtRegularPicked.text = r0 ? ("当前: " + (rLabel || r0)) : "当前: (未设置)";
      if (cfg && cfg.fontHasRealBold === false) {
        txtBoldPicked.text = "当前: 无（仿加粗）";
      } else {
        txtBoldPicked.text = b0 ? ("当前: " + (bLabel || b0)) : "当前: (未设置)";
      }
    } catch (_) {}
  }

  function mergeFontCandidates(primary, fallbackA, fallbackB) {
    return uniqStrings((primary || []).concat(fallbackA || []).concat(fallbackB || []));
  }

  function ensureFolderExists(folder) {
    if (!folder.exists) folder.create();
    return folder.exists;
  }

  function removeFileIfExists(f) {
    try { if (f && f.exists) f.remove(); } catch (_) {}
  }

  function quoteForCmdPath(raw) {
    var s = String(raw == null ? "" : raw);
    return "\"" + s.replace(/"/g, "\"\"") + "\"";
  }

  function copyToFontsFolder(srcFile, overwrite) {
    var fontsDir = getUserFontsFolder(true);
    if (!fontsDir) {
      throw new Error("无法创建用户字体目录（%APPDATA%\\com.word_to_photoshop\\fonts）。");
    }
    var dst = new File(fontsDir.fsName + "/" + srcFile.name);
    if (dst.exists && overwrite !== true) {
      throw new Error("目标已存在: " + dst.fsName);
    }
    if (dst.exists) removeFileIfExists(dst);
    if (!srcFile.copy(dst.fsName)) {
      throw new Error("复制字体失败: " + srcFile.fsName + " -> " + dst.fsName);
    }
    return dst;
  }

  function installFontForCurrentUser(fontFile) {
    try {
      var tempDir = Folder.temp;
      var runId = String(new Date().getTime());
      var script = new File(tempDir.fsName + "/word_import_install_font_" + runId + ".ps1");
      var logFile = new File(tempDir.fsName + "/word_import_install_font_" + runId + ".log");
      script.encoding = "UTF-8";
      if (!script.open("w")) throw new Error("无法写入临时安装脚本");
      try {
        script.write("param([string]$SourcePath)\r\n");
        script.write("$ErrorActionPreference='Stop'\r\n");
        script.write("$fontsDir = Join-Path $env:LOCALAPPDATA 'Microsoft\\Windows\\Fonts'\r\n");
        script.write("if(-not (Test-Path $fontsDir)){ New-Item -ItemType Directory -Path $fontsDir -Force | Out-Null }\r\n");
        script.write("$src = Get-Item -LiteralPath $SourcePath\r\n");
        script.write("$dst = Join-Path $fontsDir $src.Name\r\n");
        script.write("Copy-Item -LiteralPath $src.FullName -Destination $dst -Force\r\n");
        script.write("$regPath = 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'\r\n");
        script.write("if(-not (Test-Path $regPath)){ New-Item -Path $regPath -Force | Out-Null }\r\n");
        script.write("New-ItemProperty -Path $regPath -Name $src.Name -Value $src.Name -PropertyType String -Force | Out-Null\r\n");
        script.write("Write-Output ('OK|' + $dst)\r\n");
      } finally {
        script.close();
      }
      var cmd = "powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File " +
        quoteForCmdPath(script.fsName) +
        " -SourcePath " + quoteForCmdPath(fontFile.fsName) +
        " > " + quoteForCmdPath(logFile.fsName) + " 2>&1";
      app.system(cmd);
      var out = "";
      try {
        logFile.encoding = "UTF-8";
        if (logFile.open("r")) {
          try { out = String(logFile.read() || ""); } finally { logFile.close(); }
        }
      } catch (_) {}
      try { script.remove(); } catch (_) {}
      try { logFile.remove(); } catch (_) {}
      if (String(out).indexOf("OK|") >= 0) return { ok: true, output: out };
      return { ok: false, output: out };
    } catch (e) {
      return { ok: false, output: String(e && e.message ? e.message : e) };
    }
  }

  function detectFontCandidatesFromInstalled(fontFile, cfg) {
    var all = [];
    var token = normalizeFontToken(String(fontFile && fontFile.name ? fontFile.name : "").replace(/\.[^\.]+$/, ""));
    try {
      var fonts = app.textFonts;
      for (var i = 0; i < fonts.length; i++) {
        var f = fonts[i];
        var family = String(f.family || "");
        var style = String(f.style || "");
        var ps = String(f.postScriptName || "");
        var merge = normalizeFontToken(family + " " + style + " " + ps);
        if (!token || merge.indexOf(token) >= 0 || (token.length > 5 && token.indexOf(normalizeFontToken(family)) >= 0)) {
          all.push({ family: family, style: style, postScriptName: ps });
        }
      }
    } catch (_) {}
    if (!all.length) {
      return {
        families: [],
        regular: "",
        bold: "",
        hasRealBold: false
      };
    }
    var families = [];
    var regular = "";
    var bold = "";
    for (var j = 0; j < all.length; j++) {
      var it = all[j];
      if (it.family) families.push(it.family);
      var st = String(it.style || "").toLowerCase();
      if (!regular && !/(bold|black|heavy|semibold|demibold|extrabold|粗)/i.test(st)) {
        regular = it.postScriptName;
      }
      if (!bold && /(bold|black|heavy|semibold|demibold|extrabold|粗)/i.test(st)) {
        bold = it.postScriptName;
      }
    }
    if (!regular) regular = String(all[0].postScriptName || "");
    var hasRealBold = !!(bold && regular && String(bold) !== String(regular));
    if (!bold) bold = regular;
    return {
      families: uniqStrings(families),
      regular: regular,
      bold: bold,
      hasRealBold: hasRealBold
    };
  }

  function writeFontCandidatesToCfg(cfg, detected, sourceFontFile) {
    var regularPrimary = detected && detected.regular ? [detected.regular] : [];
    var boldPrimary = detected && detected.bold ? [detected.bold] : regularPrimary;
    var familyPrimary = detected && detected.families ? detected.families : [];

    cfg.fontRegularCandidates = mergeFontCandidates(regularPrimary, cfg.fontRegularCandidates, DEFAULT_FONT_REGULAR_FALLBACK);
    cfg.fontBoldCandidates = mergeFontCandidates(boldPrimary, [], DEFAULT_FONT_BOLD_FALLBACK);
    cfg.fontFamilyNames = mergeFontCandidates(familyPrimary, cfg.fontFamilyNames, DEFAULT_FONT_FAMILY_FALLBACK);
    cfg.fontSourceFile = sourceFontFile ? String(sourceFontFile.fsName || sourceFontFile) : "";
    cfg.fontHasRealBold = !!(detected && detected.hasRealBold);
  }

  function applyDetectedFontToCfgAndUi(fontFileForDetect, logLines) {
    var detected = detectFontCandidatesFromInstalled(fontFileForDetect, state.cfg);
    writeFontCandidatesToCfg(state.cfg, detected, fontFileForDetect);
    api.saveSettingsToDisk(state.context.settingsFile, state.cfg);
    refreshFontDropdownsFromProject(state.cfg, "fontFileInstall");
    updateFontPickedLabels(state.cfg);
    if (logLines && logLines.length) {
      for (var li = 0; li < logLines.length; li++) log(logLines[li]);
    }
    log("已从字体文件更新候选字体并写入 settings.json。");
    log("若下拉列表未显示新字体，请完全退出并重新打开 Photoshop，再点「刷新系统字体列表」。");
  }

  function pickFontFileAndIntegrate(mode) {
    try {
      if (!state || !state.context || !state.context.settingsFile) {
        alert("上下文未就绪，请重新打开面板或点击「重新扫描」。");
        return;
      }
      var picked = File.openDialog("选择字体文件（ttf / otf / ttc）", "*.ttf;*.otf;*.ttc");
      if (!picked || !picked.exists) return;

      var workFile = picked;
      var extraLogs = [];

      if (mode === "copy" || mode === "both") {
        try {
          workFile = copyToFontsFolder(picked, false);
          extraLogs.push("已复制到用户字体目录: " + workFile.fsName);
        } catch (eCopy) {
          var msg = String(eCopy && eCopy.message ? eCopy.message : eCopy);
          if (msg.indexOf("目标已存在") >= 0) {
            if (!confirm("用户字体目录中已存在同名文件，是否覆盖？")) return;
            workFile = copyToFontsFolder(picked, true);
            extraLogs.push("已覆盖用户字体目录: " + workFile.fsName);
          } else {
            throw eCopy;
          }
        }
      }

      if (mode === "install" || mode === "both") {
        var ins = installFontForCurrentUser(picked);
        if (!ins.ok) {
          log("用户级字体安装失败: " + String(ins.output || "").replace(/\s+/g, " ").slice(0, 400));
          if (mode === "install") {
            alert("安装失败，详见日志。");
            return;
          }
        } else {
          extraLogs.push("用户级字体安装输出: " + String(ins.output || "").replace(/\s+/g, " ").slice(0, 220));
        }
      }

      applyDetectedFontToCfgAndUi(workFile, extraLogs);
    } catch (e) {
      alert("字体操作失败: " + (e && e.message ? e.message : e));
      log("字体操作失败: " + (e && e.message ? e.message : e));
    }
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
    var regularResolved = resolveDropdownEntry(ddRegularFont, fontUiState.allEntries, "regular", 0);
    if (ddRegularFont.enabled && regularResolved.entry) {
      var regularEntry = regularResolved.entry;
      cfg.fontRegularCandidates = mergeFontCandidates([decodeMaybeURIComponent(regularEntry.postScriptName)], [], DEFAULT_FONT_REGULAR_FALLBACK);
      cfg.fontFamilyNames = mergeFontCandidates([decodeMaybeURIComponent(regularEntry.family)], [], DEFAULT_FONT_FAMILY_FALLBACK);
      cfg.fontSourceFile = String(decodeMaybeURIComponent(regularEntry.sourceFile || ""));
    }
    var boldIsFaux = !!(ddBoldFont.selection && Number(ddBoldFont.selection.index) === 0);
    var boldResolved = boldIsFaux ? null : resolveDropdownEntry(ddBoldFont, fontUiState.allEntries, "bold", 1);
    if (!boldIsFaux && boldResolved && boldResolved.entry) {
      var boldEntry = boldResolved.entry;
      cfg.fontBoldCandidates = mergeFontCandidates([decodeMaybeURIComponent(boldEntry.postScriptName)], [], DEFAULT_FONT_BOLD_FALLBACK);
      var regPs2 = cfg.fontRegularCandidates && cfg.fontRegularCandidates.length ? cfg.fontRegularCandidates[0] : "";
      cfg.fontHasRealBold = String(decodeMaybeURIComponent(boldEntry.postScriptName || "")).toLowerCase() !== String(regPs2 || "").toLowerCase();
    } else {
      var regPs = cfg.fontRegularCandidates && cfg.fontRegularCandidates.length ? cfg.fontRegularCandidates[0] : "";
      cfg.fontBoldCandidates = mergeFontCandidates(regPs ? [regPs] : [], [], DEFAULT_FONT_BOLD_FALLBACK);
      cfg.fontHasRealBold = false;
    }
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

  btnCopyFontToRepo.onClick = function () {
    pickFontFileAndIntegrate("copy");
  };

  btnInstallFontUser.onClick = function () {
    pickFontFileAndIntegrate("install");
  };

  ddRegularFont.onChange = function () {
    try {
      if (!_fontUiProgrammaticSync) {
        _fontUiLastUserChangeTs = new Date().getTime();
        _fontUiLastUserRegularIdx = ddRegularFont.selection ? Number(ddRegularFont.selection.index) : -1;
      }
      if (_fontUiProgrammaticSync) return;
      if (!ddRegularFont.selection) {
        log("字体选择: ddRegularFont.selection 为空");
        return;
      }
      if (!fontUiState.allEntries || !fontUiState.allEntries.length) {
        log("字体选择: 字体列表为空（请先点“刷新系统字体列表”）");
        return;
      }
      var idx = Number(ddRegularFont.selection.index);
      var picked = fontUiState.allEntries[idx];
      if (!picked) {
        log("字体选择: regular 索引越界 index=" + idx + ", total=" + fontUiState.allEntries.length);
        return;
      }
      // Immediate UI feedback (even if saving fails).
      txtRegularPicked.text = "选择: " + String(picked.postScriptName || picked.family || "");

      var autoBold = pickAutoBoldForRegular(picked);
      ddBoldFont.selection = 0;
      if (autoBold) {
        for (var i = 0; i < fontUiState.allEntries.length; i++) {
          if (String(fontUiState.allEntries[i].postScriptName) === String(autoBold.postScriptName)) {
            ddBoldFont.selection = i + 1;
            break;
          }
        }
      }
      persistFontSelectionNow();
    } catch (e) {
      log("字体选择: regular onChange 异常: " + (e && e.message ? e.message : e));
    }
  };
  ddRegularFont.onActivate = function () {};
  ddRegularFont.onDeactivate = function () {};
  ddBoldFont.onChange = function () {
    try {
      if (!_fontUiProgrammaticSync) {
        _fontUiLastUserChangeTs = new Date().getTime();
        _fontUiLastUserBoldIdx = ddBoldFont.selection ? Number(ddBoldFont.selection.index) : -1;
      }
      if (_fontUiProgrammaticSync) return;
      if (ddBoldFont.selection && ddBoldFont.selection.index === 0) {
        txtBoldPicked.text = "选择: 无（仿加粗）";
      } else if (ddBoldFont.selection && fontUiState.allEntries && fontUiState.allEntries.length) {
        var idx = Number(ddBoldFont.selection.index) - 1;
        var picked = fontUiState.allEntries[idx];
        if (picked) txtBoldPicked.text = "选择: " + String(picked.postScriptName || picked.family || "");
      }
      persistFontSelectionNow();
    } catch (e) {
      log("字体选择: bold onChange 异常: " + (e && e.message ? e.message : e));
    }
  };
  ddBoldFont.onActivate = function () {};
  ddBoldFont.onDeactivate = function () {};

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

