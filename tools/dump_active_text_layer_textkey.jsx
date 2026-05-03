#target photoshop

/**
 * 诊断：列出当前选中「文本图层」在 AM textKey 下的顶层键名，以及首段 paragraphStyle 内键名。
 * 用法：Photoshop → 文件 → 脚本 → 浏览… → 选本文件；先选中一段仍显示「间距组合 2」的导入文本。
 * 输出：桌面 word_import_textkey_keys.txt（无需安装 ScriptListener）。
 */
(function () {
  function keyName(k) {
    try {
      if (typeof typeIDToStringID !== "undefined") return typeIDToStringID(k) || String(k);
    } catch (_) {}
    return String(k);
  }

  function dumpDescriptorKeys(desc, lines, prefix) {
    if (!desc) return;
    try {
      var n = desc.count;
      var i;
      for (i = 0; i < n; i++) {
        lines.push(prefix + keyName(desc.getKey(i)));
      }
    } catch (e0) {
      lines.push(prefix + "(count failed: " + e0.message + ")");
    }
  }

  if (app.name !== "Adobe Photoshop") {
    alert("请在 Photoshop 中运行。");
    return;
  }
  if (!app.documents.length) {
    alert("请先打开文档。");
    return;
  }
  var layer = app.activeDocument.activeLayer;
  if (!layer || layer.kind !== LayerKind.TEXT) {
    alert("请在图层面板选中一个文本图层。");
    return;
  }

  var lines = [];
  lines.push("layer=" + layer.name);
  lines.push("--- textKey top-level keys ---");

  try {
    var layerRef = new ActionReference();
    layerRef.putIdentifier(charIDToTypeID("Lyr "), layer.id);
    var layerDesc = executeActionGet(layerRef);
    var textDesc = layerDesc.getObjectValue(stringIDToTypeID("textKey"));
    dumpDescriptorKeys(textDesc, lines, "");

    try {
      if (textDesc.hasKey(stringIDToTypeID("paragraphStyleRange"))) {
        var plist = textDesc.getList(stringIDToTypeID("paragraphStyleRange"));
        if (plist && plist.count > 0) {
          var pr = plist.getObjectValue(0);
          lines.push("--- paragraphStyleRange[0] keys ---");
          dumpDescriptorKeys(pr, lines, "range0.");
          if (pr.hasKey(stringIDToTypeID("paragraphStyle"))) {
            var ps = pr.getObjectValue(stringIDToTypeID("paragraphStyle"));
            lines.push("--- paragraphStyle keys ---");
            dumpDescriptorKeys(ps, lines, "para.");
          }
        }
      }
    } catch (e1) {
      lines.push("paragraphStyleRange dump: " + e1.message);
    }
  } catch (e2) {
    lines.push("executeActionGet failed: " + e2.message);
  }

  var out = new File(Folder.desktop.fsName + "/word_import_textkey_keys.txt");
  out.encoding = "UTF8";
  if (!out.open("w")) {
    alert("无法写入桌面文件。");
    return;
  }
  try {
    out.write(lines.join("\r\n"));
  } finally {
    out.close();
  }
  alert("已写入桌面：word_import_textkey_keys.txt\n把该文件内容发给维护者即可（无需 ScriptListener）。");
})();
