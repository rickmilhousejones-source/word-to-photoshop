# 备选方案：自建「衍生粗体」字库（非 Photoshop 仿粗）

当某字体在 Photoshop 里 **仿粗（fauxBold）几乎看不出效果**，而你又需要 **稳定的粗笔画** 时，可以在本机 **生成一份独立的粗字重字体文件**，再在插件设置里把 **粗体** 指向这份新字库。  
这样导入时粗体区间会使用 **真正的粗体面（PostScript 名不同）**，而不是依赖字符面板的「仿粗」。

## 适用与不适用

- **适用**：自有字库、明确允许修改的开源字体；或你有合法授权的衍生字库。
- **不适用 / 高风险**：系统字体（如微软雅黑）、多数商业字体——EULA 常 **禁止改轮廓或衍生发行**，请勿擅自生成衍生文件。

## 常见开源工具（自行安装与负责合规）

| 方向 | 说明 |
|------|------|
| [make-font-bolder](https://github.com/tobiasBora/make-font-bolder) | 基于 FontForge 的脚本，可从 Regular 生成更粗的 TTF（需本机安装 FontForge）。 |
| [FontForge](https://github.com/fontforge/fontforge) | 字体编辑器，可手工或使用内置脚本做轮廓加粗、调节字腔。 |
| 可变字体（Variable Font） | 若字体带 **wght** 轴，优先从官方或工具链 **导出某一粗度实例**，质量通常优于简单「撑粗」算法。 |

插件 **不包含** 上述工具，也 **不会** 自动改你的字体文件。

## 内置：生成「合成粗体」TTF（仓库自带脚本，不依赖 FontForge）

从 **2026-05** 起，仓库提供 **`tools/generate_synthetic_bold_font.py`**：仅用 **pip 安装的 `fonttools`**，把每个字形的轮廓绘制两遍并以水平位移重叠，写出一份新的 **`.ttf` 文件**（几何近似粗体，非替换字库）。

1. **Python（离线优先）**：将 **`python-3.12.7-embed-amd64.zip`** 与 **`get-pip.py`** 放入仓库 **`environment_dependencies/`**（见该目录 `README.txt`）。运行 `install_cep.ps1` 或点面板「生成 TTF…」首次流程时，会从该目录解压到 `%APPDATA%\com.word_to_photoshop\python-embed-3.12\` 并 `pip install` **`tools/requirements-fontgen.txt`**（含 fonttools、Pillow）。亦可改用本机已安装的 `py`/`python`。
2. 在 Photoshop **设置面板** 点 **「生成 TTF…」**：同一对话框内调节 **加粗幅度**（对应 **`--shift-em`**，默认约 **0.028**），**PNG 预览**（源字 / 仿粗近似 / 合成）直接从字体文件渲染；点 **「确定」** 刷新预览，满意后点 **「生成」** 写出 **`原名-SynthBold.ttf`**。命令行：`python tools/generate_synthetic_bold_font.py --input ... --output ... [--shift-em 0.028]`。
3. **仅限含 `glyf`（TrueType 轮廓）** 的字体；纯 CFF 轮廓的 `.otf` 需先转为 TTF。可变字体会先移除 `fvar/gvar` 等再导出静态字。
4. 生成文件后 **安装到 Windows**，在设置里 **刷新字体列表**，再在 **「加粗字体」** 中选择新字的 PostScript 名。**字体授权须自负**，勿擅自衍生无权修改的字库。

## 与 word-to-photoshop 的衔接步骤

1. 在 Windows 安装生成的 `.ttf` / `.otf`（仅用于你有权修改的字体）。
2. 打开 Photoshop，用文字工具选中新粗体，在字符面板或脚本里确认其 **PostScript 名称**（与 `MicrosoftYaHei-Bold` 同类字符串）。也可用仓库内 `tools/dump_font_names.py`（若已配置）或小型脚本枚举 `textFonts`。
3. **推荐（面板）**：在导入面板点「刷新系统字体列表」，在 **「派生粗体 PS」** 输入框填入该 PostScript 名（多个用英文逗号分隔），再点 **「校验并保存」**。插件会写入 `settings.json` 中的 **`fontDerivedBoldCandidates`**，并设 **`fontHasRealBold`: true**。解析粗体时 **始终优先尝试派生列表**，再回退到「加粗字体」列表。
4. **或（仅编辑 JSON）**：编辑 `%APPDATA%\com.word_to_photoshop\settings.json`：
   - 设置 **`fontDerivedBoldCandidates`**: `["你的派生体PostScript名"]`（可为多个字符串，按顺序尝试）。
   - 若不用派生字段，仍可将名称放在 **`fontBoldCandidates`** 数组 **首位**，并将 **`fontHasRealBold`** 设为 **`true`**。
   - 常规字面保持 **`fontRegularCandidates`** 指向原 Regular 的 PS 名。
5. 重启 Photoshop / 重新加载扩展后，再导入含粗体的台词，粗体区间应显示为新字库笔画。

导入管线 **不再提供** 面板里的「无 / 仅 Photoshop 仿粗」模式；粗体区间应通过 **独立粗体 PostScript 名**（`fontBoldCandidates` / 派生列表 / 合成 TTF 安装后选取）实现。

## 参考链接

- make-font-bolder：<https://github.com/tobiasBora/make-font-bolder>  
- FontForge：<https://github.com/fontforge/fontforge>
