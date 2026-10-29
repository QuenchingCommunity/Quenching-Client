# 统一资源与 HDR 开关验收记录

2026-10-28 完成本地开发及源码生产编译。按用户要求，本次未生成客户端安装包／便携包，也未上传或发布。着色器由另一位同事持续修改，以 `assets/unpacked` 当前内容为准；未用旧备份覆盖新版。

## 资源布局和命令

- 展开源统一在 `assets/unpacked`。八个游戏资源目录、原始 3.0 着色器、九个原 ZIP 逻辑组和保留资料共 1096 个文件。
- 原 UI 20／30 的 FDF 与公共贴图分别位于 `packages/zip-ui-20`、`zip-ui-30`、`zip-ui-pub`；使用时仍先公共资源再版本层。环境资源仍另按配置补齐 `zip-foliage-other` 或 `zip-foliage-que`，植被保留删除后重新提取的流程。
- 当前展开源为 1,126,301,278 字节；统一 `resources.7z` 为 100,880,274 字节，约 100.88 MB。此大小对应本次验收快照，后续同事修改着色器后会重新计算。
- `prepare-client-assets.mjs` 先校验版本文字，再校验内容摘要并生成归档／清单。源不变直接复用；修改时只重压变化成员，删除源文件也会同步移除归档成员。同尺寸／同时间戳的变化仍按 SHA-256 识别。
- `yarn run electron/start/build/pack` 均使用公共准备入口；所有 `dist:*` 经构建入口，electron-builder 的 beforePack 也执行检查。跨进程锁避免两个 dev 入口同时写归档。旧 shader ZIP 脚本只转发，不再另建 ZIP。
- Windows／Mac 的分发规则排除 `assets/unpacked` 本体、原始资源目录、旧独立 ZIP 和备份。`1.ico`、`logo.png`、公钥、更新基线、基础配置等继续直接分发；字体由 webpack 输出，可在首次显示时读取。

## 运行期

窗口创建不等待资源展开。启动异步验证归档和清单；具体功能请求到来后只提取所需文件。缓存位于当前用户数据目录的 `resources/unpacked/<内容 ID>/`，不进入客户端官方文件快照。

按需提取只提交通过摘要校验的文件；缺失／损坏文件可修复，提交失败恢复原缓存。资源版本分目录隔离，保留回退所需内容。新清单优先于旧安装遗留的独立 ZIP。开发模式直接使用展开源，实时反映同事的修改。

## HDR 开关

画面设置新增单个 HDR（tonemap）开关，独立于后处理阴影和辉光。开关仅控制 `ps/tonemap.bls`，开启恢复对应版本的原文件，关闭删除该文件；不修改着色器内部逻辑。

选择会保存并在重启、切换模式和画质时保留。旧配置未记录 HDR 时继承原后处理选择，避免升级后自动改变旧用户效果。MOD 关闭或 SD 时保留选择但不写入不适用的资源。

适用 2.04 和 3.01 HD／DE／PTR。原始 3.0 资源没有 tonemap 文件，界面禁用并说明原因；不把新版文件注入旧版。八种语言均已补齐说明。

## 主要改动位置

| 范围 | 文件 |
| --- | --- |
| 统一生成、清单、锁与盘点 | `scripts/prepare-client-assets.mjs`、`prepare-resource-bundle.mjs`、`audit-quenching-resources.mjs` |
| 资源路径、按需缓存和逻辑 ZIP 兼容 | `src/shared/bundled-resource-paths.mjs`、`src/Main/services/bundled-assets.ts`、`bundled-packages.ts` |
| 原生按成员提取 | `src/Main/services/archive-extraction.ts`、`zip-extraction.ts` |
| 资源调用与启动 | `src/Main/services/asset-sync.ts`、`shader-bundle.ts`、`client-mod-files.ts`、`initialize-main-window.ts`，及地形／水面／皮肤／战役／UI 等消费入口 |
| 启动与分发标准流程 | `package.json`、`electron-builder.yml`、`scripts/package-mac-app.mjs`、`check-mac-native-before-pack.cjs` |
| UI 版本和编译输入 | `scripts/prepare-release-assets.mjs`、`src/Renderer/styles/fonts.less`、`src/Main/services/rotating-lighting.ts` |
| HDR 效果、IPC 和配置 | `src/Main/services/fog-shader-override.ts`、`src/Main/ipc/shader-handlers.ts`、`src/Preload`、`src/Renderer/hooks/useWar3Settings.ts` |
| HDR 界面与文案 | `src/Renderer/components/MainWindow/SettingsModal.tsx`、`src/Renderer/utils/i18n/`、Electron API 类型声明 |

## 验证结果

| 验证 | 结果 |
| --- | --- |
| 生产源码编译 `node --import tsx scripts/webpack.build production` | 通过；preload／main／renderer 全部完成，最终一轮 97.14 秒。未调用客户端打包 |
| 原生 `7z t resources.7z` | 通过；1096 个独立流、1096 文件，全部 CRC 校验通过 |
| `test-resource-bundle.ts` 及旧测试入口 | 通过；冷启动不展开、按成员提取、并发、增量压缩／删除、损坏修复、回滚、版本隔离、路径／链接拒绝 |
| 两个公共准备入口并发运行 | 通过；第二个等待锁，首个仅重压变化的 5 个文件，用时 11.024 秒；随后不变复用 2.683 秒 |
| `test-resource-bundle-real.ts` | 通过；真实归档只缓存请求的 59 个文件；原始 3.0 的 57 文件与原 ZIP 逐字节一致；UI／HDR 单独提取，图标保留 |
| `test-resource-packaging.mjs` | 通过；使用真实 Windows matcher 与 Mac 策略检查，不包含展开本体／旧 ZIP，保留启动图标及更新工具 |
| `test-hdr.ts`、`test-shader-301.ts` | 通过；版本／画质／模式矩阵、开关 IPC、参数校验、HDR 与阴影／辉光独立、源缺失时保留现有效果 |
| `test-graphics-settings-transition.ts` | 通过；配置保存与旧配置迁移、模式／画质变化、失败回滚 |
| UI／资源回归 | `test-ui-default.ts`、`test-release-assets.mjs`、`test-startup-rendering-files.ts`、`test-foliage-sync.ts`、`test-water-assets-copy.ts`、`test-decisive-terrain-tree-textures.ts`、`test-ptr-shader-compatibility.ts`、`test-lighting-progress.ts`、`test-rendering-presets-readability.ts`、`test-war3-support.ts` 均通过 |
| 原生 ASAR 归档工具验证 | `test-archive-runtime.mjs` 通过，包含 unpacked 7-Zip 程序／DLL 及 RAR5 |
| 国际化 | 八种语言各 1335 个键，无缺失／重复键或占位符不匹配 |
| 脚本语法与差异空白检查 | 通过；差异检查按 Windows CRLF 规则执行 |

以上为自动化和文件级验证，未启动 Warcraft 进行画面实测，也未在 Mac 上实际打包／启动。

完整资源用途表与 21 个无当前引用的候选见 [资源盘点](quenching-resource-inventory-20261028.md)；没有自动删除这些候选。原资源迁移备份仍在 `_tmp/resource-bundle-20261028/previous-quenching`，用于此次改造回退；备份不参与分发。
