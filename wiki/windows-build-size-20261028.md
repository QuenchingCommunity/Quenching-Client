# Windows 构建与直出体积核对

2026-10-28 用户反馈 `RESOURCE_ARCHIVE is not defined`，要求完整 build 并检查相对之前约 440 MB 是否缩小。本轮仅生成本地 Windows x64 直出目录，没有制作外层归档、发布自动更新或上传。

## 构建结果

检查时 `scripts/prepare-resource-bundle.mjs` 已从共享资源路径模块导入 `RESOURCE_ARCHIVE`，供 schema 2 旧单包迁移分支使用。未再复现该 ReferenceError。`postinstall: electron-builder install-app-deps` 是 electron-builder 的建议提示，不是本次中断原因；现有 StormLib 预编译依赖策略保持原样。

实际执行 `yarn run dist:win`，退出码 0，耗时 **124.92 秒**。其中生产 webpack 编译 50.36 秒，资源准备入口和 electron-builder beforePack 都成功执行；五包无变化，未重新压缩。Electron 33.1.0、内部客户端版本 3.7.0、对外 3.7 TEST；未执行代码签名。

输出：`__Bin/win-unpacked`。源码输入为客户端 HEAD `722b8a4bbbe5662eca44f56f1939005b839aa65e` 加本地未提交修改，不能只用 HEAD 复现。未使用 Latest 制作 MOD 发布资源，也未变更 MOD sequence。

## 同一口径体积

以下是 dist:win 直出目录中实际文件的字节总和，不含外层压缩包，也不含首次运行后创建的用户缓存。

| 项目 | 字节 | 十进制 MB |
| --- | ---: | ---: |
| 本次直出目录，157 文件 | 441,511,341 | 441.51 |
| 之前 terrain-hdr 候选，154 文件 | 441,376,741 | 441.38 |
| 本次相对之前 | +134,600 | +0.13 |
| Electron 本体 | 280,938,140 | 280.94 |
| app.asar | 41,551,492 | 41.55 |
| 五个独立资源 7z | 100,881,691 | 100.88 |
| 其他资源、工具及原生依赖 | 18,140,018 | 18.14 |

结论：相对之前约 440 MB 没有显著缩小。之前的 441.38 MB 候选已经使用统一资源压缩，总包为 100,880,417 字节；本次改为五个独立包的总和是 100,881,691 字节，仅多 1,274 字节。拆包的收益是更新时可以只下载变化的包，并非再次压缩已经压缩过的资源。其余增长来自应用代码、清单及静态文件变化。

资源原件共 **1096 文件／1,126,301,502 字节**，压缩后 **100,881,691 字节**，资源体积减少 **91.04%**。如果同一批原件直接带入，保持其余文件相同，直出目录估算会达 **1,466,931,152 字节**；这是替换资源大小后的算术对照，不是另建了一份未压缩产物。

构建前默认 `__Bin/win-unpacked` 残留的是更早的 670.08 MB 旧 ZIP 布局，与用户所指的 441.38 MB 候选不同，不能把这次清理旧输出得到的差值当成相对 440 MB 的新增收益。

## 验证

- `test-resource-bundle.ts` 通过：生成／复用、五包独立读取、同名内容更新、损坏检查、schema 2 兼容、回滚及路径／链接拒绝。
- `test-resource-packaging.mjs` 通过：实际 Windows matcher 排除展开源和旧 ZIP，保留图标、五包及更新工具；公共启动／构建入口保持一致。
- 对真实直出目录遍历并检查 ASAR：没有 `assets/unpacked`、旧资源 ZIP、旧 `resources.7z` 或临时源码目录混入。
- 实际打包的五个资源归档大小及 SHA-256 全部与清单一致；ASAR 中 main／preload 与本次编译输出一致。
- 本轮未启动游戏验收画面，也未将构建成功视为已发布。

测量原件和构建日志位于 `_tmp/build-size-20261028/`；小型长期测量证据见 [JSON](evidence/windows-build-size-20261028.json)。

## 用户追加的外层 ZIP 测量

将本次 `__Bin/win-unpacked` 实际压成标准 ZIP（Deflate，7-Zip `-mx=9`），得到 **256,713,274 字节／256.71 MB／244.82 MiB**，比 441.51 MB 直出目录小 **41.86%**。原生 `7z t` 全部 CRC 检查通过。此为体积测量归档，不是另一次客户端发布。

文件：`_tmp/build-size-20261028/QMC-3.7-TEST-Win-x64-20261028.zip`；测量记录：`_tmp/build-size-20261028/zip-measurements.json`。
