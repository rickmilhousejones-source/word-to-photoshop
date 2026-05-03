#target photoshop

/*
Import one page from a .jsxdata file.
Each Word paragraph becomes one Photoshop paragraph text box.
Settings are read from %APPDATA%\com.word_to_photoshop\settings.json (per-user, persistent).
On first launch, the file is initialized from the bundled settings.default.json
(or, for legacy installs, copied from the script folder / WORD_IMPORT_REPO_PATH).
*/

(function () {
  function runQuickImport() {
    if (app.name !== "Adobe Photoshop") {
      alert("请在 Photoshop 中运行此脚本。");
      return;
    }

    if (app.documents.length === 0) {
      try {
        app.documents.add(1920, 1080, 72, "Word Import");
      } catch (_) {
        alert("请先打开一个 PSD 文档后再导入。");
        return;
      }
    }

    var scriptFile = new File($.fileName);
    var settingsFile = getSettingsFile(scriptFile);
    var cfg = loadSettings(settingsFile);

    var dataFile = pickDataFile(app.activeDocument, cfg, scriptFile);
    if (!dataFile) return;

    var payload;
    try {
      payload = readDataFile(dataFile);
    } catch (e) {
      alert("读取导入数据失败: " + e.message);
      return;
    }

    if (!payload || !payload.pages || !payload.pages.length) {
      alert("导入数据为空或格式不正确（缺少 pages）。");
      return;
    }

    try { persistLastDataFileIfNeeded(cfg, settingsFile, dataFile); } catch (_) {}

    var defaultPage = guessPageFromDocument(app.activeDocument, payload.pages) || payload.pages[0].page;
    var selection = null;
    if ($.global.WORD_IMPORT_FORCE_CURRENT_PAGE) {
      selection = { mode: "currentPage", page: normalizePageNumber(defaultPage) };
    } else {
      selection = pickImportSelection(payload.pages, defaultPage, cfg);
    }
    if (!selection) return;

    var result = performImport(app.activeDocument, payload, selection, cfg, null);
    alert(formatImportSummary(result));
  }

  function buildDefaultContext() {
    if (app.name !== "Adobe Photoshop") throw new Error("请在 Photoshop 中运行此脚本。");
    if (app.documents.length === 0) throw new Error("请先打开 PSD 文档。");

    var doc = app.activeDocument;
    var scriptFile = new File($.fileName);
    var settingsFile = getSettingsFile(scriptFile);
    var cfg = loadSettings(settingsFile);
    var autoDataFile = tryAutoPickDataFile(doc, cfg);
    var payload = null;
    if (autoDataFile && autoDataFile.exists) {
      try { payload = readDataFile(autoDataFile); } catch (_) { payload = null; }
    }
    var defaultPage = (payload && payload.pages && payload.pages.length) ? (guessPageFromDocument(doc, payload.pages) || payload.pages[0].page) : "001";
    return {
      doc: doc,
      scriptFile: scriptFile,
      settingsFile: settingsFile,
      cfg: cfg,
      autoDataFile: autoDataFile,
      payload: payload,
      defaultPage: normalizePageNumber(defaultPage)
    };
  }

  function chooseDataFile() {
    return File.openDialog("选择由 export_docx_styles.ps1 导出的 .jsxdata 文件", "*.jsxdata;*.js");
  }

  function readPayloadFromFile(file) {
    if (!file) return null;
    return readDataFile(file);
  }

  function saveSettingsToDisk(settingsFile, cfg) {
    if (!settingsFile || !cfg) return;
    settingsFile.encoding = "UTF-8";
    if (!settingsFile.open("w")) throw new Error("无法写入 settings.json");
    try {
      settingsFile.write(prettyJSONStringify(cfg));
    } finally {
      settingsFile.close();
    }
  }

  function performImport(doc, payload, selection, cfg, logger) {
    if (!doc) throw new Error("没有打开的文档");
    if (!payload || !payload.pages || !payload.pages.length) throw new Error("导入数据为空或格式不正确（缺少 pages）");
    if (!selection || !selection.mode) throw new Error("导入模式无效");

    var baseProbeLayer = createTextLayer(doc, cfg, selection.page || "000", 0);
    var font = resolveFonts(cfg, baseProbeLayer);
    baseProbeLayer.remove();
    if (logger) {
      try {
        logger(
          "字体解析: regular=" + String(font && font.regular ? font.regular.postScriptName : "") +
          ", bold=" + String(font && font.bold ? font.bold.postScriptName : "") +
          ", boldMode=" + String(font && font.hasRealBold ? "realBold" : "fauxBoldFallback")
        );
      } catch (_) {}
    }

    var result = null;
    runWithPixelUnits(function () {
      if (selection.mode === "allPages") {
        result = importAllPages(doc, payload.pages, font, cfg);
      } else {
        result = importOnePage(doc, payload.pages, selection.page, font, cfg, { suppressAlert: true });
      }
    });

    if (logger) {
      logger(formatImportSummary(result));
    }
    return result;
  }

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

  function copyFileText(src, dst) {
    try {
      if (!src || !src.exists || !dst) return false;
      src.encoding = "UTF-8";
      if (!src.open("r")) return false;
      var raw = "";
      try { raw = src.read(); } finally { src.close(); }
      if (!raw) return false;
      dst.encoding = "UTF-8";
      if (!dst.open("w")) return false;
      try { dst.write(raw); } finally { dst.close(); }
      return true;
    } catch (_) {
      try { src.close(); } catch (__) {}
      try { dst.close(); } catch (__) {}
      return false;
    }
  }

  function tryMigrateLegacySettings(scriptFile, target) {
    try {
      if (!target || target.exists) return target && target.exists ? target : null;
      var sources = [];
      try {
        if (scriptFile && scriptFile.parent) {
          var bundledDefault = new File(scriptFile.parent.fsName + "/settings.default.json");
          if (bundledDefault.exists) sources.push(bundledDefault);
          var beside = new File(scriptFile.parent.fsName + "/settings.json");
          if (beside.exists && beside.fsName !== target.fsName) sources.push(beside);
        }
      } catch (_) {}
      try {
        var envPath = $.getenv("WORD_IMPORT_REPO_PATH");
        if (envPath) {
          envPath = String(envPath).replace(/[\u0000\r\n]/g, "").replace(/^\s+|\s+$/g, "").replace(/^["']|["']$/g, "");
          if (envPath) {
            var envFile = new File(envPath + "/settings.json");
            if (envFile.exists && envFile.fsName !== target.fsName) sources.push(envFile);
          }
        }
      } catch (_) {}

      for (var i = 0; i < sources.length; i++) {
        if (copyFileText(sources[i], target)) return target;
      }
    } catch (_) {}
    return null;
  }

  function getSettingsFile(scriptFile) {
    var userRoot = getUserDataFolder();
    if (userRoot) {
      var preferred = new File(userRoot.fsName + "/settings.json");
      if (preferred.exists) return preferred;
      tryMigrateLegacySettings(scriptFile, preferred);
      return preferred;
    }
    try {
      if (scriptFile && scriptFile.parent) {
        return new File(scriptFile.parent.fsName + "/settings.json");
      }
    } catch (_) {}
    return new File("settings.json");
  }

  function loadSettings(f) {
    var defaults = {
      fontFamilyNames: ["Microsoft YaHei", "微软雅黑", "Microsoft YaHei UI"],
      fontRegularCandidates: ["MicrosoftYaHei", "MicrosoftYaHeiUI", "MicrosoftYaHeiUI-Regular"],
      fontBoldCandidates: ["MicrosoftYaHei-Bold", "MicrosoftYaHeiUI-Bold"],
      fontSizePt: 26,
      lineSpacingPt: 31,
      startX: 50,
      startY: 80,
      boxWidth: 900,
      boxHeight: 180,
      verticalGap: 24,
      horizontalGap: 24,
      marginBottom: 50,
      marginRight: 50,
      autoHorizontalGap: true,
      minHorizontalGap: 16,
      useArtboardBounds: true,
      wrapToNextColumn: true,
      useFauxBoldFallback: true,
      useFauxItalic: true,
      bubblePaddingPx: 18,
      bubbleDetectMinArea: 18000,
      bubbleDetectMaxAreaRatio: 0.92,
      bubbleSnapMaxDistance: 720,
      bubbleUsePrecomputed: false,
      bubbleUseMaskDir: true,
      bubblePrecomputedFileName: "bubble_boxes.json",
      bubblePrecomputedPerDataFile: true,
      rememberLastDataFile: true,
      lastDataFile: "",
      textColorRgb: [34, 34, 34],
      bubbleTextAlign: "center"
    };

    if (!f.exists) {
      return defaults;
    }

    var raw = readTextFile(f);
    if (!raw) {
      return defaults;
    }

    var parsed;
    try {
      parsed = eval("(" + raw + ")");
    } catch (e) {
      throw new Error("settings.json 解析失败: " + e.message);
    }

    return mergeObjects(defaults, parsed || {});
  }

  function mergeObjects(base, override) {
    var out = {};
    var key;
    for (key in base) out[key] = base[key];
    for (key in override) out[key] = override[key];
    return out;
  }

  function normalizeTextAlignKey(raw) {
    var s = String(raw == null ? "" : raw).replace(/^\s+|\s+$/g, "").toLowerCase();
    if (s === "right") return "right";
    if (s === "center" || s === "centre" || s === "middle") return "center";
    return "left";
  }

  function typographyOptsFromAlignKey(alignKey) {
    var k = normalizeTextAlignKey(alignKey);
    return {
      alignKey: k,
      centered: k === "center"
    };
  }

  function resolveBubbleTypographyOpts(payload, cfg) {
    var fromPayload = payload && payload.textAlign != null ? String(payload.textAlign) : "";
    var fromCfg = cfg && cfg.bubbleTextAlign != null ? String(cfg.bubbleTextAlign) : "";
    var key = normalizeTextAlignKey(fromPayload || fromCfg || "center");
    return typographyOptsFromAlignKey(key);
  }

  function cloneParaWithSingleLineSegments(para) {
    var out = { segments: [] };
    var segs = (para && para.segments) ? para.segments : [];
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i] || {};
      var t = seg.text != null ? String(seg.text) : "";
      if (!t) continue;
      t = t.replace(/\r\n|\r|\n/g, " ");
      out.segments.push({
        text: t,
        bold: !!seg.bold,
        italic: !!seg.italic
      });
    }
    return out;
  }

  function readTextFile(f) {
    f.encoding = "UTF-8";
    if (!f.open("r")) throw new Error("无法打开文件: " + f.fsName);
    var s;
    try { s = f.read(); } finally { f.close(); }
    return s;
  }

  function readDataFile(f) {
    WORD_IMPORT_DATA = undefined;
    $.evalFile(f);
    if (typeof WORD_IMPORT_DATA === "undefined" || !WORD_IMPORT_DATA) {
      throw new Error("WORD_IMPORT_DATA 未定义");
    }
    return WORD_IMPORT_DATA;
  }

  function runWithPixelUnits(fn) {
    var prevRuler = null;
    var prevType = null;
    try {
      prevRuler = app.preferences.rulerUnits;
      prevType = app.preferences.typeUnits;
    } catch (_) {}

    try {
      try { app.preferences.rulerUnits = Units.PIXELS; } catch (_) {}
      // Keep type units as points for font size. Do not force typeUnits here.
      fn();
    } finally {
      try { if (prevRuler != null) app.preferences.rulerUnits = prevRuler; } catch (_) {}
      try { if (prevType != null) app.preferences.typeUnits = prevType; } catch (_) {}
    }
  }

  function pickDataFile(doc, cfg, scriptFile) {
    var auto = tryAutoPickDataFile(doc, cfg);
    if (auto) return auto;

    var suggested = null;
    try {
      if (cfg && cfg.lastDataFile) {
        var lf = new File(String(cfg.lastDataFile));
        if (lf.exists) suggested = lf;
      }
    } catch (_) {}

    if (suggested) {
      var ok = confirm("当前 PSD 目录未找到对应的 .jsxdata。\n\n是否继续使用上次导入的文件？\n" + suggested.fsName);
      if (ok) return suggested;
    }

    return File.openDialog("选择由 export_docx_styles.ps1 导出的 .jsxdata 文件", "*.jsxdata;*.js");
  }

  function tryAutoPickDataFile(doc, cfg) {
    var fromDocFolder = null;
    try {
      if (doc && doc.fullName && doc.fullName.parent) {
        var folder = doc.fullName.parent;
        var base = String(doc.name || "").replace(/\.[^\.]+$/, "");
        var exact = new File(folder.fsName + "/" + base + ".jsxdata");
        if (exact.exists) {
          fromDocFolder = exact;
        } else {
          var files = folder.getFiles(function (f) {
            try { return f instanceof File && /\.jsxdata$/i.test(f.name); } catch (e) { return false; }
          });
          if (files && files.length) {
            fromDocFolder = files[0];
          }
        }
      }
    } catch (_) {}

    return fromDocFolder;
  }

  function persistLastDataFileIfNeeded(cfg, settingsFile, dataFile) {
    if (!cfg || !cfg.rememberLastDataFile) return;
    if (!settingsFile || !settingsFile.exists) return;
    if (!dataFile || !dataFile.exists) return;

    var raw = readTextFile(settingsFile);
    if (!raw) return;

    var parsed = eval("(" + raw + ")") || {};
    parsed.lastDataFile = dataFile.fsName;

    settingsFile.encoding = "UTF-8";
    if (!settingsFile.open("w")) return;
    try {
      settingsFile.write(prettyJSONStringify(parsed));
    } finally {
      settingsFile.close();
    }
  }

  function prettyJSONStringify(obj) {
    // ExtendScript doesn't reliably support JSON.stringify with spacing across all PS builds.
    try {
      if (typeof JSON !== "undefined" && JSON && JSON.stringify) {
        return JSON.stringify(obj, null, 2);
      }
    } catch (_) {}
    // Fallback: minimal JSON for simple key/value config.
    return toJSON(obj);
  }

  function toJSON(value) {
    if (value === null) return "null";
    var t = typeof value;
    if (t === "number" || t === "boolean") return String(value);
    if (t === "string") return quoteJSON(value);
    if (t === "undefined") return "null";
    if (value instanceof Array) {
      var arr = [];
      for (var i = 0; i < value.length; i++) arr.push(toJSON(value[i]));
      return "[" + arr.join(", ") + "]";
    }
    var parts = [];
    for (var k in value) {
      if (!value.hasOwnProperty(k)) continue;
      parts.push(quoteJSON(k) + ": " + toJSON(value[k]));
    }
    return "{\n  " + parts.join(",\n  ") + "\n}";
  }

  function quoteJSON(s) {
    return "\"" + String(s)
      .replace(/\\/g, "\\\\")
      .replace(/\"/g, "\\\"")
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t") + "\"";
  }

  function normalizePageNumber(value) {
    var s = String(value).replace(/^#/, "").replace(/\s+/g, "");
    while (s.length < 3) s = "0" + s;
    return s;
  }

  function pickImportSelection(pages, defaultPage, cfg) {
    var defaultMode = (cfg && cfg.importMode) ? String(cfg.importMode) : "currentPage";
    var normalizedDefaultPage = normalizePageNumber(defaultPage);

    var ui = tryBuildImportDialog(pages, normalizedDefaultPage, defaultMode);
    if (ui) {
      var result = ui.show();
      if (!result) return null;
      return result;
    }

    // Fallback without ScriptUI: keep old prompt behavior (current page only)
    var selectedPage = prompt("输入要导入的页码，例如 001", normalizedDefaultPage);
    if (!selectedPage) return null;
    selectedPage = normalizePageNumber(selectedPage);
    if (!findPage(pages, selectedPage)) {
      alert("没有找到页码 #" + selectedPage + "。\n可用页码示例：\n" + listPages(pages, 20));
      return null;
    }
    return { mode: "currentPage", page: selectedPage };
  }

  function tryBuildImportDialog(pages, defaultPage, defaultMode) {
    try {
      if (typeof Window === "undefined") return null;
    } catch (_) {
      return null;
    }

    var dlg;
    try {
      dlg = new Window("dialog", "Word Import");
    } catch (_) {
      return null;
    }

    dlg.alignChildren = "fill";

    var modeGroup = dlg.add("panel", undefined, "导入模式");
    modeGroup.orientation = "column";
    modeGroup.alignChildren = "left";
    var rbCurrent = modeGroup.add("radiobutton", undefined, "仅导入当前页");
    var rbAll = modeGroup.add("radiobutton", undefined, "导入全部页（按页分组）");
    rbCurrent.value = (defaultMode !== "allPages");
    rbAll.value = !rbCurrent.value;

    var pagePanel = dlg.add("panel", undefined, "页码选择");
    pagePanel.orientation = "column";
    pagePanel.alignChildren = "left";
    var row = pagePanel.add("group");
    row.orientation = "row";
    row.add("statictext", undefined, "页码：");

    var items = [];
    for (var i = 0; i < pages.length; i++) items.push(String(pages[i].page));
    var dd = row.add("dropdownlist", undefined, items);
    dd.preferredSize.width = 120;
    var idx = indexOfString(items, String(defaultPage));
    dd.selection = (idx >= 0) ? idx : 0;

    var info = pagePanel.add("statictext", undefined, "");
    info.preferredSize.width = 360;

    function updateInfo() {
      try {
        var page = dd.selection ? String(dd.selection.text) : items[0];
        var entry = findPage(pages, page);
        var count = entry && entry.paragraphs ? entry.paragraphs.length : 0;
        info.text = "该页段落数：" + count;
      } catch (_) {
        info.text = "";
      }
    }

    function updateEnabled() {
      pagePanel.enabled = rbCurrent.value;
    }

    dd.onChange = updateInfo;
    rbCurrent.onClick = function () { updateEnabled(); updateInfo(); };
    rbAll.onClick = function () { updateEnabled(); updateInfo(); };
    updateEnabled();
    updateInfo();

    var btns = dlg.add("group");
    btns.orientation = "row";
    btns.alignment = "right";
    var ok = btns.add("button", undefined, "导入", { name: "ok" });
    var cancel = btns.add("button", undefined, "取消", { name: "cancel" });

    function show() {
      var code = dlg.show();
      if (code !== 1) return null;
      var mode = rbAll.value ? "allPages" : "currentPage";
      var page = dd.selection ? normalizePageNumber(dd.selection.text) : normalizePageNumber(items[0]);
      return { mode: mode, page: page };
    }

    return { show: show };
  }

  function indexOfString(arr, s) {
    for (var i = 0; i < arr.length; i++) {
      if (String(arr[i]) === String(s)) return i;
    }
    return -1;
  }

  function importOnePage(doc, pages, selectedPage, font, cfg, opts) {
    selectedPage = normalizePageNumber(selectedPage);
    var pageEntry = findPage(pages, selectedPage);
    if (!pageEntry) {
      return {
        mode: "currentPage",
        page: selectedPage,
        importedCount: 0,
        errors: [{ page: selectedPage, paragraph: 0, message: "没有找到该页。可用页码示例：" + listPages(pages, 20) }]
      };
    }

    var importedCount = 0;
    var bounds = getLayoutBounds(doc, cfg);
    var cursorX = (cfg.startX || 0) + bounds.left;
    var cursorY = (cfg.startY || 0) + bounds.top;
    var paragraphs = pageEntry.paragraphs || [];
    var models = [];
    var errors = [];
    var refreshEveryN = 0;
    try { refreshEveryN = cfg && cfg.refreshEveryN ? Math.max(0, parseInt(cfg.refreshEveryN, 10)) : 0; } catch (_) { refreshEveryN = 0; }
    var maxY = bounds.height > 0 ? (bounds.top + bounds.height - (cfg.marginBottom || 0)) : 0;
    var computedGap = computeHorizontalGapIfNeededCached(paragraphs, font, cfg, maxY - bounds.top, bounds.width, models);
    if (computedGap >= 0) {
      cfg.horizontalGap = computedGap;
    }
    if (!models.length && paragraphs && paragraphs.length) {
      for (var mi = 0; mi < paragraphs.length; mi++) {
        var para0 = paragraphs[mi];
        var paraUse0 = cloneParaWithSingleLineSegments(para0);
        var model0 = buildParagraphTextAndRanges(paraUse0, font, cfg);
        if (!model0.fullText) continue;
        var estimatedH0 = estimateParagraphHeight(model0.fullText, cfg);
        models.push({
          paragraphIndex: (para0 && para0.index) ? para0.index : (mi + 1),
          fullText: model0.fullText,
          styleRanges: model0.styleRanges,
          estimatedH: estimatedH0
        });
      }
    }
    var templateLayer = null;
    try {
      templateLayer = createTextLayer(doc, cfg, selectedPage, "TEMPLATE");
      templateLayer.visible = false;
    } catch (_) {
      templateLayer = null;
    }

    for (var p = 0; p < models.length; p++) {
      var item = models[p];
      if (!item || !item.fullText) continue;

      var estimatedH = item.estimatedH;
      if (cfg.wrapToNextColumn && maxY > 0 && (cursorY + estimatedH) > maxY) {
        cursorX += (cfg.boxWidth + (cfg.horizontalGap || 0));
        cursorY = (cfg.startY || 0) + bounds.top;
      }

      var layer;
      if (templateLayer) {
        layer = templateLayer.duplicate();
        layer.visible = true;
        layer.name = "Word Import #" + selectedPage + "-" + item.paragraphIndex;
      } else {
        layer = createTextLayer(doc, cfg, selectedPage, item.paragraphIndex);
      }
      layer.textItem.position = [cursorX, cursorY];

      try {
        applyTextWithStyleRanges(layer, item.fullText, item.styleRanges, cfg);
        applyParagraphTypography(layer, cfg, typographyOptsFromAlignKey("left"));
        importedCount++;
      } catch (e) {
        try { layer.textItem.contents = item.fullText; } catch (_) {}
        try { applyParagraphTypography(layer, cfg, typographyOptsFromAlignKey("left")); } catch (_) {}
        errors.push({
          page: selectedPage,
          paragraph: item.paragraphIndex,
          message: "样式应用失败: " + e.message
        });
      }

      cursorY += estimatedH;

      if (refreshEveryN > 0 && ((p + 1) % refreshEveryN) === 0) {
        try { app.refresh(); } catch (_) {}
      }
    }

    try { if (templateLayer) templateLayer.remove(); } catch (_) {}
    var result = {
      mode: "currentPage",
      page: selectedPage,
      importedCount: importedCount,
      errors: errors
    };
    if (!(opts && opts.suppressAlert)) {
      alert(formatImportSummary(result));
    }
    return result;
  }

  function getLayoutBounds(doc, cfg) {
    var docW = getDocWidthPx(doc);
    var docH = getDocHeightPx(doc);
    var fallback = { left: 0, top: 0, width: docW, height: docH };
    if (!cfg || !cfg.useArtboardBounds) return fallback;

    var art = tryGetPreferredArtboardRect(doc, cfg);
    if (!art) return fallback;
    return {
      left: art.left,
      top: art.top,
      width: Math.max(0, art.right - art.left),
      height: Math.max(0, art.bottom - art.top)
    };
  }

  function getDocHeightPx(doc) {
    try {
      if (!doc || !doc.height) return 0;
      if (doc.height.as) return doc.height.as("px");
      return Number(doc.height);
    } catch (_) {
      return 0;
    }
  }

  function getDocWidthPx(doc) {
    try {
      if (!doc || !doc.width) return 0;
      if (doc.width.as) return doc.width.as("px");
      return Number(doc.width);
    } catch (_) {
      return 0;
    }
  }

  function tryGetPreferredArtboardRect(doc, cfg) {
    // Goal: do NOT depend on the currently selected layer.
    // Strategy:
    // 1) If active layer is inside an artboard, use it (nice default).
    // 2) Else, if document has artboards, pick the top-left-most artboard.
    try {
      var fromActive = tryGetArtboardRectFromLayerId(doc, doc && doc.activeLayer ? doc.activeLayer.id : null);
      if (fromActive) return fromActive;
    } catch (_) {}

    return tryGetTopLeftArtboardRect(doc);
  }

  function tryGetTopLeftArtboardRect(doc) {
    try {
      if (!doc) return null;
      var ids = collectAllLayerIds(doc);
      if (!ids || !ids.length) return null;

      var best = null;
      for (var i = 0; i < ids.length; i++) {
        var rect = tryGetArtboardRectFromLayerIndex(doc, ids[i]);
        if (!rect) continue;
        if (!best) {
          best = rect;
          continue;
        }
        if (rect.top < best.top || (rect.top === best.top && rect.left < best.left)) {
          best = rect;
        }
      }
      return best;
    } catch (_) {
      return null;
    }
  }

  function collectAllLayerIds(doc) {
    var out = [];
    try {
      var ref = new ActionReference();
      ref.putProperty(stringIDToTypeID("property"), stringIDToTypeID("numberOfLayers"));
      ref.putEnumerated(charIDToTypeID("Dcmn"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
      var desc = executeActionGet(ref);
      var count = desc.getInteger(stringIDToTypeID("numberOfLayers"));
      for (var i = 1; i <= count; i++) out.push(i);
      return out;
    } catch (_) {
      return out;
    }
  }

  function tryGetArtboardRectFromLayerId(doc, layerId) {
    try {
      var layerRef = new ActionReference();
      if (layerId == null) return null;
      layerRef.putIdentifier(charIDToTypeID("Lyr "), layerId);
      return readArtboardRectFromLayerRef(layerRef);
    } catch (_) {
      return null;
    }
  }

  function tryGetArtboardRectFromLayerIndex(doc, layerIndex) {
    try {
      var layerRef = new ActionReference();
      if (layerIndex == null) return null;
      layerRef.putIndex(charIDToTypeID("Lyr "), layerIndex);
      return readArtboardRectFromLayerRef(layerRef);
    } catch (_) {
      return null;
    }
  }

  function readArtboardRectFromLayerRef(layerRef) {
    try {
      var layerDesc = executeActionGet(layerRef);

      var artKey = stringIDToTypeID("artboard");
      if (!layerDesc.hasKey(artKey)) return null;

      var artDesc = layerDesc.getObjectValue(artKey);
      var rectKey = stringIDToTypeID("artboardRect");
      if (!artDesc.hasKey(rectKey)) return null;

      var rect = artDesc.getObjectValue(rectKey);
      return {
        left: rect.getDouble(stringIDToTypeID("left")),
        top: rect.getDouble(stringIDToTypeID("top")),
        right: rect.getDouble(stringIDToTypeID("right")),
        bottom: rect.getDouble(stringIDToTypeID("bottom"))
      };
    } catch (_) {
      return null;
    }
  }

  function computeHorizontalGapIfNeededCached(paragraphs, font, cfg, maxY, docWidthPx, outModels) {
    try {
      if (!cfg || !cfg.wrapToNextColumn) return -1;
      if (!cfg.autoHorizontalGap) return -1;
      if (!paragraphs || !paragraphs.length) return -1;
      if (!maxY || maxY <= 0) return -1;
      if (!docWidthPx || docWidthPx <= 0) return -1;

      var startY = cfg.startY || 0;
      var availableH = maxY - startY;
      if (availableH <= 0) return -1;

      var totalH = 0;
      for (var i = 0; i < paragraphs.length; i++) {
        var para = paragraphs[i];
        var paraUse = cloneParaWithSingleLineSegments(para);
        var model = buildParagraphTextAndRanges(paraUse, font, cfg);
        if (!model.fullText) continue;
        var estimatedH = estimateParagraphHeight(model.fullText, cfg);
        totalH += estimatedH;
        if (outModels) {
          outModels.push({
            paragraphIndex: (para && para.index) ? para.index : (i + 1),
            fullText: model.fullText,
            styleRanges: model.styleRanges,
            estimatedH: estimatedH
          });
        }
      }
      if (totalH <= 0) return -1;

      var columnsNeeded = Math.ceil(totalH / availableH);
      if (columnsNeeded <= 1) return -1;

      var marginRight = cfg.marginRight || 0;
      var availableW = docWidthPx - (cfg.startX || 0) - marginRight;
      if (availableW <= 0) return -1;

      var minGap = 0;
      try { minGap = cfg.minHorizontalGap != null ? Math.max(0, parseInt(cfg.minHorizontalGap, 10)) : 0; } catch (_) { minGap = 0; }

      // If too many columns to fit even with min gap, cap to what's possible.
      var columnsFit = Math.floor((availableW + minGap) / (cfg.boxWidth + minGap));
      if (columnsFit < 1) columnsFit = 1;
      var columns = Math.min(columnsNeeded, columnsFit);
      if (columns <= 1) return -1;

      var gap = Math.floor((availableW - (columns * cfg.boxWidth)) / (columns - 1));
      if (gap < minGap) gap = minGap;
      return gap;
    } catch (_) {
      return -1;
    }
  }

  function importAllPages(doc, pages, font, cfg) {
    var totalPages = 0;
    var totalImported = 0;
    var allErrors = [];
    for (var i = 0; i < pages.length; i++) {
      var page = String(pages[i].page);
      var r = importOnePage(doc, pages, page, font, cfg, { suppressAlert: true });
      totalPages++;
      totalImported += (r && r.importedCount) ? r.importedCount : 0;
      if (r && r.errors && r.errors.length) {
        for (var e = 0; e < r.errors.length; e++) allErrors.push(r.errors[e]);
      }
    }
    return {
      mode: "allPages",
      totalPages: totalPages,
      importedCount: totalImported,
      errors: allErrors
    };
  }

  function formatImportSummary(result) {
    if (!result) return "导入失败：未知错误。";
    var lines = [];
    if (result.mode === "allPages") {
      lines.push("导入完成：共 " + (result.totalPages || 0) + " 页，生成 " + (result.importedCount || 0) + " 个文本框。");
    } else {
      lines.push("导入完成：页 #" + (result.page || "???") + " 共生成 " + (result.importedCount || 0) + " 个文本框。");
    }
    var errs = result.errors || [];
    if (errs.length) {
      lines.push("");
      lines.push("以下段落样式应用失败（已导入纯文本）：");
      var limit = 20;
      for (var i = 0; i < Math.min(errs.length, limit); i++) {
        var it = errs[i] || {};
        lines.push("- #" + (it.page || "???") + " 段 " + (it.paragraph || "?") + ": " + (it.message || "未知错误"));
      }
      if (errs.length > limit) {
        lines.push("... 还有 " + (errs.length - limit) + " 条未显示");
      }
    }
    return lines.join("\n");
  }

  function findPage(pages, pageNumber) {
    for (var i = 0; i < pages.length; i++) {
      if (String(pages[i].page) === String(pageNumber)) return pages[i];
    }
    return null;
  }

  function listPages(pages, limit) {
    var out = [];
    var max = Math.min(pages.length, limit || pages.length);
    for (var i = 0; i < max; i++) out.push("#" + pages[i].page);
    return out.join(", ");
  }

  function guessPageFromDocument(doc, pages) {
    var candidates = [];
    try {
      if (doc && doc.name) candidates.push(String(doc.name));
    } catch (e1) {}
    try {
      if (doc && doc.fullName) candidates.push(String(doc.fullName.fsName || doc.fullName));
    } catch (e2) {}

    for (var i = 0; i < candidates.length; i++) {
      var hit = guessPageFromName(candidates[i], pages);
      if (hit) return hit;
    }
    return null;
  }

  function guessPageFromName(name, pages) {
    var s = String(name || "");

    // Prefer trailing page numbers like "... - 0001.psd" (common in scanlation PSD naming).
    // We try several "near end" patterns first, then fall back to generic scanning.
    var preferred = guessPageFromNamePreferTrailingNumber(s, pages);
    if (preferred) return preferred;

    var patterns = [
      /(?:^|[^0-9])#?0*([0-9]{1,4})(?:[^0-9]|$)/g,
      /(?:page|p)[ _-]*0*([0-9]{1,4})/ig,
      /第[ _-]*0*([0-9]{1,4})[ _-]*[页話话]/g
    ];

    for (var p = 0; p < patterns.length; p++) {
      patterns[p].lastIndex = 0;
      var match;
      while ((match = patterns[p].exec(s))) {
        var page = normalizePageNumber(match[1]);
        if (findPage(pages, page)) return page;
      }
    }

    return null;
  }

  function guessPageFromNamePreferTrailingNumber(s, pages) {
    try {
      var candidates = [];

      // Right before extension: "...0001.psd"
      candidates.push(/0*([0-9]{1,4})(?=[^0-9]*\.[^\.]+$)/g);
      // Very end (paths without extension in some cases)
      candidates.push(/0*([0-9]{1,4})(?=[^0-9]*$)/g);

      for (var i = 0; i < candidates.length; i++) {
        candidates[i].lastIndex = 0;
        var last = null;
        var m;
        while ((m = candidates[i].exec(s))) last = m;
        if (last && last[1] != null) {
          var page = normalizePageNumber(last[1]);
          if (findPage(pages, page)) return page;
        }
      }
    } catch (_) {}
    return null;
  }

  function createTextLayer(doc, cfg, selectedPage, paragraphIndex) {
    var layer = doc.artLayers.add();
    layer.kind = LayerKind.TEXT;
    layer.name = "Word Import #" + selectedPage + "-" + paragraphIndex;
    layer.textItem.kind = TextType.PARAGRAPHTEXT;
    layer.textItem.position = [cfg.startX, cfg.startY];
    layer.textItem.size = cfg.fontSizePt;
    try { layer.textItem.width = UnitValue(cfg.boxWidth, "px"); } catch (e1) {}
    try { layer.textItem.height = UnitValue(cfg.boxHeight, "px"); } catch (e2) {}
    try { layer.textItem.contents = " "; } catch (e3) {}
    return layer;
  }

  function resolveFonts(cfg, textLayer) {
    var regular = null;
    var bold = null;

    regular = findFirstExistingPostScript(cfg.fontRegularCandidates);
    bold = findFirstExistingPostScript(cfg.fontBoldCandidates);

    if (!regular) regular = findFirstMatchingFamily(cfg.fontFamilyNames, ["Regular", "常规"]);
    if (!bold) bold = findFirstMatchingFamily(cfg.fontFamilyNames, ["Bold", "粗体"]);
    if (!regular) regular = findFirstFamily(cfg.fontFamilyNames);
    if (!regular) regular = getDefaultLayerFont(textLayer);
    if (!regular) regular = getFirstAvailableFont();
    if (!bold) bold = regular;

    if (!regular || !regular.postScriptName) {
      throw new Error("未找到可用字体，请确认 Photoshop 可访问到已安装字体。");
    }
    var hasRealBold = !!(bold && regular && bold.postScriptName && regular.postScriptName && bold.postScriptName !== regular.postScriptName);
    var out = {
      regular: regular,
      bold: bold,
      hasRealBold: hasRealBold,
      fauxBoldFallbackActive: !hasRealBold && !!(cfg && cfg.useFauxBoldFallback)
    };
    try { $.global.WORD_IMPORT_LAST_FONT_RESOLVE = out; } catch (_) {}
    return out;
  }

  function findFirstExistingPostScript(candidates) {
    if (!candidates || !candidates.length) return null;
    for (var i = 0; i < candidates.length; i++) {
      var f = findFontByPostScript(candidates[i]);
      if (f) return f;
      f = getFontByNameLoose(candidates[i]);
      if (f) return f;
    }
    return null;
  }

  function findFirstMatchingFamily(families, styles) {
    if (!families || !styles) return null;
    for (var i = 0; i < families.length; i++) {
      for (var j = 0; j < styles.length; j++) {
        var f = findFontByFamilyAndStyle(families[i], styles[j]);
        if (f) return f;
      }
    }
    return null;
  }

  function findFirstFamily(families) {
    if (!families) return null;
    for (var i = 0; i < families.length; i++) {
      var f = findFontByFamily(families[i]);
      if (f) return f;
    }
    return null;
  }

  function getFirstAvailableFont() {
    try {
      var fonts = app.textFonts;
      if (!fonts) return null;
      for (var i = 0; i < fonts.length; i++) {
        if (fonts[i] && fonts[i].postScriptName) return fonts[i];
      }
    } catch (e) {}
    return null;
  }

  function getDefaultLayerFont(textLayer) {
    try {
      if (!textLayer || !textLayer.textItem || !textLayer.textItem.font) return null;
      var fontName = textLayer.textItem.font;
      return findFontByPostScript(fontName) || getFontByNameLoose(fontName) || { postScriptName: String(fontName) };
    } catch (e) {}
    return null;
  }

  function getFontByNameLoose(name) {
    try {
      if (app.fonts && app.fonts.getByName) return app.fonts.getByName(name);
    } catch (e1) {}
    try {
      if (app.textFonts && app.textFonts.getByName) return app.textFonts.getByName(name);
    } catch (e2) {}
    return null;
  }

  function findFontByPostScript(psName) {
    try {
      var fonts = app.textFonts;
      for (var i = 0; i < fonts.length; i++) {
        if (fonts[i].postScriptName === psName) return fonts[i];
      }
    } catch (e) {}
    return null;
  }

  function findFontByFamilyAndStyle(family, styleContains) {
    try {
      var fonts = app.textFonts;
      for (var i = 0; i < fonts.length; i++) {
        var f = fonts[i];
        if (containsIgnoreCase(f.family || "", family) && containsIgnoreCase(f.style || "", styleContains)) return f;
      }
    } catch (e) {}
    return null;
  }

  function findFontByFamily(family) {
    try {
      var fonts = app.textFonts;
      for (var i = 0; i < fonts.length; i++) {
        var f = fonts[i];
        if (containsIgnoreCase(f.family || "", family)) return f;
      }
    } catch (e) {}
    return null;
  }

  function containsIgnoreCase(a, b) {
    return String(a).toLowerCase().indexOf(String(b).toLowerCase()) >= 0;
  }

  function getUnitPx(v) {
    try {
      if (v == null) return NaN;
      if (v.as) return Number(v.as("px"));
      return Number(v);
    } catch (_) {
      return NaN;
    }
  }

  function rectIntersects(a, b) {
    if (!a || !b) return false;
    return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  }

  function clamp(v, minV, maxV) {
    if (v < minV) return minV;
    if (v > maxV) return maxV;
    return v;
  }

  function layerBoundsToRect(layer) {
    try {
      if (!layer || !layer.bounds || layer.bounds.length < 4) return null;
      var l = getUnitPx(layer.bounds[0]);
      var t = getUnitPx(layer.bounds[1]);
      var r = getUnitPx(layer.bounds[2]);
      var b = getUnitPx(layer.bounds[3]);
      if (!isFinite(l) || !isFinite(t) || !isFinite(r) || !isFinite(b)) return null;
      if (r <= l || b <= t) return null;
      return { left: l, top: t, right: r, bottom: b };
    } catch (_) {
      return null;
    }
  }

  function collectBubbleCandidatesFromContainer(container, scanRect, out, cfg) {
    if (!container || !container.layers) return;
    var docArea = Math.max(1, (scanRect.right - scanRect.left) * (scanRect.bottom - scanRect.top));
    var minArea = Number(cfg && cfg.bubbleDetectMinArea != null ? cfg.bubbleDetectMinArea : 18000);
    if (!isFinite(minArea) || minArea < 1000) minArea = 1000;
    var maxAreaRatio = Number(cfg && cfg.bubbleDetectMaxAreaRatio != null ? cfg.bubbleDetectMaxAreaRatio : 0.92);
    if (!isFinite(maxAreaRatio) || maxAreaRatio <= 0) maxAreaRatio = 0.92;
    var maxArea = docArea * maxAreaRatio;
    for (var i = 0; i < container.layers.length; i++) {
      var layer = container.layers[i];
      if (!layer || !layer.visible) continue;
      if (layer.typename === "LayerSet") {
        collectBubbleCandidatesFromContainer(layer, scanRect, out, cfg);
        continue;
      }
      if (layer.typename !== "ArtLayer") continue;
      if (layer.kind === LayerKind.TEXT) continue;
      var rect = layerBoundsToRect(layer);
      if (!rect || !rectIntersects(rect, scanRect)) continue;
      var w = rect.right - rect.left;
      var h = rect.bottom - rect.top;
      var area = w * h;
      if (area < minArea || area > maxArea) continue;
      if (w < 80 || h < 40) continue;
      var ratio = w > h ? (w / h) : (h / w);
      if (ratio > 10.0) continue;
      out.push({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        centerX: (rect.left + rect.right) / 2,
        centerY: (rect.top + rect.bottom) / 2,
        area: area,
        layerName: String(layer.name || "")
      });
    }
  }

  function detectBubbleCandidates(doc, cfg) {
    var bounds = getLayoutBounds(doc, cfg);
    var scanRect = {
      left: bounds.left,
      top: bounds.top,
      right: bounds.left + bounds.width,
      bottom: bounds.top + bounds.height
    };
    var list = [];
    collectBubbleCandidatesFromContainer(doc, scanRect, list, cfg);
    return list;
  }

  function pickNearestBubble(candidates, hintX, hintY, cfg) {
    if (!candidates || !candidates.length) return null;
    if (candidates.length === 1) {
      return { idx: 0, d2: 0, candidate: candidates[0] };
    }
    if (!isFinite(hintX) || !isFinite(hintY)) return null;
    var maxDist = Number(cfg && cfg.bubbleSnapMaxDistance != null ? cfg.bubbleSnapMaxDistance : 720);
    if (!isFinite(maxDist) || maxDist <= 0) maxDist = 720;
    var maxDist2 = maxDist * maxDist;
    var bestContaining = null;
    var best = null;
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      var inside = hintX >= c.left && hintX <= c.right && hintY >= c.top && hintY <= c.bottom;
      if (inside) {
        if (!bestContaining || c.area < bestContaining.candidate.area) {
          bestContaining = { idx: i, d2: 0, candidate: c };
        }
        continue;
      }
      var dx = c.centerX - hintX;
      var dy = c.centerY - hintY;
      var d2 = dx * dx + dy * dy;
      if (d2 > maxDist2) continue;
      if (!best || d2 < best.d2) best = { idx: i, d2: d2, candidate: c };
    }
    return bestContaining || best;
  }

  function normalizeSelectionRect(selRect) {
    if (!selRect) return null;
    var l = Number(selRect.left), t = Number(selRect.top), r = Number(selRect.right), b = Number(selRect.bottom);
    if (!isFinite(l) || !isFinite(t) || !isFinite(r) || !isFinite(b)) return null;
    if (r <= l || b <= t) return null;
    return {
      left: l,
      top: t,
      right: r,
      bottom: b,
      centerX: (l + r) / 2,
      centerY: (t + b) / 2,
      area: (r - l) * (b - t),
      layerName: "__selectionRect__"
    };
  }

  function normalizePrecomputedBubbleRect(raw, idx) {
    if (!raw) return null;
    var l = Number(raw.left), t = Number(raw.top), r = Number(raw.right), b = Number(raw.bottom);
    if (!isFinite(l) || !isFinite(t) || !isFinite(r) || !isFinite(b)) return null;
    if (r <= l || b <= t) return null;
    return {
      left: l,
      top: t,
      right: r,
      bottom: b,
      centerX: (l + r) / 2,
      centerY: (t + b) / 2,
      area: (r - l) * (b - t),
      layerName: "__precomputed__" + idx
    };
  }

  function parseJSONLoose(raw) {
    if (!raw) return null;
    try {
      if (typeof JSON !== "undefined" && JSON && JSON.parse) return JSON.parse(raw);
    } catch (_) {}
    try {
      return eval("(" + raw + ")");
    } catch (_) {
      return null;
    }
  }

  function buildPrecomputedBubbleFileCandidates(doc, cfg) {
    var out = [];
    var fileName = String((cfg && cfg.bubblePrecomputedFileName) ? cfg.bubblePrecomputedFileName : "bubble_boxes.json");
    var autoData = tryAutoPickDataFile(doc, cfg);
    try {
      if (autoData && autoData.exists && autoData.parent) {
        if (cfg && cfg.bubblePrecomputedPerDataFile) {
          var dataBase = String(autoData.name || "").replace(/\.[^\.]+$/, "");
          out.push(new File(autoData.parent.fsName + "/" + dataBase + ".bubbles.json"));
        }
        out.push(new File(autoData.parent.fsName + "/" + fileName));
      }
    } catch (_) {}
    try {
      if (doc && doc.fullName && doc.fullName.parent) {
        out.push(new File(doc.fullName.parent.fsName + "/" + fileName));
      }
    } catch (_) {}
    return out;
  }

  function loadPrecomputedBubblesForPage(doc, cfg, pageNorm) {
    if (!cfg || cfg.bubbleUsePrecomputed === false) {
      return { candidates: [], source: "", loaded: false, status: "disabled", tried: [] };
    }
    var files = buildPrecomputedBubbleFileCandidates(doc, cfg);
    if (!files || !files.length) return { candidates: [], source: "", loaded: false, status: "noCandidatePath", tried: [] };
    var tried = [];
    var sawExistingFile = false;
    var sawPageButEmpty = false;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      try {
        if (!f) continue;
        tried.push(String(f.fsName || f.fullName || f));
        if (!f.exists) continue;
        sawExistingFile = true;
        var parsed = parseJSONLoose(readTextFile(f));
        if (!parsed || !parsed.pages) continue;
        var pageRows = parsed.pages[String(pageNorm)] || parsed.pages[Number(pageNorm)] || null;
        if (!pageRows || !pageRows.length) {
          if (pageRows && pageRows.length === 0) sawPageButEmpty = true;
          continue;
        }
        var out = [];
        for (var j = 0; j < pageRows.length; j++) {
          var n = normalizePrecomputedBubbleRect(pageRows[j], j);
          if (n) out.push(n);
        }
        if (out.length) {
          return {
            candidates: out,
            source: String(f.fsName || f.fullName || f),
            loaded: true,
            status: "loaded",
            tried: tried
          };
        }
      } catch (_) {}
    }
    var status = "notFound";
    if (sawExistingFile && sawPageButEmpty) status = "pageEmpty";
    else if (sawExistingFile) status = "pageMissing";
    return { candidates: [], source: "", loaded: false, status: status, tried: tried };
  }

  function quoteForCmdPath(raw) {
    var s = String(raw == null ? "" : raw);
    return "\"" + s.replace(/"/g, "\"\"") + "\"";
  }

  function getRepoRootForMaskTools() {
    try {
      var scriptFile = new File($.fileName);
      if (scriptFile && scriptFile.parent) return scriptFile.parent;
    } catch (_) {}
    return null;
  }

  function guessPageFromMaskStem(stem) {
    try {
      var s = String(stem || "");
      var re = /0*([0-9]{1,4})(?=[^0-9]*$)/g;
      var last = null;
      var m;
      while ((m = re.exec(s))) last = m;
      if (last && last[1] != null) return normalizePageNumber(last[1]);
    } catch (_) {}
    return null;
  }

  function findMaskFileForPage(doc, pageNorm) {
    try {
      if (!doc || !doc.fullName || !doc.fullName.parent) return null;
      var maskFolder = new Folder(doc.fullName.parent.fsName + "/mask");
      if (!maskFolder.exists) return null;

      var tryNames = [
        String(pageNorm) + ".png",
        String(pageNorm) + ".jpg",
        String(pageNorm) + ".jpeg",
        String(pageNorm) + ".webp"
      ];
      var n = parseInt(String(pageNorm), 10);
      if (!isNaN(n)) {
        tryNames.push(String(n) + ".png");
        tryNames.push(String(n) + ".jpg");
      }
      for (var t = 0; t < tryNames.length; t++) {
        var tf = new File(maskFolder.fsName + "/" + tryNames[t]);
        if (tf.exists) return tf;
      }

      var files = maskFolder.getFiles();
      if (!files) return null;
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        if (!(f instanceof File)) continue;
        var nm = String(f.name || "");
        if (!/\.(png|jpg|jpeg|webp|bmp|tif|tiff)$/i.test(nm)) continue;
        var stem = nm.replace(/\.[^\.]+$/, "");
        if (!stem || stem === "_viz") continue;
        if (String(stem).indexOf("_viz") === 0) continue;
        var guessed = guessPageFromMaskStem(stem);
        if (guessed && String(guessed) === String(pageNorm)) return f;
      }
    } catch (_) {}
    return null;
  }

  function runMaskToBoxes(repoRoot, maskFile, outJsonFile) {
    try {
      var py = new File(repoRoot.fsName + "/tools/mask_to_boxes.py");
      if (!py.exists) return "no_script";
      var tempDir = Folder.temp;
      var runId = String(new Date().getTime());
      var logFile = new File(tempDir.fsName + "/word_import_mask_boxes_" + runId + ".log");
      var launchers = ["py", "python", "python3"];
      var scriptArgs =
        quoteForCmdPath(py.fsName) +
        " --mask " + quoteForCmdPath(maskFile.fsName) +
        " --out " + quoteForCmdPath(outJsonFile.fsName);
      for (var li = 0; li < launchers.length; li++) {
        var launcher = launchers[li];
        var runner = new File(tempDir.fsName + "/word_import_mask_run_" + launcher + "_" + runId + ".cmd");
        runner.encoding = "UTF-8";
        if (!runner.open("w")) continue;
        try {
          runner.write("@echo off\r\n");
          runner.write(launcher + " " + scriptArgs + " > " + quoteForCmdPath(logFile.fsName) + " 2>&1\r\n");
          runner.write("exit /b %errorlevel%\r\n");
        } finally {
          runner.close();
        }
        try {
          if (outJsonFile.exists) outJsonFile.remove();
        } catch (_) {}
        app.system("cmd /d /c " + quoteForCmdPath(runner.fsName));
        if (outJsonFile.exists) return "ok";
      }
    } catch (_) {}
    return "failed";
  }

  function parseMaskJsonToResult(outJson, maskFile) {
    var maskPathStr = String(maskFile.fsName || "");
    try {
      var raw = readTextFile(outJson);
      var parsed = parseJSONLoose(raw);
      if (!parsed || !parsed.boxes) {
        return {
          candidates: [],
          source: maskPathStr,
          loaded: false,
          status: "maskJsonInvalid",
          tried: [maskPathStr],
          maskPath: maskPathStr,
          maskPass: ""
        };
      }
      var out = [];
      for (var j = 0; j < parsed.boxes.length; j++) {
        var n = normalizePrecomputedBubbleRect(parsed.boxes[j], j);
        if (n) out.push(n);
      }
      return {
        candidates: out,
        source: maskPathStr,
        loaded: out.length > 0,
        status: out.length ? "loaded" : "maskEmpty",
        tried: [maskPathStr],
        maskPath: maskPathStr,
        maskPass: parsed.pass ? String(parsed.pass) : ""
      };
    } catch (e) {
      return {
        candidates: [],
        source: maskPathStr,
        loaded: false,
        status: "maskReadErr",
        tried: [maskPathStr],
        maskPath: maskPathStr,
        maskPass: ""
      };
    }
  }

  function loadMaskBubblesForPage(doc, cfg, pageNorm) {
    var empty = {
      candidates: [],
      source: "",
      loaded: false,
      status: "disabled",
      tried: [],
      maskPath: "",
      maskPass: ""
    };
    if (!cfg || cfg.bubbleUseMaskDir === false) {
      empty.status = "disabled";
      return empty;
    }
    if (!doc || !doc.fullName || !doc.fullName.parent) {
      empty.status = "noDocPath";
      return empty;
    }

    var maskFile = findMaskFileForPage(doc, pageNorm);
    if (!maskFile || !maskFile.exists) {
      empty.status = "maskNotFound";
      empty.tried = [String(pageNorm)];
      return empty;
    }

    var repoRoot = getRepoRootForMaskTools();
    if (!repoRoot) {
      empty.status = "noRepo";
      empty.maskPath = String(maskFile.fsName);
      empty.tried = [String(maskFile.fsName)];
      return empty;
    }

    var tempDir = Folder.temp;
    var modKey = "0";
    try {
      var md = maskFile.modified;
      if (md && md.getTime) modKey = String(md.getTime());
      else modKey = String(md || "0");
    } catch (_) {
      modKey = String(new Date().getTime());
    }
    var cacheKey = String(pageNorm) + "|" + String(maskFile.fsName) + "|" + modKey;
    try {
      if (!$.global.WORD_IMPORT_MASK_BOX_CACHE) $.global.WORD_IMPORT_MASK_BOX_CACHE = {};
      var hit = $.global.WORD_IMPORT_MASK_BOX_CACHE[cacheKey];
      if (hit && hit.jsonPath) {
        var jf = new File(String(hit.jsonPath));
        if (jf.exists) return parseMaskJsonToResult(jf, maskFile);
      }
    } catch (_) {}

    var outJson = new File(tempDir.fsName + "/word_import_mask_boxes_page_" + String(pageNorm) + "_" + modKey + ".json");
    var run = runMaskToBoxes(repoRoot, maskFile, outJson);
    if (run !== "ok" || !outJson.exists) {
      return {
        candidates: [],
        source: "",
        loaded: false,
        status: "maskPythonFailed",
        tried: [String(maskFile.fsName)],
        maskPath: String(maskFile.fsName),
        maskPass: ""
      };
    }

    var result = parseMaskJsonToResult(outJson, maskFile);
    try {
      if (!$.global.WORD_IMPORT_MASK_BOX_CACHE) $.global.WORD_IMPORT_MASK_BOX_CACHE = {};
      $.global.WORD_IMPORT_MASK_BOX_CACHE[cacheKey] = { jsonPath: String(outJson.fsName) };
    } catch (_) {}
    return result;
  }

  function buildParagraphTextAndRanges(para, font, cfg) {
    var full = "";
    var ranges = [];
    var pos = 0;
    var segs = (para && para.segments) ? para.segments : [];

    for (var s = 0; s < segs.length; s++) {
      var seg = segs[s] || {};
      var t = seg.text != null ? String(seg.text) : "";
      if (!t) continue;

      var start = pos;
      full += t;
      pos += t.length;
      ranges.push(makeStyleRange(start, pos, !!seg.bold, !!seg.italic, font, cfg));
    }

    if (ranges.length === 0) {
      ranges.push(makeStyleRange(0, full.length, false, false, font, cfg));
    }

    return { fullText: full, styleRanges: mergeRanges(ranges) };
  }

  function makeStyleRange(from, to, isBold, isItalic, font, cfg) {
    var useBoldFont = !!(isBold && font.bold && font.regular && font.bold.postScriptName !== font.regular.postScriptName);
    return {
      from: from,
      to: to,
      style: {
        fontPostScriptName: useBoldFont ? font.bold.postScriptName : font.regular.postScriptName,
        fauxBold: !!(!useBoldFont && isBold && cfg.useFauxBoldFallback),
        fauxItalic: !!(isItalic && cfg.useFauxItalic),
        syntheticItalic: !!(isItalic && cfg.useFauxItalic)
      }
    };
  }

  function mergeRanges(ranges) {
    if (!ranges || ranges.length < 2) return ranges;
    var out = [ranges[0]];
    for (var i = 1; i < ranges.length; i++) {
      var prev = out[out.length - 1];
      var cur = ranges[i];
      if (prev.to === cur.from && sameStyle(prev.style, cur.style)) {
        prev.to = cur.to;
      } else {
        out.push(cur);
      }
    }
    return out;
  }

  function sameStyle(a, b) {
    return a.fontPostScriptName === b.fontPostScriptName &&
      !!a.fauxBold === !!b.fauxBold &&
      !!a.fauxItalic === !!b.fauxItalic &&
      !!a.syntheticItalic === !!b.syntheticItalic;
  }

  function estimateParagraphHeight(text, cfg) {
    var lineCount = String(text).split(/\r|\n/).length;
    var rough = (cfg.fontSizePt * 1.6 * Math.max(1, lineCount)) + cfg.verticalGap;
    if (rough < cfg.boxHeight + cfg.verticalGap) {
      rough = cfg.boxHeight + cfg.verticalGap;
    }
    return rough;
  }

  function getLineSpacingPt(cfg) {
    var v = cfg && cfg.lineSpacingPt != null ? cfg.lineSpacingPt : 31;
    var n = Number(v);
    return isNaN(n) ? 31 : n;
  }

  function clampByte(v) {
    var n = Math.round(Number(v));
    if (isNaN(n)) return 0;
    if (n < 0) return 0;
    if (n > 255) return 255;
    return n;
  }

  function applyTextColorFromCfg(textLayer, cfg) {
    if (!textLayer || !textLayer.textItem || !cfg || !cfg.textColorRgb) return;
    var rgb = cfg.textColorRgb;
    if (!(rgb instanceof Array) || rgb.length < 3) return;
    try {
      var sc = new SolidColor();
      sc.rgb.red = clampByte(rgb[0]);
      sc.rgb.green = clampByte(rgb[1]);
      sc.rgb.blue = clampByte(rgb[2]);
      textLayer.textItem.color = sc;
    } catch (_) {}
  }

  function forceParagraphLeadingByAM(textLayer, cfg, opts) {
    if (!textLayer) return;
    opts = opts || {};
    var leadPt = getLineSpacingPt(cfg);
    try {
      var layerRef = new ActionReference();
      layerRef.putIdentifier(charIDToTypeID("Lyr "), textLayer.id);
      var layerDesc = executeActionGet(layerRef);
      var textDesc = layerDesc.getObjectValue(stringIDToTypeID("textKey"));
      var currentText = "";
      try {
        currentText = textDesc.getString(charIDToTypeID("Txt "));
      } catch (_) {
        currentText = "";
      }
      var textLen = currentText ? String(currentText).length : 1;
      if (textLen < 1) textLen = 1;

      var paraStyle = new ActionDescriptor();
      paraStyle.putBoolean(stringIDToTypeID("autoLeading"), false);
      paraStyle.putUnitDouble(stringIDToTypeID("leading"), charIDToTypeID("#Pnt"), leadPt);
      try {
        var alignKey0 = opts.alignKey ? normalizeTextAlignKey(opts.alignKey) : (opts.centered ? "center" : "left");
        var alignEnum = stringIDToTypeID("left");
        if (alignKey0 === "right") alignEnum = stringIDToTypeID("right");
        else if (alignKey0 === "center") alignEnum = stringIDToTypeID("center");
        paraStyle.putEnumerated(stringIDToTypeID("align"), stringIDToTypeID("alignmentType"), alignEnum);
      } catch (_) {}

      var paraRange = new ActionDescriptor();
      paraRange.putInteger(stringIDToTypeID("from"), 0);
      paraRange.putInteger(stringIDToTypeID("to"), textLen);
      paraRange.putObject(stringIDToTypeID("paragraphStyle"), stringIDToTypeID("paragraphStyle"), paraStyle);

      var paraList = new ActionList();
      paraList.putObject(stringIDToTypeID("paragraphStyleRange"), paraRange);
      textDesc.putList(stringIDToTypeID("paragraphStyleRange"), paraList);

      var setDesc = new ActionDescriptor();
      var setRef = new ActionReference();
      setRef.putIdentifier(charIDToTypeID("Lyr "), textLayer.id);
      setDesc.putReference(charIDToTypeID("null"), setRef);
      setDesc.putObject(charIDToTypeID("T   "), stringIDToTypeID("textLayer"), textDesc);
      try {
        executeAction(charIDToTypeID("setd"), setDesc, DialogModes.NO);
      } catch (_) {
        // Older PS builds may reject paragraphStyleRange; applyParagraphTypography already set leading/justify via DOM.
      }
    } catch (_) {}
  }

  function applyParagraphTypography(textLayer, cfg, opts) {
    opts = opts || {};
    var lead = getLineSpacingPt(cfg);
    try {
      textLayer.textItem.autoLeading = false;
      textLayer.textItem.leading = UnitValue(lead, "pt");
    } catch (_) {}
    try {
      var alignKey1 = opts.alignKey ? normalizeTextAlignKey(opts.alignKey) : (opts.centered ? "center" : "left");
      if (alignKey1 === "right") textLayer.textItem.justification = Justification.RIGHT;
      else if (alignKey1 === "center") textLayer.textItem.justification = Justification.CENTER;
      else textLayer.textItem.justification = Justification.LEFT;
    } catch (_) {}
    try {
      textLayer.textItem.mojikumi = Mojikumi.NONE;
    } catch (_) {}
    // Re-apply paragraph style via ActionManager so mixed-style ranges won't reset alignment.
    forceParagraphLeadingByAM(textLayer, cfg, opts);
    applyTextColorFromCfg(textLayer, cfg);
  }

  function applyTextWithStyleRanges(textLayer, fullText, styleRanges, cfg) {
    textLayer.textItem.contents = fullText;
    textLayer.textItem.size = cfg.fontSizePt;

    // Fast path: single style for the whole paragraph -> avoid ActionDescriptor work.
    try {
      if (styleRanges && styleRanges.length === 1 && styleRanges[0].from === 0 && styleRanges[0].to === fullText.length) {
        var s = styleRanges[0].style || {};
        try { if (s.fontPostScriptName) textLayer.textItem.font = s.fontPostScriptName; } catch (_) {}
        try { if (typeof s.fauxBold !== "undefined") textLayer.textItem.fauxBold = !!s.fauxBold; } catch (_) {}
        try { if (typeof s.fauxItalic !== "undefined") textLayer.textItem.fauxItalic = !!s.fauxItalic; } catch (_) {}
        try {
          textLayer.textItem.autoLeading = false;
          textLayer.textItem.leading = UnitValue(getLineSpacingPt(cfg), "pt");
        } catch (_) {}
        return;
      }
    } catch (_) {}

    var layerRef = new ActionReference();
    layerRef.putIdentifier(charIDToTypeID("Lyr "), textLayer.id);
    var layerDesc = executeActionGet(layerRef);
    var textDesc = layerDesc.getObjectValue(stringIDToTypeID("textKey"));

    textDesc.putString(charIDToTypeID("Txt "), fullText);

    var baseStyle = new ActionDescriptor();
    fillStyleDescriptor(baseStyle, styleRanges[0].style, cfg);
    textDesc.putObject(stringIDToTypeID("textStyle"), stringIDToTypeID("textStyle"), baseStyle);

    var list = new ActionList();
    for (var i = 0; i < styleRanges.length; i++) {
      var r = styleRanges[i];
      var rangeDesc = new ActionDescriptor();
      rangeDesc.putInteger(stringIDToTypeID("from"), r.from);
      rangeDesc.putInteger(stringIDToTypeID("to"), r.to);

      var styleDesc = new ActionDescriptor();
      fillStyleDescriptor(styleDesc, r.style, cfg);
      rangeDesc.putObject(stringIDToTypeID("textStyle"), stringIDToTypeID("textStyle"), styleDesc);
      list.putObject(stringIDToTypeID("textStyleRange"), rangeDesc);
    }
    textDesc.putList(stringIDToTypeID("textStyleRange"), list);

    var desc = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putIdentifier(charIDToTypeID("Lyr "), textLayer.id);
    desc.putReference(charIDToTypeID("null"), ref);
    desc.putObject(charIDToTypeID("T   "), stringIDToTypeID("textLayer"), textDesc);
    executeAction(charIDToTypeID("setd"), desc, DialogModes.NO);
  }

  function fillStyleDescriptor(desc, style, cfg) {
    var fontSizePt = cfg && cfg.fontSizePt != null ? Number(cfg.fontSizePt) : 26;
    if (isNaN(fontSizePt)) fontSizePt = 26;
    var leadPt = getLineSpacingPt(cfg);
    desc.putString(stringIDToTypeID("fontPostScriptName"), style.fontPostScriptName);
    desc.putBoolean(stringIDToTypeID("fauxBold"), !!style.fauxBold);
    desc.putBoolean(stringIDToTypeID("fauxItalic"), !!style.fauxItalic);
    desc.putBoolean(stringIDToTypeID("syntheticItalic"), !!style.syntheticItalic);
    desc.putUnitDouble(stringIDToTypeID("size"), charIDToTypeID("#Pnt"), fontSizePt);
    desc.putUnitDouble(stringIDToTypeID("impliedFontSize"), charIDToTypeID("#Pnt"), fontSizePt);
    desc.putBoolean(stringIDToTypeID("autoLeading"), false);
    desc.putUnitDouble(stringIDToTypeID("leading"), charIDToTypeID("#Pnt"), leadPt);
  }

  /**
   * CEP drag-drop: insert one paragraph with same font/style pipeline as bulk import.
   * payload.anchorMode:
   *   - "artboardOrigin": use cfg.startX/startY from artboard/document origin.
   *   - "docPoint": use payload.docX/docY (document pixel coordinate) as bubble center.
   *   - otherwise fallback to payload.fracX / fracY in layout bounds.
   */
  function insertBubbleParagraphCEP(doc, payload) {
    if (!doc) throw new Error("没有打开的文档");
    var pageNorm = normalizePageNumber(String(payload.page || "001"));
    var paraIx = payload.paragraph != null ? payload.paragraph : 0;

    var scriptFile = new File($.fileName);
    var settingsFile = getSettingsFile(scriptFile);
    var cfg = loadSettings(settingsFile);

    var anchorMode = payload && payload.anchorMode ? String(payload.anchorMode) : "fraction";
    var docX = payload && payload.docX != null ? Number(payload.docX) : NaN;
    var docY = payload && payload.docY != null ? Number(payload.docY) : NaN;
    var fracX =
      typeof payload.fracX === "number" && !isNaN(payload.fracX) ? Math.max(0, Math.min(1, payload.fracX)) : 0.12;
    var fracY =
      typeof payload.fracY === "number" && !isNaN(payload.fracY) ? Math.max(0, Math.min(1, payload.fracY)) : 0.12;

    var para = { segments: [] };
    if (payload.segments && payload.segments.length) {
      for (var si = 0; si < payload.segments.length; si++) {
        var se = payload.segments[si] || {};
        para.segments.push({
          text: String(se.text != null ? se.text : ""),
          bold: !!se.bold,
          italic: !!se.italic
        });
      }
    } else if (payload.text != null && String(payload.text).length) {
      para.segments.push({ text: String(payload.text), bold: false, italic: false });
    } else {
      throw new Error("台词内容为空");
    }

    var out = {};
    var previewResult = null;

    runWithPixelUnits(function () {
      var bounds = getLayoutBounds(doc, cfg);
      var bw = Math.max(160, Math.min(560, Number(cfg.boxWidth || 480) * 0.45));
      var bh = Math.max(72, Math.min(320, Number(cfg.boxHeight || 180) * 0.55));

      var inset = 8;
      var x, y;
      var bubblePick = null;
      var placeAtCursorOnly = !!(payload && payload.placeAtCursorOnly);
      if (anchorMode === "docPoint" && !isNaN(docX) && !isNaN(docY)) {
        x = docX - bw / 2;
        y = docY - bh / 2;
      } else if (anchorMode === "artboardOrigin") {
        var sx = Number(cfg && cfg.startX != null ? cfg.startX : 50);
        var sy = Number(cfg && cfg.startY != null ? cfg.startY : 80);
        if (isNaN(sx)) sx = 50;
        if (isNaN(sy)) sy = 80;
        x = bounds.left + sx;
        y = bounds.top + sy;
      } else {
        var innerL = bounds.left + inset;
        var innerR = bounds.left + bounds.width - inset;
        var innerT = bounds.top + inset;
        var innerB = bounds.top + bounds.height - inset;
        var spanW = Math.max(1, innerR - innerL);
        var spanH = Math.max(1, innerB - innerT);
        var cx = innerL + fracX * spanW;
        var cy = innerT + fracY * spanH;
        x = cx - bw / 2;
        y = cy - bh / 2;
      }

      if (placeAtCursorOnly) {
        if (anchorMode === "docPoint" && !isNaN(docX) && !isNaN(docY)) {
          x = docX;
          y = docY;
        }
      }

      // Direct placement mode: do NOT rely on bubble recognition / snapping.
      // Useful when recognition is unstable; place text box at cursor point only.
      var maskPack = null;
      var bubbleCandidates = [];
      var bubbleSourceKind = "direct";
      var maskPathForDebug = "";
      var maskStatusForDebug = "";
      var maskPassForDebug = "";
      var bubbleTriedPaths = [];

      if (!placeAtCursorOnly) {
        maskPack = loadMaskBubblesForPage(doc, cfg, pageNorm);
        bubbleSourceKind = "layerDetect";

        if (maskPack && maskPack.candidates && maskPack.candidates.length) {
          bubbleCandidates = maskPack.candidates.slice(0);
          bubbleSourceKind = "mask";
          maskPathForDebug = maskPack.maskPath || "";
          maskStatusForDebug = maskPack.status || "";
          maskPassForDebug = maskPack.maskPass || "";
          bubbleTriedPaths = maskPack.tried || [];
        } else {
          bubbleCandidates = detectBubbleCandidates(doc, cfg);
          if (maskPack) {
            maskPathForDebug = maskPack.maskPath || "";
            maskStatusForDebug = maskPack.status || "";
            maskPassForDebug = maskPack.maskPass || "";
            bubbleTriedPaths = maskPack.tried || [];
          }
        }
        var selectionBubble = normalizeSelectionRect(payload && payload.selectionRect ? payload.selectionRect : null);
        if (selectionBubble) {
          bubbleCandidates.unshift(selectionBubble);
        }
        if (selectionBubble && payload && payload.preferSelectionRect) {
          bubblePick = { idx: 0, d2: 0, candidate: selectionBubble };
        } else {
          bubblePick = pickNearestBubble(bubbleCandidates, isNaN(docX) ? (x + bw / 2) : docX, isNaN(docY) ? (y + bh / 2) : docY, cfg);
        }
      }
      var hintX = isNaN(docX) ? (x + bw / 2) : docX;
      var hintY = isNaN(docY) ? (y + bh / 2) : docY;
      var rankedCandidates = [];
      for (var ci = 0; ci < bubbleCandidates.length; ci++) {
        var c0 = bubbleCandidates[ci];
        var dx0 = Number(c0.centerX) - hintX;
        var dy0 = Number(c0.centerY) - hintY;
        rankedCandidates.push({
          idx: ci,
          d2: dx0 * dx0 + dy0 * dy0,
          candidate: c0
        });
      }
      rankedCandidates.sort(function (a, b) { return a.d2 - b.d2; });
      var topN = Number(payload && payload.candidateTopN != null ? payload.candidateTopN : 5);
      if (!isFinite(topN) || topN < 1) topN = 5;
      if (topN > 20) topN = 20;
      var topCandidates = rankedCandidates.slice(0, topN);
      var selectedRank = Number(payload && payload.selectedBubbleIndex != null ? payload.selectedBubbleIndex : NaN);
      if (isFinite(selectedRank) && selectedRank >= 0 && selectedRank < topCandidates.length) {
        bubblePick = topCandidates[selectedRank];
      }
      if (payload && payload.returnBubbleCandidates) {
        var previewList = [];
        for (var pi = 0; pi < topCandidates.length; pi++) {
          var rc = topCandidates[pi];
          var c1 = rc.candidate || {};
          previewList.push({
            rank: pi,
            distancePx: Math.sqrt(Math.max(0, rc.d2)),
            left: c1.left,
            top: c1.top,
            right: c1.right,
            bottom: c1.bottom,
            centerX: c1.centerX,
            centerY: c1.centerY,
            area: c1.area,
            layerName: c1.layerName || ""
          });
        }
        previewResult = {
          previewOnly: true,
          page: pageNorm,
          paragraph: paraIx,
          bubbleSource: bubbleSourceKind,
          maskPath: maskPathForDebug,
          maskStatus: maskStatusForDebug,
          maskPass: maskPassForDebug,
          precomputedBubbleFile: "",
          precomputedStatus: maskStatusForDebug || "n/a",
          precomputedTried: bubbleTriedPaths,
          hintDocX: hintX,
          hintDocY: hintY,
          detectedBubbles: bubbleCandidates ? bubbleCandidates.length : 0,
          candidates: previewList
        };
        return;
      }
      if (!placeAtCursorOnly && bubblePick && bubblePick.candidate) {
        var pad = Number(cfg && cfg.bubblePaddingPx != null ? cfg.bubblePaddingPx : 18);
        if (!isFinite(pad) || pad < 0) pad = 18;
        var c = bubblePick.candidate;
        var innerL = c.left + pad;
        var innerT = c.top + pad;
        var innerR = c.right - pad;
        var innerB = c.bottom - pad;
        var innerW = Math.max(120, innerR - innerL);
        var innerH = Math.max(60, innerB - innerT);
        bw = innerW;
        bh = innerH;
        x = innerL;
        y = innerT;
      }

      if (placeAtCursorOnly) {
        var edge = 4;
        var pxMin = bounds.left + edge;
        var pxMax = bounds.left + bounds.width - edge;
        var pyMin = bounds.top + edge;
        var pyMax = bounds.top + bounds.height - edge;
        if (!isNaN(pxMin) && !isNaN(pxMax) && pxMin <= pxMax) {
          if (x < pxMin) x = pxMin;
          if (x > pxMax) x = pxMax;
        }
        if (!isNaN(pyMin) && !isNaN(pyMax) && pyMin <= pyMax) {
          if (y < pyMin) y = pyMin;
          if (y > pyMax) y = pyMax;
        }
      } else {
        var minX = bounds.left + inset;
        var maxX = bounds.left + bounds.width - bw - inset;
        var minY = bounds.top + inset;
        var maxY = bounds.top + bounds.height - bh - inset;
        if (!isNaN(minX) && !isNaN(maxX) && minX <= maxX) {
          if (x < minX) x = minX;
          if (x > maxX) x = maxX;
        }
        if (!isNaN(minY) && !isNaN(maxY) && minY <= maxY) {
          if (y < minY) y = minY;
          if (y > maxY) y = maxY;
        }
      }

      var probe = createTextLayer(doc, cfg, pageNorm, paraIx);
      var font = resolveFonts(cfg, probe);
      probe.remove();

      var typoOpts = resolveBubbleTypographyOpts(payload, cfg);

      var layer = doc.artLayers.add();
      layer.kind = LayerKind.TEXT;
      layer.name = "Bubble #" + pageNorm + "-" + paraIx;
      layer.textItem.size = cfg.fontSizePt;

      var model = null;
      if (placeAtCursorOnly) {
        var paraLine = cloneParaWithSingleLineSegments(para);
        model = buildParagraphTextAndRanges(paraLine, font, cfg);
        layer.textItem.kind = TextType.POINTTEXT;
        layer.textItem.position = [x, y];
        try {
          layer.textItem.contents = " ";
        } catch (_) {}
      } else {
        layer.textItem.kind = TextType.PARAGRAPHTEXT;
        layer.textItem.position = [x, y];
        try {
          layer.textItem.width = UnitValue(bw, "px");
        } catch (_) {}
        try {
          layer.textItem.height = UnitValue(bh, "px");
        } catch (_) {}
        try {
          layer.textItem.contents = " ";
        } catch (_) {}
        model = buildParagraphTextAndRanges(para, font, cfg);
      }

      if (!model.fullText || model.fullText.length === 0) {
        layer.remove();
        throw new Error("段落无法生成文本内容");
      }
      applyTextWithStyleRanges(layer, model.fullText, model.styleRanges, cfg);
      applyParagraphTypography(layer, cfg, typoOpts);

      out.layerName = layer.name;
      out.x = x;
      out.y = y;
      out.boxWidth = placeAtCursorOnly ? 0 : bw;
      out.boxHeight = placeAtCursorOnly ? 0 : bh;
      out.pointText = !!placeAtCursorOnly;
      out.boundsLeft = bounds.left;
      out.boundsTop = bounds.top;
      out.detectedBubbles = bubbleCandidates ? bubbleCandidates.length : 0;
      out.bubbleSource = bubbleSourceKind;
      out.maskPath = maskPathForDebug;
      out.maskStatus = maskStatusForDebug;
      out.maskPass = maskPassForDebug;
      out.precomputedBubbleFile = "";
      out.precomputedStatus = "";
      out.precomputedTried = bubbleTriedPaths;
      out.fontRegularPostScriptName = String(font && font.regular ? font.regular.postScriptName : "");
      out.fontBoldPostScriptName = String(font && font.bold ? font.bold.postScriptName : "");
      out.fontBoldMode = font && font.hasRealBold ? "realBold" : "fauxBoldFallback";
      if (placeAtCursorOnly) {
        out.anchorUsed = "cursorDirect";
      } else if (bubblePick && bubblePick.candidate) {
        out.anchorUsed = "bubbleSnap";
        out.snapBubbleLayerName = bubblePick.candidate.layerName;
        if (bubblePick.candidate.layerName === "__selectionRect__") {
          out.anchorUsed = "selectionBubbleSnap";
        }
      }
    });

    if (previewResult) return previewResult;
    return out;
  }

  $.global.WORD_IMPORT_API = {
    buildDefaultContext: buildDefaultContext,
    chooseDataFile: chooseDataFile,
    readPayloadFromFile: readPayloadFromFile,
    saveSettingsToDisk: saveSettingsToDisk,
    performImport: performImport,
    normalizePageNumber: normalizePageNumber,
    formatImportSummary: formatImportSummary,
    insertBubbleParagraphCEP: insertBubbleParagraphCEP
  };

  if (!$.global.WORD_IMPORT_PANEL_MODE) {
    runQuickImport();
  }
})();
