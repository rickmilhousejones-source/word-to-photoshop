#target photoshop

/*
Import one page from a .jsxdata file.
Each Word paragraph becomes one Photoshop paragraph text box.
Settings are read from settings.json beside this script.
*/

(function () {
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

  var dataFile = File.openDialog("选择由 export_docx_styles.ps1 导出的 .jsxdata 文件", "*.jsxdata;*.js");
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

  var defaultPage = guessPageFromDocument(app.activeDocument, payload.pages) || payload.pages[0].page;
  var selectedPage = prompt("输入要导入的页码，例如 001", defaultPage);
  if (!selectedPage) return;
  selectedPage = normalizePageNumber(selectedPage);

  var pageEntry = findPage(payload.pages, selectedPage);
  if (!pageEntry) {
    alert("没有找到页码 #" + selectedPage + "。\n可用页码示例：\n" + listPages(payload.pages, 20));
    return;
  }

  var doc = app.activeDocument;
  var baseProbeLayer = createTextLayer(doc, cfg, selectedPage, 0);
  var font = resolveFonts(cfg, baseProbeLayer);
  baseProbeLayer.remove();

  var importedCount = 0;
  var cursorY = cfg.startY;
  var paragraphs = pageEntry.paragraphs || [];

  for (var p = 0; p < paragraphs.length; p++) {
    var para = paragraphs[p];
    var model = buildParagraphTextAndRanges(para, font, cfg);
    if (!model.fullText) {
      continue;
    }

    var layer = createTextLayer(doc, cfg, selectedPage, para.index || (p + 1));
    layer.textItem.position = [cfg.startX, cursorY];

    try {
      applyTextWithStyleRanges(layer, model.fullText, model.styleRanges, cfg);
      importedCount++;
    } catch (e) {
      try { layer.textItem.contents = model.fullText; } catch (_) {}
      alert("第 " + (para.index || (p + 1)) + " 段导入成功，但样式应用失败。\n\n错误: " + e.message);
    }

    cursorY += estimateParagraphHeight(model.fullText, cfg);
  }

  alert("导入完成：页 #" + selectedPage + " 共生成 " + importedCount + " 个文本框。");

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
      useFauxBoldFallback: true,
      useFauxItalic: true
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

  function normalizePageNumber(value) {
    var s = String(value).replace(/^#/, "").replace(/\s+/g, "");
    while (s.length < 3) s = "0" + s;
    return s;
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
})();
