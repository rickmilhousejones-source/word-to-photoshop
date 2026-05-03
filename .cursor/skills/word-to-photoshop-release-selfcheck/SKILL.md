---
name: word-to-photoshop-release-selfcheck
description: >-
  Verifies the word-to-photoshop CEP release is internally consistent: version
  strings, install bundle lists, and no regressions to repo-path coupling.
  Use when preparing a release or tag, or when the user asks for 发版自检,
  release checklist, or pre-ship checks for this repository.
disable-model-invocation: true
---

# Word To Photoshop — 发版自检

在合并发版分支或打标签前，按顺序完成下列检查。目标是：**换机 / 挪仓库后 CEP 仍能工作**，且版本号与安装包一致。

## 1. 版本号一处改、处处对齐

以下字段必须指向**同一**语义版本（例如 `1.2` 与 `1.2.0` 分工明确）：

| 文件 | 检查项 |
|------|--------|
| `cep-extension/com.word_to_photoshop.panel/CSXS/manifest.xml` | `ExtensionBundleVersion`、`Extension Id` 的 `Version` |
| `release-channel.json` | `version`、`notes` 中的版本描述 |
| `cep-extension/com.word_to_photoshop.panel/client/main.js` | `EXTENSION_BUNDLE_VERSION`、`BUILD_ID`（含 `cep-v*`） |
| `cep-extension/com.word_to_photoshop.panel/host/main.jsx` | `WORD_IMPORT_CEP.BUILD_ID`（与 client 的 `BUILD_ID` 日期/标签一致） |
| `cep-extension/com.word_to_photoshop.panel/index.html` | `<title>`、`.appTitle` 用户可见文案 |
| `import_panel.jsx` | ScriptUI 设置面板窗口标题（根目录与 `cep-extension/com.word_to_photoshop.panel/host/repo/` 内副本若存在则一并改） |

发版说明类 Markdown 若仍维护，同步 bump 版本段落（可选）。

## 2. 安装包 `host/repo` 必须包含所有运行时

`install_cep.ps1` 中的 **`$repoFiles`** 与 **`$repoDirs`** 是唯一权威「打进扩展」的清单。

- 新增 **`.jsx` / `.ps1` / 可执行资源`**：在仓库根有对应文件的，加入 `$repoFiles`（或新目录加入 `$repoDirs`）。
- 新增 **Python / 批处理 / 其它工具目录**：加入 `$repoDirs`，并确认 `Copy-Payload` 能递归复制（跳过 `__pycache__` 已内置）。
- **不要**假设用户磁盘上仍存在克隆路径；Host 侧应通过 `getRepoRoot()` / `_resolveRepoRootWithHint()` 解析到 `host/repo`，**禁止**把仓库绝对路径写死进业务逻辑。

合并前在脑中过一遍：`WORD_IMPORT_CEP` 或 `import_to_photoshop.jsx` 里**新** `$.evalFile` / `new File(...)` / `app.system` 是否指向**未列入** `$repoFiles` / `$repoDirs` 的路径。

## 3. 路径与「自包含」回归

- **禁止**重新引入以 `WORD_IMPORT_REPO_PATH` 或 `host/repo_path.txt` 为**唯一**依赖的定位（遗留兼容可读，不可作为新功能前提）。
- `host/main.jsx` 中 `_getBundledRepoRoot` / `getRepoRoot` 已有 AppData 与 `cep-extension/.../host/repo` 回退；新代码若新增「找根目录」分支，必须复用或扩展同一套逻辑，**不要**平行写一套路径猜测。

## 4. 安装脚本自身

- `install_cep.ps1` 成功路径应仍：复制到 `%APPDATA%/Adobe/CEP/extensions/com.word_to_photoshop.panel/`、写入 `host/repo`、同步 `cep-extension/com.word_to_photoshop.panel/host/repo`、创建 `%APPDATA%/com.word_to_photoshop/`。
- `uninstall_cep.ps1`：若行为有变，确认 `-PurgeUserData` 与默认保留用户数据的说明仍准确。

## 5. 发版前建议执行（人工或 CI）

1. 仓库根执行：`install_cep.ps1`（或项目提供的「一键安装-重装插件」流程），确认无 **ERR**，且日志出现 **Runtime payload bundled** 与 **Workspace extension host/repo is up to date**（或当前等价成功行）。
2. **完全退出 Photoshop** 后重开，从菜单打开 CEP 面板，看启动日志中的 **版本 / BUILD_ID** 与 manifest 一致。
3. 抽样：导出 docx、刷新台词、打开设置面板（各点一次即可）。
4. **挪仓烟测（强烈建议）**：在已安装 CEP 的前提下，将本仓库文件夹**临时**改名或移到另一路径（勿删），**不要**改 `%APPDATA%/Adobe/CEP/extensions/com.word_to_photoshop.panel/`。再开 Photoshop，从菜单打开面板，重复步骤 3 的抽样。用于确认没有悄悄依赖「旧仓库绝对路径」；测完把文件夹移回原路径即可。

## 6. Agent 输出习惯

完成自检后，用简短列表回复用户：**已核对项**、**若发现问题则给出文件路径与修改建议**；**末尾用一两句提醒用户做一次「暂时移动项目」的烟测（见第 5 节第 4 步）**，除非用户已明确说明刚做过或不需要。其余不必写长篇设计文档。
