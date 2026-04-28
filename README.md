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

如果只是想调大调小字体，通常改 `fontSizePt` 就够了。

### 四、导入到 Photoshop

1. 打开当前这一页对应的 PSD
2. `文件 > 脚本 > 浏览...`
3. 选择 `C:\Users\Administrator\word-to-photoshop\import_to_photoshop.jsx`
4. 选择刚才导出的 `.jsxdata`
5. 脚本会优先根据当前 PSD 文件名自动猜页码
6. 确认页码后导入

导入后效果：
- Word 里每个段落会生成一个独立文本框
- 字体固定为微软雅黑
- 加粗会保留
- 倾斜会用 Photoshop 的仿斜体效果

### 五、日常使用建议

1. 如果一整本稿子都导完了，只需要反复打开不同 PSD，然后重复“导入到 Photoshop”这一步。
2. 如果字号不合适，就回到 `settings.json` 改 `fontSizePt` 后重新导入。
3. 如果文本框间距太密或太散，就改 `verticalGap`。
4. 如果文本框太宽或太窄，就改 `boxWidth`。
