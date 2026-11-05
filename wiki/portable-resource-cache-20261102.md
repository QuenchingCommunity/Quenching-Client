# 资源解压改为便携目录（2026-11-02）

Windows 的资源现在直接展开在 `QMClient.exe` 同级 `unpacked/`，其下直接为 shaders、dnc、packages 等目录和 `.ready.json`，不再增加 current 或内容 ID 子目录。

`resource-cache-location.ts` 统一计算位置，启动全量解压和按需资源消费都调用它，依据 Electron 的 EXE 路径，不依赖工作目录、盘符或用户资料路径。macOS 使用 `.app` 同级目录，避免修改签名包；开发模式有展开源时仍直接读取，无源时使用仓库 `_tmp/runtime-resources/unpacked`。

资源仍在首屏绘制之后准备；首次显示既有进度弹窗，后续轻量校验并静默替换变化文件。缺少写入权限时沿用准备失败反馈，不回退 C 盘。旧用户资料目录的 `resources/unpacked` 不再读取或新增，不跨卷移动，也不自动删除；新位置不存在时从自带 7z 展开。设置、日志和浏览器缓存位置不变。

prepared/previous 与状态文件暂存位于客户端目录同卷 `_tmp/resource-unpack-*` 或 `_tmp/resource-state-*`，继续使用原子 rename、失败回滚及临时树清理，恢复失败保留备份。旧缓存兼容模式仍保留。

构建仍只带五个资源 7z，不带展开本体。`portable-release-channel.mjs` 拒绝从已经生成 unpacked/_tmp 的运行目录制作便携包，避免误带解压文件。共享 `isPortableRuntimePath` 用于本机私有 `_irys/build-file-sync.mjs` 快照扫描，排除这两个顶层目录；客户端更新路径仍使用原有受管 allowlist，不触碰展开缓存。私有发布器被 Git 忽略，交接此本地工具时需保留该引用。

验收：resource-startup 使用含中文／空格的模拟 EXE 目录，验证平铺位置、启动和按需使用同一目录、Mac 包外位置、首次进度、热启动复用、同名版本替换、未变文件不写、无整包摘要重读、外部改动修复、失败回滚及旧布局兼容。另运行 resource-bundle、启动窗口握手、便携通道、打包排除回归和 production webpack 编译。

本次未制作或发布客户端包；现有 `__Bin` 产物需重新打包才包含此改动。日志位于 `_tmp/portable-resources-20261102/`。

## 追加依赖核查与旧缓存清理

用户授权后，检查了全部生产 `prepareBundledAssets` 调用点、共享资源路径解析、逻辑资源包、着色器消费者，以及设置／新闻／遥测等用户资料路径；游戏资源已统一走新位置，其他用户数据未迁移。

`scripts/test-portable-resources-real.ts` 使用真实五包在模拟 EXE 同级目录展开：逐个检查清单内全部 1022 个文件的解析路径与大小、真实 UI FDF 解压、着色器读取、DNC／skin／tile／water 样本字节、每个逻辑包的实际成员提取、包外启动小资源路径、热启动复用和同卷事务清理。本次并未启动游戏逐项验收所有画面开关，不把路径验收等同于全部游戏功能验收。

已通过 Windows 回收站 API 将 `C:/Users/uizor/AppData/Roaming/Quenching Mod Client/resources/unpacked` 移到回收站，原路径确认不存在。共 1023 个文件（含 1022 个资源及状态文件），970104663 字节。清理前核对目标边界、全部子目录无链接，且无客户端进程；未修改设置、日志、登录数据及资源原件，未永久删除或清空回收站。凭据不进入记录。清理记录保存在同任务目录 `recycled-cache.json`。
