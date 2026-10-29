# 对战地形光照与本地客户端包

**后续状态：** 用户改为统一 7z；本文所列 ZIP 候选已移到回收站，同内容 7z 为 196,635,619 字节。随后新增光照设置与单位角度，详见 [新设置与归档状态](unit-light-angle-settings-20261028.md)，该界面目前只完成源码编译，尚未重新出包。

本次按用户要求修改 terrain Rotation，并制作阶段 A 本地 TEST Windows x64 便携 ZIP，测量客户端体积。没有改线上清单、上传或发布。

`src/Main/services/dnc-lighting.ts` 在对战光照（及 melee 兼容别名）下将 terrain 的 Rotation 设为单个固定关键帧 `0: { 0.25, 0.25, 0.75, 0 }`。覆盖各版本 HD／DE 的 terrain 模型，units 与旋转光照实验保持独立。其他光照模式仍从所选版本的源 DNC 同步，再执行原亮度处理，避免残留对战旋转；原源模型没有被改写。

验证：`test-dnc-level3.ts` 通过 250 个 HD／DE 文件场景，检查亮度、terrain 对战旋转、units 不变及标准档原字节；`test-startup-rendering-files.ts` 通过 Retail／PTR 实际同步、对战切其他模式后的 terrain 恢复，以及同时开启 units 旋转的场景。

运行 `yarn run dist:win --config.directories.output=_tmp/battle-terrain-package-20261028/builder --publish never`，沿用统一资源准备流程。输出目录与构建日志在 `_tmp/battle-terrain-package-20261028/`；最终便携 ZIP 交付在 `__Bin/`。私有导出工具 `_irys/export-win-test.mjs` 的旧 UI ZIP 存在检查已更新为统一资源清单、归档摘要和 UI 逻辑组检查，防止新资源布局被误判缺失。

内部版本保持 3.7.0，对外 3.7 TEST；仅本地测试导出，不制作同版本自动更新。测试标记指向独立候选基址 `https://qm.txzy.net/quenching/update-test/client-370-terrain-20261028/`，本次不部署该测试接口。首次用户人工验收尚未进行。

## HDR 配置联动补修

用户在首份包生成后指出：关闭 HDR 时 `PostProcessingConfig.txt` 的 Tonemap 没有关闭。首份包因此不作为最终交付。

已修正 `post-processing-config.ts`、`asset-sync.ts`、`shader-handlers.ts`：开关同时处理着色器文件与当前分支 `[Tonemap] Enabled=0/1`；启动、模式／版本同步都跟随保存的 HDR 选择。不改 Exposure、Bloom 或其他自定义参数；缺少小节时补齐，不支持 HDR 的旧版本保持关闭。配置写入按目标文件排队，以同目录暂存后原子替换，避免与 AO 更新互相覆盖。

补充验证包括配置的关／开、幂等、缺少小节、CRLF／曝光值保留，真实 IPC 联动，以及 Retail／PTR 全量同步后 Tonemap 状态跟随保存选择。修正后重新执行标准构建，最终目录为 `builder-hdr/win-unpacked`，ZIP 名含 `terrain-hdr`。

本次源码输入为客户端 HEAD `722b8a4bbbe5662eca44f56f1939005b839aa65e` 加当前未提交工作区改动，不能只用 HEAD 复现。Latest HEAD 为 `34d7336e990b95594fa559ce08d9033f69f58bba`；本次没有读取 Latest 来制作 MOD 包，也没有更改 MOD sequence。实际资源输入由包内 schema 2 清单的内容 ID 和 SHA-256 标识。

HDR 补修回归结果：`test-post-processing-config.ts`、`test-shader-301.ts`、`test-startup-rendering-files.ts` 全部通过；差异空白检查通过。

## 最终本地产物

- ZIP：`__Bin/QMC-3.7-TEST-Win-x64-terrain-hdr-20261028.zip`，263,946,876 字节（263.95 MB／251.72 MiB）。
- ZIP SHA-256：`990a98462be7961d44e02fd8fd9d4387c511eac6f7f350eb9f386fac81965ca9`。
- 解压后 154 文件，共 441,376,741 字节（441.38 MB／420.93 MiB）。其中 Electron 本体约 280.94 MB、app.asar 41.46 MB、统一资源归档 100.88 MB。
- 资源内容 ID：`f1e10e7defe16b5b50e4bb5573855f529eb95f35d7cfdb12798a1c1faa4d137b`；归档 SHA-256：`b5d2af626fd78e6700cc74b2c26037a97a8755b44f4c4af54dd11ac569f8c5c5`。
- 最终生产编译与 Windows 构建成功；46 个 ASAR 外文件大小／摘要通过；包内 CascLib／StormLib 实际加载成功。ZIP 全部 CRC 校验通过，资源原件与旧独立 ZIP 未混入。统计原件为 `_tmp/battle-terrain-package-20261028/measurements.json`。
- 未启动游戏进行画面实测，未上传或部署。首份不含 HDR 配置联动的候选已被本次产物取代。
