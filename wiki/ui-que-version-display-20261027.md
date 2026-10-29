# UI-que 版本文字显示修复（2026-10-27）

玩家截图中的命令面板版本区为空白。读取当前 Retail 游戏目录及客户端两份 UI ZIP 后，确认八处 `QuenchingVersionText` 已经是 `V3.7 TEST`，并不是缺少版本字符串。问题在于 `Font "MasterFont", 0.01,` 使用了字体变量，而拥有该 String 的 `SIMPLEFRAME CommandBarFrame` 缺少 `DecorateFileNames,`。

本机原始 CASC `war3.w3mod:ui\framedef\ui\simpleinfopanel.fdf` 的原生字体框架使用同一解析设置。字体变量需要父级启用解析的规则也可见 [Tasyen 的原始 UI Frame 教程](https://www.hiveworkshop.com/threads/the-big-ui-frame-tutorial.335296/)。这是静态配置诊断；不把离线文本验证视为 Warcraft 内画面验收。

## 修复及标准流程

- `scripts/prepare-release-assets.mjs`：继续从 `release-version.json` 读取 `3.7`／`test` 并生成 `V3.7 TEST`；补齐父级 `DecorateFileNames`。`--check` 现在同时验证字体、字号、正确父级和版本文本，文字正确但字体不可解析也会失败。
- `assets/quenching/zip-ui-20.zip`、`zip-ui-30.zip`：每包四处命令面板 FDF 修复，其他 169 个文件不变；原 PNG、UI 图像、其他 UI 样式不变。
- `src/Main/services/ui-service.ts`：UI 缓存标记加入 `layout-2`，已经装过同一个 `3.7 TEST` 的客户端会刷新一次，完成后继续跳过重复解压。版本号不变也不会跳过这次修复。
- `scripts/test-release-assets.mjs`：补充“仅有文字却无父级字体解析”“把设置误加在 String 上”“缺少字体”“错误父级”等拒绝用例，验证测试／正式文字切换、幂等和只读检查。
- `scripts/test-ui-default.ts`：验证两份资源包、同版本标记迁移、安装后文字和字体配置、之后不重复解压，以及另一分支／关闭状态／经典画质不受影响。
- `scripts/audit-local-release.mjs`：审计当前游戏文件时也调用字体及版本校验，不能仅查到文字就通过。
- `.agents/skills/quenching-release/SKILL.md` 及 `references/version-assets.md`、`preparation.md`、`test-first-workflow.md`：明确 A／B／C 都检查八处文字及字体可渲染条件；人工验收必须在游戏内实际看到 UI-que 版本，测试显示 TEST，正式去除 TEST。同版本 FDF 布局修复须同时提高 UI 缓存修订。

## 当前本地安装

已修复 `D:/Quenching/War3Reforged/Warcraft III/_retail_/ui/` 中以下四份已有文件：

```
framedef/ui/commandbar.fdf
framedef/backup/commandbar.fdf
ui-que/framedef/ui/commandbar.fdf
ui-que/framedef/backup/commandbar.fdf
```

只修改版本／字体解析字段，保留原 UI 选择及其他 UI 内容；修改前备份在 `backup/ui-que-version-20261027-tJPon8/`。本次是本地 UI 资源及流程修复，没有制作新便携包、上传发布或更改 MOD sequence／更新清单。Latest 中没有对应 UI FDF，UI ZIP 属于客户端附加资源，本次未用 assets 覆盖 Latest。

## 验证

- `node scripts/test-release-assets.mjs`：通过。
- `node scripts/prepare-release-assets.mjs --check`：通过，两包各四处字段及字体设置正确。
- `tsx scripts/test-ui-default.ts`：通过，包括同版本刷新一次、错误源保留原 UI、非目标分支和 UI 外文件保留。
- ZIP 逐文件 SHA-256 对比：两包均仅四份 commandbar FDF 变化，其他各 169 个文件相同。
- 当前游戏四份已有 FDF 的版本／字体检查：通过。
- `tsx scripts/webpack.build production`：通过，退出码 0、输出 complete，无 fatal／ERROR in／Build failed；改动文件 `git diff --check` 通过。
- 本次生产构建日志和逐文件验证记录位于 `_tmp/ui-que-version-20261027/`。

| 包 | 大小（字节） | SHA-256 |
| --- | ---: | --- |
| zip-ui-20.zip | 20658094 | 4036309f18c1f3083c6d29f617a1e2b5fc534032780dd91ac56e6097e9416e14 |
| zip-ui-30.zip | 20661311 | 106977e869c8a62a92a366c84d11a089adcb58a1a4201ec043d53e11707f43c3 |

重启魔兽以加载修正的 FDF 后，检查命令面板上方版本区显示 `V3.7 TEST`；当前没有代替玩家进行游戏内截图验收。
