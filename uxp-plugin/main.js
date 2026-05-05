const { app, action, core } = require("photoshop");
const { localFileSystem } = require("uxp").storage;

const DEFAULT_SETTINGS = {
  fontFamilyNames: ["Microsoft YaHei", "微软雅黑", "Microsoft YaHei UI"],
  fontRegularCandidates: ["MicrosoftYaHei", "MicrosoftYaHeiUI", "MicrosoftYaHeiUI-Regular"],
  fontBoldCandidates: ["MicrosoftYaHei-Bold", "MicrosoftYaHeiUI-Bold"],
  fontSizePt: 30,
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
  useFauxItalic: true
};

const state = {
  doc: null,
  payload: null,
  pages: [],
  settings: { ...DEFAULT_SETTINGS },
  dataEntry: null,
  settingsEntry: null,
  logs: []
};

const el = {};

function byId(id) {
  return document.getElementById(id);
}

function log(message) {
  const ts = new Date().toLocaleTimeString();
  const line = `[${ts}] ${message}`;
  state.logs.push(line);
  el.logBox.value = state.logs.join("\n");
  el.logBox.scrollTop = el.logBox.scrollHeight;
}

function unitValueToNumber(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "object") {
    if (typeof v.value === "number") return v.value;
    if (typeof v._value === "number") return v._value;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizePageNumber(value) {
  let s = String(value || "").replace(/^#/, "").replace(/\s+/g, "");
  while (s.length < 3) s = "0" + s;
  return s;
}

function parseDataText(text) {
  // .jsxdata content: var WORD_IMPORT_DATA = {...};
  const fn = new Function(`${text}\n; return (typeof WORD_IMPORT_DATA !== 'undefined') ? WORD_IMPORT_DATA : null;`);
  const payload = fn();
  if (!payload || !Array.isArray(payload.pages)) throw new Error("数据格式无效：缺少 pages");
  return payload;
}

function getDocPathString(doc) {
  if (!doc) return "";
  if (typeof doc.path === "string") return doc.path;
  if (doc.path && typeof doc.path.nativePath === "string") return doc.path.nativePath;
  return "";
}

function guessPageFromName(name, pages) {
  const s = String(name || "");
  const tails = [
    /0*([0-9]{1,4})(?=[^0-9]*\.[^/.\\]+$)/g,
    /0*([0-9]{1,4})(?=[^0-9]*$)/g
  ];
  for (const re of tails) {
    re.lastIndex = 0;
    let m = null;
    let hit = null;
    while ((m = re.exec(s))) hit = m;
    if (hit && hit[1]) {
      const p = normalizePageNumber(hit[1]);
      if (pages.some((x) => String(x.page) === p)) return p;
    }
  }
  return pages.length ? String(pages[0].page) : "001";
}

function updateSettingsFromInputs() {
  const numericIds = [
    "fontSizePt",
    "startX",
    "startY",
    "boxWidth",
    "boxHeight",
    "verticalGap",
    "horizontalGap",
    "marginBottom",
    "marginRight",
    "minHorizontalGap"
  ];
  for (const id of numericIds) {
    const v = Number(el[id].value);
    if (Number.isFinite(v)) state.settings[id] = v;
  }
  state.settings.wrapToNextColumn = !!el.wrapToNextColumn.checked;
  state.settings.autoHorizontalGap = !!el.autoHorizontalGap.checked;
  state.settings.useArtboardBounds = !!el.useArtboardBounds.checked;
}

function fillInputsFromSettings() {
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (el[key] && el[key].type === "number") el[key].value = state.settings[key];
  }
  el.wrapToNextColumn.checked = !!state.settings.wrapToNextColumn;
  el.autoHorizontalGap.checked = !!state.settings.autoHorizontalGap;
  el.useArtboardBounds.checked = !!state.settings.useArtboardBounds;
}

async function pickFile(types) {
  return localFileSystem.getFileForOpening({ types });
}

async function pickSettingsFile() {
  const entry = await pickFile(["json"]);
  if (!entry) return;
  state.settingsEntry = entry;
  const raw = await entry.read();
  const parsed = JSON.parse(raw);
  state.settings = { ...DEFAULT_SETTINGS, ...parsed };
  fillInputsFromSettings();
  log(`已加载设置文件: ${entry.name}`);
}

async function saveSettings() {
  updateSettingsFromInputs();
  if (!state.settingsEntry) {
    state.settingsEntry = await localFileSystem.getFileForSaving("settings.json", { types: ["json"] });
  }
  if (!state.settingsEntry) return;
  await state.settingsEntry.write(JSON.stringify(state.settings, null, 2));
  log(`已保存默认设置: ${state.settingsEntry.name}`);
}

async function listFilesInDocFolder() {
  if (!state.doc) return [];
  const p = getDocPathString(state.doc);
  if (!p) return [];
  try {
    const folder = await localFileSystem.getEntryWithUrl(`file:${p.replace(/\\/g, "/")}`);
    const entries = await folder.getEntries();
    return entries.filter((x) => x.isFile && /\.jsxdata$/i.test(x.name));
  } catch (_e) {
    return [];
  }
}

async function bindBestDataFile() {
  const files = await listFilesInDocFolder();
  if (!files.length) {
    state.dataEntry = null;
    state.payload = null;
    el.dataName.textContent = "数据: 未绑定（请手动选择）";
    el.dataName.className = "line warn";
    renderPages();
    return;
  }
  const docName = (state.doc?.title || state.doc?.name || "").replace(/\.[^/.\\]+$/, "");
  let selected = files[0];
  const exact = files.find((f) => f.name.toLowerCase() === `${docName}.jsxdata`.toLowerCase());
  if (exact) selected = exact;
  await bindDataEntry(selected, true);
}

async function bindDataEntry(entry, auto = false) {
  const text = await entry.read();
  const payload = parseDataText(text);
  state.dataEntry = entry;
  state.payload = payload;
  state.pages = payload.pages || [];
  el.dataName.textContent = `数据: ${entry.name}${auto ? " (自动匹配)" : " (手动选择)"}`;
  el.dataName.className = "line ok";
  renderPages();
}

function renderPages() {
  el.pageList.innerHTML = "";
  if (!state.pages.length) {
    el.pageInfo.textContent = "页信息: -";
    return;
  }
  for (const p of state.pages) {
    const o = document.createElement("option");
    o.value = String(p.page);
    o.textContent = `#${p.page}`;
    el.pageList.appendChild(o);
  }
  const guessed = guessPageFromName(state.doc?.title || state.doc?.name || "", state.pages);
  const idx = state.pages.findIndex((x) => String(x.page) === String(guessed));
  el.pageList.selectedIndex = idx >= 0 ? idx : 0;
  updatePageInfo();
}

function updatePageInfo() {
  const page = getSelectedPage();
  el.pageInfo.textContent = page ? `页信息: #${page}` : "页信息: -";
}

function getSelectedPage() {
  if (!state.pages.length || el.pageList.selectedIndex < 0) return null;
  return String(state.pages[el.pageList.selectedIndex].value || state.pages[el.pageList.selectedIndex].textContent).replace("#", "");
}

function buildParagraphModels(page) {
  const paragraphs = page?.paragraphs || [];
  const out = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const segs = para.segments || [];
    let text = "";
    const ranges = [];
    let pos = 0;
    for (const seg of segs) {
      const t = String(seg.text || "");
      if (!t) continue;
      const from = pos;
      text += t;
      pos += t.length;
      ranges.push({
        from,
        to: pos,
        bold: !!seg.bold,
        italic: !!seg.italic
      });
    }
    if (!text.trim()) continue;
    const estimatedH = Math.max(
      state.settings.boxHeight + state.settings.verticalGap,
      state.settings.fontSizePt * 1.6 * Math.max(1, String(text).split(/\r|\n/).length) + state.settings.verticalGap
    );
    out.push({
      paragraphIndex: para.index || i + 1,
      text,
      ranges,
      estimatedH
    });
  }
  return out;
}

async function getLayoutBounds() {
  const doc = app.activeDocument;
  const docW = unitValueToNumber(doc.width);
  const docH = unitValueToNumber(doc.height);
  return { left: 0, top: 0, width: docW, height: docH };
}

function computeHorizontalGap(models, availableH, availableW) {
  if (!state.settings.autoHorizontalGap || !models.length || availableH <= 0) return state.settings.horizontalGap;
  const totalH = models.reduce((s, x) => s + x.estimatedH, 0);
  const columnsNeeded = Math.ceil(totalH / availableH);
  if (columnsNeeded <= 1) return state.settings.horizontalGap;
  const minGap = Math.max(0, Number(state.settings.minHorizontalGap || 0));
  const columnsFit = Math.max(1, Math.floor((availableW + minGap) / (state.settings.boxWidth + minGap)));
  const columns = Math.max(1, Math.min(columnsNeeded, columnsFit));
  if (columns <= 1) return state.settings.horizontalGap;
  return Math.max(minGap, Math.floor((availableW - columns * state.settings.boxWidth) / (columns - 1)));
}

function styleDescriptorForRange(r, fontPS) {
  return {
    _obj: "textStyle",
    fontPostScriptName: fontPS,
    fauxBold: false,
    fauxItalic: !!(r.italic && state.settings.useFauxItalic),
    syntheticItalic: !!(r.italic && state.settings.useFauxItalic),
    size: { _unit: "pointsUnit", _value: Number(state.settings.fontSizePt) },
    impliedFontSize: { _unit: "pointsUnit", _value: Number(state.settings.fontSizePt) },
    autoLeading: true
  };
}

async function createTextLayerByBatchPlay(name, text, x, y, ranges) {
  const fontPS = state.settings.fontRegularCandidates?.[0] || "MicrosoftYaHei";
  const textStyleRange = (ranges.length ? ranges : [{ from: 0, to: text.length, bold: false, italic: false }]).map((r) => ({
    _obj: "textStyleRange",
    from: r.from,
    to: r.to,
    textStyle: styleDescriptorForRange(r, fontPS)
  }));

  await action.batchPlay(
    [
      {
        _obj: "make",
        _target: [{ _ref: "textLayer" }],
        using: {
          _obj: "textLayer",
          name,
          textKey: text,
          textShape: [
            {
              _obj: "textShape",
              char: { _enum: "char", _value: "paint" },
              orientation: { _enum: "orientation", _value: "horizontal" },
              rowCount: 1,
              columnCount: 1,
              rowMajorOrder: true,
              transform: {
                _obj: "transform",
                xx: { _unit: "percentUnit", _value: 100 },
                xy: { _unit: "percentUnit", _value: 0 },
                yx: { _unit: "percentUnit", _value: 0 },
                yy: { _unit: "percentUnit", _value: 100 },
                tx: { _unit: "pixelsUnit", _value: x },
                ty: { _unit: "pixelsUnit", _value: y }
              }
            }
          ],
          textStyleRange
        }
      }
    ],
    { synchronousExecution: false, modalBehavior: "execute" }
  );
}

async function importPage(pageNumber) {
  if (!state.payload) throw new Error("请先绑定 .jsxdata 文件");
  const page = state.pages.find((x) => String(x.page) === String(pageNumber));
  if (!page) throw new Error(`未找到页码 #${pageNumber}`);

  updateSettingsFromInputs();
  const bounds = await getLayoutBounds();
  const availableW = Math.max(0, bounds.width - state.settings.startX - state.settings.marginRight);
  const availableH = Math.max(0, bounds.height - state.settings.startY - state.settings.marginBottom);

  const models = buildParagraphModels(page);
  const hGap = computeHorizontalGap(models, availableH, availableW);
  let cursorX = bounds.left + state.settings.startX;
  let cursorY = bounds.top + state.settings.startY;
  const maxY = bounds.top + bounds.height - state.settings.marginBottom;

  let importedCount = 0;
  for (const model of models) {
    if (state.settings.wrapToNextColumn && cursorY + model.estimatedH > maxY) {
      cursorX += state.settings.boxWidth + hGap;
      cursorY = bounds.top + state.settings.startY;
    }
    await createTextLayerByBatchPlay(
      `Word Import #${pageNumber}-${model.paragraphIndex}`,
      model.text,
      cursorX,
      cursorY,
      model.ranges
    );
    cursorY += model.estimatedH;
    importedCount += 1;
  }
  return { page: pageNumber, importedCount };
}

async function importCurrentPage() {
  const page = getSelectedPage();
  if (!page) throw new Error("请选择页码");
  return core.executeAsModal(async () => importPage(page), { commandName: `Import Page #${page}` });
}

async function importAllPages() {
  if (!state.pages.length) throw new Error("没有可导入页码");
  return core.executeAsModal(async () => {
    let total = 0;
    for (const p of state.pages) {
      const r = await importPage(String(p.page));
      total += r.importedCount;
    }
    return { totalPages: state.pages.length, importedCount: total };
  }, { commandName: "Import All Pages" });
}

async function reloadContext() {
  state.doc = app.activeDocument || null;
  el.docName.textContent = `PSD: ${state.doc ? (state.doc.title || state.doc.name || "-") : "-"}`;
  await bindBestDataFile();
}

async function pickDataFile() {
  const entry = await pickFile(["jsxdata", "js"]);
  if (!entry) return;
  await bindDataEntry(entry, false);
}

function initRefs() {
  [
    "docName",
    "dataName",
    "btnRefresh",
    "btnPickData",
    "btnPickSettings",
    "pageList",
    "pageInfo",
    "fontSizePt",
    "startX",
    "startY",
    "boxWidth",
    "boxHeight",
    "verticalGap",
    "horizontalGap",
    "marginBottom",
    "marginRight",
    "minHorizontalGap",
    "wrapToNextColumn",
    "autoHorizontalGap",
    "useArtboardBounds",
    "btnSaveDefaults",
    "btnImportCurrent",
    "btnImportAll",
    "logBox",
    "btnCopyLog",
    "btnClearLog"
  ].forEach((id) => {
    el[id] = byId(id);
  });
}

function attachEvents() {
  el.btnRefresh.addEventListener("click", async () => {
    try {
      await reloadContext();
      log("已重新扫描当前 PSD。");
    } catch (e) {
      log(`重新扫描失败: ${e.message}`);
    }
  });

  el.btnPickData.addEventListener("click", async () => {
    try {
      await pickDataFile();
      log("已手动绑定数据文件。");
    } catch (e) {
      log(`绑定数据失败: ${e.message}`);
    }
  });

  el.btnPickSettings.addEventListener("click", async () => {
    try {
      await pickSettingsFile();
    } catch (e) {
      log(`读取设置失败: ${e.message}`);
    }
  });

  el.pageList.addEventListener("change", updatePageInfo);

  el.btnSaveDefaults.addEventListener("click", async () => {
    try {
      await saveSettings();
    } catch (e) {
      log(`保存设置失败: ${e.message}`);
    }
  });

  el.btnImportCurrent.addEventListener("click", async () => {
    try {
      const r = await importCurrentPage();
      log(`导入完成（当前页）: #${r.page}，文本框 ${r.importedCount}`);
    } catch (e) {
      log(`导入失败（当前页）: ${e.message}`);
    }
  });

  el.btnImportAll.addEventListener("click", async () => {
    try {
      const r = await importAllPages();
      log(`导入完成（全部页）: 页数 ${r.totalPages}，文本框 ${r.importedCount}`);
    } catch (e) {
      log(`导入失败（全部页）: ${e.message}`);
    }
  });

  el.btnClearLog.addEventListener("click", () => {
    state.logs = [];
    el.logBox.value = "";
  });

  el.btnCopyLog.addEventListener("click", async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(el.logBox.value || "");
      }
      log("日志已复制。");
    } catch (e) {
      log(`复制日志失败: ${e.message}`);
    }
  });
}

async function bootstrap() {
  initRefs();
  state.settings = { ...DEFAULT_SETTINGS };
  fillInputsFromSettings();
  attachEvents();
  await reloadContext();
  log("UXP 面板已就绪。");
}

bootstrap().catch((e) => {
  const msg = `初始化失败: ${e.message}`;
  // UXP panel safe fallback
  console.error(msg);
  const box = byId("logBox");
  if (box) box.value = msg;
});
