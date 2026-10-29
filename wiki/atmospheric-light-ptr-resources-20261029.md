# 大气光与 PTR 素材复用

本次为客户端本地功能修改与资源精简，未制作新分发包、未发布自动更新，未改用户当前游戏文件。

## 大气光

光照设置第一排并列显示“旋转光照”和“大气光”，都是独立开关；大气光默认关闭。说明面向视觉效果，不介绍着色器原理。

开启后只修改当前 Retail／PTR 分支 `ui/MiscData.txt` 的 `[TerrainZFog]`：Start=1400、End=5400、Density=0.8、MaxLinearDensity=0.8、Color=255,185,200,215。保留原有 Style（模板为原生线性 Style=0）、高度及其他配置；不修改正常 shaders、DNC 或后处理配置。

初次开启前在分支根目录 `.quenching-atmospheric-light.json` 记录原雾值及原文本；修改以同目录临时文件原子替换，目录队列串行执行。关闭时恢复开启前的五项值，其余设置保留。原本没有文件时使用随附模板，关闭回到原生距离 3000／5000、黑色、Density 和 MaxLinearDensity 均为 0.8；从未开启且无管理记录时，关闭状态不创建／修改文件。UI 样式切换重装和启动资源同步后都会重新应用选择。

模板 `assets/quenching/ui-misc.txt` 为 29,784 字节，直接分发，不进入 7z；模板其余内容来自用户提供的当前文件，仅将上述五项规范为本次消息的值。检查时真实游戏文件已是 End=5500、Density=0.75 和不同颜色，本次按用户文字明确要求生成预设，没有反向覆盖真实游戏文件。现有图标、公钥、PostProcessingConfig 等小型直接默认资源继续保留包外；版本相关皮肤、DNC 等保留资源组布局。

## PTR 共用与恢复

`shaders-ptr-hd`（34 文件，91,596,112 字节）和 `shaders-ptr-de`（24 文件，57,889,164 字节）均与对应 3.0.1 文件逐字节相同。

保留逻辑 PTR 包名、游戏构建门禁、已安装标记、独立 Fog 选择及其他分支行为；`src/shared/bundled-resource-paths.mjs` 的 `PTR_INDEPENDENT_SHADERS=false` 让文件路径与提取选择统一映射到 3.0.1 的物理源。没有“找到同名文件就回退”的猜测逻辑，未来打开开关会直接要求独立素材。

原 PTR 两目录移到 `_tmp/atmospheric-ptr-20261029/ptr-backup/`，不参与打包；恢复步骤见同目录 `RESTORE.md`。该目录是仍需保留的回滚／未来资源备份，不能作为普通临时垃圾清理。未来复制回 assets、更新实际目标 ABI 素材、开启常量、更新已验证构建允许列表及 Fog 选择，回归和游戏内验证后再按发布流程处理。

## 清理及体积

16 个无当前调用的旧文件已移至回收站，共 7,327,880 字节：旧 .NET／WPF 辅助文件、gluemanager、旧植被／树木表、旧单位皮肤表、两张无调用图片和旧战役模板。逐文件原大小与 SHA-256 记录在 `_tmp/atmospheric-ptr-20261029/recycled.json`。

保留 EULA、Readme、Mac 说明及 reg 随附资料；`dnc30-de-rpg`、`zip-blight-retro` 等仍用于历史已知资源清理的资料也保留。没有删除正常 2.04／3.0／3.0.1 着色器、现有皮肤版本模板或兼容清理依据。

| 指标 | 之前 | 本次 |
| --- | ---: | ---: |
| 展开素材文件数 | 1096 | 1022 |
| 展开素材字节 | 1,126,301,502 | 969,488,353 |
| 五个资源 7z 总字节 | 100,881,691 | 98,272,243 |

展开源减少约 156.81 MB；压缩包减少约 2.61 MB。重复 PTR 数据在原有压缩中已得到较高复用，因此不会对应减少 149 MB 的分发体积；本次未打包，不能把资源差值当成已实测的新客户端总大小。新增包外模板约 0.03 MB。

## 验证

`test-atmospheric-light.ts`：Retail／PTR 开关、幂等、精确恢复、UI 目录重装、无原文件、其他段／正常 shaders 不变，以及 PTR 共享路径通过。`test-ptr-shader-compatibility.ts`、`test-shader-301.ts`、`test-graphics-settings-transition.ts`、`test-startup-rendering-files.ts`、`test-resource-bundle.ts` 和实际分发过滤 `test-resource-packaging.mjs` 通过。8 语言各 1342 个键，缺失／重复／占位符检查通过。

最终 `yarn run build` 成功，耗时 43.13 秒（webpack 33.24 秒），资源入口确认无变化、不重压。日志 `_tmp/atmospheric-ptr-20261029/build-final.log`。版本支持与退休资源回归 `test-war3-support.ts` 同样通过。未启动游戏验收大气光画面，未重新测量外层客户端归档。
