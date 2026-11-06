# 发布版本文字与无版本图片

**当前布局（2026-11-06 修正）：** 见 [统一资源流程](resource-bundle.md)。UI 三组已展开到 `assets/unpacked/packages/zip-ui-{pub,20,30}`，随五个独立 `resources-*.7z` 分发；下文旧 ZIP 名是逻辑组名。两个版本组各含两处有效版本字段，版本生成器直接编辑展开 FDF，不再重压独立 UI ZIP。`backup/` 被 Git 忽略，不参与当前版本字段检查或资源归档。此前要求每组四处时误计了两处本机备份，导致干净 Git 检出构建失败。PNG 源移到 `assets/unpacked/tx`，其构图和版本策略不变。

2026-10-24 用户决定：每次发布除了应用／MOD 标记，也必须对齐 UIQUE 的版本字段和 WebUI 安装提示。PNG 不再烧入版本，底部版本和署名由 HTML 文字显示，避免每版更换中英文两张图。

## 版本来源与资源位置

| 内容 | 来源／产物 |
| --- | --- |
| 内部客户端版本 | `package.json.version`，决定自动更新先后 |
| 对外版本文字的唯一配置 | 仓库根 `release-version.json.displayVersion`，当前 `3.7` |
| 本地构建阶段 | 同一 JSON 的 `channel`；`test` 显示 `3.7 TEST`，`production` 显示 `3.7`。格式由 `scripts/lib/release-label.mjs` 统一，不影响数值版本比较或网络通道 |
| 客户端显示 | `src/Renderer/version.ts` 读取该 JSON，测试为 `v3.7 TEST`，正式为 `v3.7` |
| WebUI HTML 模板 | `scripts/templates/quenching-webui.html`，版本位置为 `{{QUENCHING_DISPLAY_VERSION}}` |
| 客户端生成的 HTML | `assets/quenching/index.html`，包含普通 HTML 文本 `Version 3.7 By 天下正义`；无需联网或读远程版本 |
| 无版本 PNG | `assets/quenching/tx/QuenchingOnCN.png`、`QuenchingOnEN.png`；后续版本更新不重新生成 |
| 游戏中客户端同步目标 | 当前分支 `webui/index.html` 与按语言选择的 `webui/QuenchingOn.png` |
| UIQUE 版本字段 | `assets/quenching/zip-ui-20.zip` 与 `zip-ui-30.zip` 中的 `String "QuenchingVersionText"` 的 `Text` |
| UI 共用贴图／模型 | `assets/quenching/zip-ui-pub.zip`；只含非 FDF 资源，必须与两个 FDF 版本包一同进入客户端 |
| 完整包工作源 | Latest 的 `webui/index.html`、默认中文 `webui/QuenchingOn.png`；由显式资源同步更新，发布仍只读取 Latest |

每个展开 UI 版本组的有效字段位于 `ui-que/framedef/ui/commandbar.fdf` 和 `framedef/ui/commandbar.fdf`，两组合计四处；测试统一 `V3.7 TEST`，正式为 `V3.7`。生成器按这两个精确路径验证，缺失、额外版本字段或错误字体／父级均拒绝。历史实体 ZIP 可继续读取，但同样只检查这两处有效字段，不要求或计入备份。不得靠提交备份或手工复制旧 ZIP 修复干净构建。

2026-10-28 UI 资源拆分：两个版本包各自保留 38 个 FDF，公共包保存 135 个相同的非 FDF 文件。安装和经典反馈补丁先解压 `zip-ui-pub.zip`，再叠加 `resolveUiZipName` 选择的 20／30 包；路径和文件内容不变。不要再从单独的 20／30 包寻找贴图或模型。生成器检查公共包存在、公共包无 FDF、版本包只含 FDF；版本更新只修改两个 FDF 包，不重压公共包。`node scripts/split-ui-archives.mjs` 可从完整旧包拆分或对现有拆分包幂等检查，发现非 FDF 差异即拒绝，不静默丢弃版本资源；首次拆分保留定点回滚备份。

**版本文字必须可渲染，不能只检查字符串。** `String "QuenchingVersionText"` 属于 `Frame "SIMPLEFRAME" "CommandBarFrame"`，使用 `Font "MasterFont", 0.01,`；其父级框架必须有 `DecorateFileNames,`，让字体变量解析到真实字体文件。2026-10-27 玩家截图显示空白时，包和游戏文件里的八处文字已经是 `V3.7 TEST`，缺失的是这个父级设置。生成器现会补齐父级字体设置；`--check` 对缺少设置、字体、错误父级及过期文字全部拒绝。

公开版本可以为 3.7、内部版本为 3.7.0／3.7.1，这是两种职责；工具要求同一发布主线，不擅自改 MOD version／sequence／`_patch/keep.que`。UI 样式记录包含公共包＋版本包、对外版本和 `layout-3` 修订，旧的 `layout-2`（字体修复）或更早记录会为本次拆分刷新一次，之后不重复解压；不动其他游戏分支。以后同版本修复 UI 框架布局时同步提高 `UI_LAYOUT_REVISION` 并验证缓存迁移，避免仅更新 ZIP 后被旧样式记录跳过。

## 每次发布的操作

在 A 首次本地包之前设置本次内部版本和 `release-version.json` 的对外版本，然后执行：

```powershell
node scripts/prepare-release-assets.mjs
node scripts/prepare-release-assets.mjs --check
# 本次需要同步完整包的上述两项 WebUI 资源时，显式执行资源编辑：
node scripts/prepare-release-assets.mjs --sync-latest
node scripts/prepare-release-assets.mjs --check --sync-latest
```

`npm run build` 和 `npm run pack` 均先运行生成器；生成器更新 HTML、两个展开 UI 组内的四处有效版本文字和对应父级字体解析设置，不编辑 PNG。`dist:mac:app` 共用这条构建链，不需手工准备 ZIP 或单独运行资源生成命令。`--check` 不写入。显式 `--sync-latest` 只复制上述 HTML、默认中文 PNG 及现有本地构建身份 JSON，不复制 UI ZIP、不反向覆盖 assets，不改完整包其他资源或发布元数据。以后按本次实际修改范围决定是否同步。

A 本地测试、B 测试更新目标、C 正式候选都检查：对外 JSON、客户端显示、HTML 文字、四处有效 UIQUE 字段一致，字体和父级解析有效，生成资源进入实际包；在 UI-que 的游戏内命令面板确认版本文字实际可见，不能用 ZIP 文本扫描或 WebUI 浏览器预览替代。测试包显示 TEST，正式包不含 TEST。游戏中关闭通知时图片和版本文字一起消失，中英文 PNG 底部没有旧版本文字。测试／正式标记仍按独立流程处理，不因 UI 文字一致省略两次人工验收。

验证入口：`npm run test:release-assets`、`npm run test:webui-asset-sync`、`node --import tsx scripts/test-ui-default.ts`。2026-10-24 还逐项比较 Git 中原始两份 ZIP：每份仅四个版本字段变化，其余 169 个文件内容不变。浏览器预览不能替代 Warcraft 内实际 WebUI／FDF 运行验收。

## 本次图片编辑记录

使用内置 `image_gen`，未使用 API／CLI 密钥。两个最终文件保存在上述客户端 `assets/quenching/tx/` 路径；保持 RGBA 透明外缘，运行时仍按 350 px 高显示。生成结果尺寸分别为 1419×1108（中文）、1419×1109（英文）；HTML 按实际图片比例排版。

实际提示词模板（language 分别为 Chinese、English；编辑目标分别为原中英文 PNG）：

```text
Use case: precise-object-edit. Edit target: the supplied {language} Warcraft UI installation plaque PNG. Remove ONLY the last bottom line of text containing version 3.5 and the author attribution (the entire lowest gray text line). Restore clean continuous dark wood grain behind that last line. Keep the metal frame, chain, sword emblem, all upper Chinese or English installation-success text, colors, layout and transparent pixels outside the plaque unchanged. Preserve original canvas dimensions and exact placement of everything. No added text, no version number, no author line, no redesign, no new graphics. This is a production game UI asset; all content outside that bottom text line must match the input.
```
