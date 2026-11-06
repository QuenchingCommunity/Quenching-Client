# Windows 3.7 TEST 本地便携包（2026-11-05）

阶段 A，仅本地打包交付；未上传、未部署官网、未生成自动更新对象。本次用户授权为“好，打包吧”。

## 产物

- 便携 7z：`__Bin/QMC-3.7-TEST-Win-x64-20261105.7z`。
- 便携包：195025405 字节（195.03 MB）；SHA-256 `f3bc49a47e28cd891e99cf1557270480f5d5bbf1192b21198ca33b61b9737b52`。
- 首次启动前直出目录：`__Bin/client-3.7-test-vision-20261105/win-unpacked`，437674941 字节（437.67 MB），157 个文件，含测试标记。
- Windows x64，Electron 33.1.0；内部版本 3.7.0，对外 3.7 TEST；本次构建未签名。
- `yarn run dist:win --config.directories.output=__Bin/client-3.7-test-vision-20261105` 成功，74.09 秒；随后用 `scripts/export-win-portable.mjs` 导出并检验 7z。

## 输入与通道

客户端／assets 快照 HEAD：`68b01827874dbb0ea8e237c7140183073663b80a`，加本地未提交 Vision Mod 四模块改动。包含最新四张 foliage-other 贴图，以及 EXE 同级 unpacked 改动。包内 main/preload 与本次 dist 摘要一致。

客户端资源清单 ID：`ab653effb034b132c5686c8917400569d20d93151b84a7b146cdfdc188c6d993`。五个资源 7z 共 98304886 字节，展开资源 1022 个文件、969889348 字节。每包大小／SHA-256 与本次源清单一致，四张修改贴图也与包内清单一致。

Latest HEAD 只读核对为 `34d7336e990b95594fa559ce08d9033f69f58bba`；本次未使用 Latest 制作 MOD 包，未改 MOD 版本、sequence、资源或线上索引。

EXE 同级携带 `quenching-update-test.json`，独立测试基址 `https://qm.txzy.net/quenching/update-test/client-3.7.0-vision-20261105/`。这次没有部署该地址，启动检查返回 404，日志明确记录，未回退正式源；不宣称自动更新已发布或可用。后续测试更新须基于用户对本包的人工验收另行准备。

## 实际产物验收

- 实际 Windows 打包完成；ASAR 外 44 个原生文件大小／SHA-256 通过；使用包内 QMClient.exe 加载 CASC、StormLib 成功。
- 7z 完整性检测通过，实际解压后再次检查原生模块、启动真实主进程和 renderer/preload/IPC。页面标题 `Quenching Mod Client v3.7 TEST`，31 个按钮，Retail 配置读取正常。
- 真实首次解压完成：1022 个资源，状态 ready/100%；落在该解压副本 EXE 同级 unpacked；`.test-user-data/resources/unpacked` 不存在，测试配置隔离有效。
- 通过真实包的新版 Vision Mod IPC，在临时假游戏目录开启单位增强，检查模型已替换、unitskin TXT 未被覆盖，再关闭并确认原模型恢复。未修改真实游戏目录。
- 版本生成器 `--check` 通过，UIQUE 两组各四处 TEST 版本字段、字体和父级解析设置已核对；未在真实游戏内人工验收 UIQUE 或四模块画面效果。
- 无 `.env`、`.git`、私有发布工具、offline.exe 或原始 assets/unpacked；交付目录未启动，无用户设置或展开缓存。测试启动发生在 7z 的独立解压副本，验证后将大体积副本移到回收站。

日志、摘要与实际启动报告位于 `_tmp/win-package-20261105/`。首次自动化功能检查完成后，隐藏窗口截图请求超时；移除截图采集后，从新解压副本重新完整验证成功，未将该截图超时解释为客户端启动失败。本次无截图验收结论。
