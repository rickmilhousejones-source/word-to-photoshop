#target photoshop

/*
Import one page from a .jsxdata file.
Each Word paragraph becomes one Photoshop paragraph text box.
Settings are read from settings.json beside this script.
*/

(function () {
  function runQuickImport() {
    if (app.name !== "Adobe Photoshop") {
      alert("请在 Photoshop 中运行此脚本。");
      return;
    }

    if (app.documents.length === 0) {
      app.documents.add(1920, 1080, 72, "Word Import");
    }

    var scriptFile = new File($.fileName);
    var settingsFile = new File(scriptFile.parent.fsName + "/settings.json");
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
    if (app.documents.length === 0) app.documents.add(1920, 1080, 72, "Word Import");

    var doc = app.activeDocument;
    var scriptFile = new File($.fileName);
    var settingsFile = new File(scriptFile.parent.fsName + "/settings.json");
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

  function loadSettings(f) {
    var defaults = {
      fontFamilyNames: ["Microsoft YaHei", "微软雅黑", "Microsoft YaHei UI"],
      fontRegularCandidates: ["MicrosoftYaHei", "MicrosoftYaHeiUI", "MicrosoftYaHeiUI-Regular"],
      fontBoldCandidates: ["MicrosoftYaHei-Bold", "MicrosoftYaHeiUI-Bold"],
      fontSizePt: 36,
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
      rememberLastDataFile: true,
      lastDataFile: ""
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
        importedCount++;
      } catch (e) {
        try { layer.textItem.contents = item.fullText; } catch (_) {}
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
        var model = buildParagraphTextAndRanges(para, font, cfg);
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
      throw new Error("未找到可用字体，请确认 Photoshop 可访问到微软雅黑。");
    }

    return { regular: regular, bold: bold };
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
        return;
      }
    } catch (_) {}

    var layerRef = new ActionReference();
    layerRef.putIdentifier(charIDToTypeID("Lyr "), textLayer.id);
    var layerDesc = executeActionGet(layerRef);
    var textDesc = layerDesc.getObjectValue(stringIDToTypeID("textKey"));

    textDesc.putString(charIDToTypeID("Txt "), fullText);

    var baseStyle = new ActionDescriptor();
    fillStyleDescriptor(baseStyle, styleRanges[0].style, cfg.fontSizePt);
    textDesc.putObject(stringIDToTypeID("textStyle"), stringIDToTypeID("textStyle"), baseStyle);

    var list = new ActionList();
    for (var i = 0; i < styleRanges.length; i++) {
      var r = styleRanges[i];
      var rangeDesc = new ActionDescriptor();
      rangeDesc.putInteger(stringIDToTypeID("from"), r.from);
      rangeDesc.putInteger(stringIDToTypeID("to"), r.to);

      var styleDesc = new ActionDescriptor();
      fillStyleDescriptor(styleDesc, r.style, cfg.fontSizePt);
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

  function fillStyleDescriptor(desc, style, fontSizePt) {
    desc.putString(stringIDToTypeID("fontPostScriptName"), style.fontPostScriptName);
    desc.putBoolean(stringIDToTypeID("fauxBold"), !!style.fauxBold);
    desc.putBoolean(stringIDToTypeID("fauxItalic"), !!style.fauxItalic);
    desc.putBoolean(stringIDToTypeID("syntheticItalic"), !!style.syntheticItalic);
    desc.putUnitDouble(stringIDToTypeID("size"), charIDToTypeID("#Pnt"), fontSizePt);
    desc.putUnitDouble(stringIDToTypeID("impliedFontSize"), charIDToTypeID("#Pnt"), fontSizePt);
    desc.putBoolean(stringIDToTypeID("autoLeading"), true);
  }

  $.global.WORD_IMPORT_API = {
    buildDefaultContext: buildDefaultContext,
    chooseDataFile: chooseDataFile,
    readPayloadFromFile: readPayloadFromFile,
    saveSettingsToDisk: saveSettingsToDisk,
    performImport: performImport,
    normalizePageNumber: normalizePageNumber,
    formatImportSummary: formatImportSummary
  };

  if (!$.global.WORD_IMPORT_PANEL_MODE) {
    runQuickImport();
  }
})();
