## 漫画汉化使用步骤

### 一、先整理 Word 翻译稿

1. 每一页漫画前面单独写一个页码标记。
2. 推荐写法：

```text
#001
这一页第一段台词

这一页第二段台词

#002
下一页第一段台词
```

3. `#1`、`#01`、`#001` 都可以。
4. Word 里每个段落，导入 Photoshop 后都会变成一个独立文本框。

### 二、导出翻译稿

在 PowerShell 里运行：

```powershell
cd C:\Users\Administrator\word-to-photoshop
powershell -ExecutionPolicy Bypass -File .\export_docx_styles.ps1
```

然后按弹窗操作：
1. 选择你的 Word 翻译稿 `.docx`
2. 选择导出的 `.jsxdata` 保存位置

也可以用命令行一键导出（无弹窗）：

```powershell
powershell -ExecutionPolicy Bypass -File .\export_docx_styles.ps1 -DocxPath "D:\work\trans.docx" -OutFile "D:\work\trans.jsxdata" -Minify
```

- `-Minify`：输出更紧凑的 `.jsxdata`，读取更快、文件更小（推荐）。

### 三、先设置字号和基础排版

打开：

`C:\Users\Administrator\word-to-photoshop\settings.json`

常用要改的只有这几个：

- `fontSizePt`：字号
- `startX`：第一个文本框横坐标
- `startY`：第一个文本框纵坐标
- `boxWidth`：文本框宽度
- `boxHeight`：文本框高度
- `verticalGap`：每个文本框之间的垂直间距
- `refreshEveryN`：导入大量段落时每 N 段刷新一次 UI（默认 20）
- `importMode`：默认导入模式（`currentPage` / `allPages`）
- `rememberLastDataFile`：是否记住上次导入的 `.jsxdata` 路径
- `lastDataFile`：上次导入的 `.jsxdata` 路径（脚本会自动写入）

如果只是想调大调小字体，通常改 `fontSizePt` 就够了。

### 四、导入到 Photoshop

1. 打开当前这一页对应的 PSD
2. `文件 > 脚本 > 浏览...`
3. 选择 `C:\Users\Administrator\word-to-photoshop\import_to_photoshop.jsx`
4. 脚本会优先自动定位要导入的 `.jsxdata`（同目录同名优先，其次使用上次记住的路径）；找不到时才会弹窗让你选
5. 脚本会优先根据当前 PSD 文件名自动猜页码
6. 在窗口里选择“仅导入当前页 / 导入全部页”，确认后导入

导入后效果：
- Word 里每个段落会生成一个独立文本框
- 字体固定为微软雅黑
- 加粗会保留
- 倾斜会用 Photoshop 的仿斜体效果

### 四点五、常驻面板（推荐）

如果你想要类似插件的持续交互窗口：

1. 在 Photoshop 中执行 `文件 > 脚本 > 浏览...`
2. 选择 `C:\Users\Administrator\word-to-photoshop\import_panel.jsx`
3. 面板会常驻，可反复操作：
   - 自动扫描当前 PSD 对应 `.jsxdata`
   - 页码与段落数预览
   - 导入当前页 / 导入全部页
   - 直接修改布局参数并导入
   - 查看导入日志与错误明细

绑定规则：
- 优先当前 PSD 同目录同名（或同目录可用）`.jsxdata`
- 若未匹配到，会显示“未绑定”，必须手动选择数据文件后才能导入

### 四点六、CEP 旧版可停靠面板（当前主流程，推荐）

考虑到国内网络环境与 Creative Cloud 安装稳定性，当前主线改为 CEP 面板壳（调用现有 JSX 导入逻辑）。

CEP 面板目录：

- `C:\Users\Administrator\word-to-photoshop\cep-extension\com.word_to_photoshop.panel`

一键安装（给测试用户，双击即可）：

1. 双击 `安装脚本.cmd`
2. 重启 Photoshop
3. 打开 `窗口 > 扩展(旧版) > Word Import CEP`

一键卸载：

1. 双击 `卸载脚本.cmd`
2. 重启 Photoshop

手动安装（开发侧）：

1. 开启 CEP 调试模式（管理员 PowerShell）：

```powershell
reg add "HKCU\Software\Adobe\CSXS.10" /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f
```

2. 把扩展目录复制到 CEP 扩展目录（示例）：

```powershell
mkdir "$env:APPDATA\Adobe\CEP\extensions" -Force
robocopy "C:\Users\Administrator\word-to-photoshop\cep-extension\com.word_to_photoshop.panel" "$env:APPDATA\Adobe\CEP\extensions\com.word_to_photoshop.panel" /E
```

3. 重启 Photoshop 后打开：
   - `窗口 > 扩展(旧版) > Word Import CEP`
4. 在 CEP 面板中点击：
   - `打开 ScriptUI 常驻面板`（调用 `import_panel.jsx`）
   - 或 `执行一次性导入`（调用 `import_to_photoshop.jsx`）

### 四点七、UXP 可停靠插件面板（暂停开发）

UXP 版本代码仍保留在 `uxp-plugin`，但当前不作为主流程；后续网络与分发条件成熟后再恢复推进。

历史 UXP 流程（暂不推荐）：

1. 打开 **UXP Developer Tool**
2. 选择 **Add Plugin**，指向：
   - `C:\Users\Administrator\word-to-photoshop\uxp-plugin\manifest.json`
3. 点击 **Load / Reload**
4. 在 Photoshop 中打开插件面板：
   - `插件 > 开发者 > Word Import`（名称可能随 UXP 工具显示略有差异）

UXP 面板能力：
- PSD 与 `.jsxdata` 自动绑定（可手动覆盖）
- 仅显示页码列表预览（`#001` 等）
- 中文参数编辑（字号、起始坐标、间距等）
- 当前页/全部页导入
- 日志面板（替代频繁弹窗）

### 四点八、JSX 兼容 fallback（稳定保底）

若 UXP 面板暂时不可用，仍可继续使用旧脚本流程：
- `import_to_photoshop.jsx`（一次性导入流程）
- `import_panel.jsx`（ScriptUI 常驻窗口）

### 常见问题（快速排错）

1. **脚本提示找不到页码**：检查 Word 里是否每页前都有单独一段 `#001` 这种页码标记（`#1/#01/#001` 都行）。
2. **导入很慢**：优先用 `-Minify` 导出；导入端可把 `refreshEveryN` 调大（例如 50）减少 UI 刷新频率。
3. **字体不对**：确保系统已安装微软雅黑；可在 `settings.json` 里调整 `fontFamilyNames` / `fontRegularCandidates` / `fontBoldCandidates`。

### 预识别对白框（Python + mask）

当你已经有 AI 预处理得到的黑白 mask（白色区域=对白区域）时，可先离线生成 `bubble_boxes.json`，拖拽时会优先使用该文件中的候选框，提升自动命中稳定性。

1. 安装依赖（只需一次）：

```powershell
py -m pip install opencv-python numpy
```

2. 生成坐标文件：

```powershell
py .\tools\extract_bubbles.py --mask-dir ".\tmp\masks" --output ".\tmp\bubble_boxes.json"
```

3. 把 `bubble_boxes.json` 放到 `.jsxdata` 同目录（或 PSD 同目录）。
   - 若数据文件是 `chapter_01.jsxdata`，也支持同目录放 `chapter_01.bubbles.json`（优先级更高）。
4. 重启/重开 CEP 面板后拖拽台词，日志会显示 `来源: precomputed`。

`bubble_boxes.json` 格式（核心字段）：

```json
{
  "version": 1,
  "coordinateSpace": "documentPixels",
  "pages": {
    "001": [
      { "left": 100, "top": 200, "right": 380, "bottom": 460, "centerX": 240, "centerY": 330, "area": 72800 }
    ]
  }
}
```

### 五、日常使用建议

1. 如果一整本稿子都导完了，只需要反复打开不同 PSD，然后重复“导入到 Photoshop”这一步。
2. 如果字号不合适，就回到 `settings.json` 改 `fontSizePt` 后重新导入。
3. 如果文本框间距太密或太散，就改 `verticalGap`。
4. 如果文本框太宽或太窄，就改 `boxWidth`。
