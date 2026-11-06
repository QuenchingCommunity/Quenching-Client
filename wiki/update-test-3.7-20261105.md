# 3.6 → 3.7 官网 TEST 自动更新（2026-11-05）

当前目标为内部 **3.7.2 TEST**，入口为用户指定的 www 网站；误用 CN1 的 3.7.1 方案已撤回。现行说明见 [3.7.2 网站 TEST 记录](update-test-3.7.2-20261106.md)。下文保留 11 月 5 日首轮发布记录，不代表当前入口。

## 开始测试

1. 双击 `D:\Quenching\QM\MOD\QuenChing-Electron-Client\__Bin\update-test-3.7.0-20261105\Start-Test.cmd`，或直接打开 `D:\Quenching\QM\MOD\QuenChing-Electron-Client\__Bin\update-test-3.7.0-20261105\QMC-3.6-TEST-Official\QMClient.exe`。无需本机测试服务或 4444 代理。
2. 确认你选择的测试魔兽目录。TEST 隔离客户端配置，不隔离游戏目录；实际更新会写入所选分支。
3. 客户端源为真实 3.6.1（对外 3.6），当前目标为 3.7.2 TEST（对外 3.7）；本轮 MOD 仅覆盖 3.6.2 / sequence 38 → 3.7 / 39。重新启动工作副本后使用已更新的 www TEST 标记。
4. 检查 3.7 TEST、设置／语言／路径保留、UIQUE／WebUI 版本、Tonemap 与游戏画面；再关闭并重新双击 EXE，确认 TEST 通道保留。两项人工验收不由自动化代填。
官网测试基址：https://qm.txzy.net/quenching/update-test/3.7.0-20261105/。测试 gate 为 allowed=0，仅带标记的客户端允许进入；测试失败不会切正式索引。

## 上传与部署

- client: https://github.com/QuenchingCommunity/Quenching-Client/releases/tag/test-client-3.7.0-20261105，29 个文件、349389389 字节；独立 prerelease，未设为 latest。
- mod: https://github.com/QuenchingCommunity/Quenching-Assets/releases/tag/test-mod-3.7-20261105，1 个文件、23341597 字节；独立 prerelease，未设为 latest。
- 官网：独立 Worker `quenching-updates-test-37-20261105`，仅路由 `qm.txzy.net/quenching/update-test/3.7.0-20261105/*`。没有部署官网工作区的其他改动，没有绑定论坛数据库、用户媒体或私密凭据。
- 本次网络验证未使用 4444。GitHub 直连发生连接重置，旧镜像出现超时／DNS 失败，未宣称这些源可用。实际更新优先官网 HTTPS 443 静态分发，两个超大完整文件回退通过固定白名单转发 GitHub；原字节仍由签名清单的大小和 SHA-256 验证。
- 26 个实际更新 payload（142190061 字节）以文件硬链接准备静态资产，不额外复制大对象到本地；两个小 gzip 清单也直接静态服务。仅 EXE／ASAR 整文件回退需要流式中转，服务不缓存整文件到内存。
- 官网只服务本次发布对象，不提供任意 URL 代理，不转发调用者 Cookie 或 Authorization。
- 首次中转验证发现上游 504；客户端首轮在资源包低速时正确失败，未提交升级。随后改为静态分发、修正缓存响应头，并从新的旧版副本重新验收。失败记录保留在 official/client-first-attempt.log。

## 实际验证

- 30 个公开更新对象共 372730986 字节完成真实 GET／大小／SHA-256；静态分发部署后重新验证全部 26 个静态 payload。
- 官网三个 JSON／QUE 与两份 gzip 共 5 项字节及签名匹配；JSON no-store，gzip 无 Content-Encoding，缺失文件真实 404。
- 真实原版 3.6.1 TEST 经官网链路升级至 3.7.0，自动重启健康确认完成，156 项目标文件逐一 SHA-256 匹配；设置、路径和 TEST 标记保留。
- 清除更新及代理环境变量重新启动，仍仅凭标记进入官网 TEST，显示已是最新版本。
- MOD 真实官网链路完成 3.6.2 → 3.7，35 个变化文件匹配，玩家改动退役文件、额外文件与 PTR 文件保留。夹具为隔离稀疏游戏目录，未操作真实玩家目录，不等于游戏画面验收。
- TEST 包未做 Authenticode 签名；客户端旧布局的 323 项缺项仅是官方包差异，不表示更新器会自动删除玩家目录中的旧文件。MOD 仍为连续 ZIP 传输，不宣称已全面实现按本地内容逐文件最小下载。

## 客户端与完整包资源清单

- 客户端：459 → 156 个官方文件，新增 20、修改 5、旧包存在而新纯净包不再分发 323。五个资源 7z／1022 项源文件与目标包校验一致；资源内容 ID ab653effb034b132c5686c8917400569d20d93151b84a7b146cdfdc188c6d993。
- Latest：8973 → 8773 个文件，新增 4、修改 31、删除 204；生成 3.6.2 → 3.7 差异 ZIP（23341597 字节）。本轮未制作正式 A/B 完整包。
- 新增含 Tonemap、PostProcessingConfig（Tonemap 开启）、本地版本身份、祭坛贴图；修改含 Knight／Grunt、DNC、着色器、T16 贴图、unitskin 和 WebUI。Latest 默认仍为 HD、魔兽 3.01、标准光照、亮度 3。
- 客户端源 HEAD：68b01827874dbb0ea8e237c7140183073663b80a 加工作区改动；Latest HEAD：34d7336e990b95594fa559ce08d9033f69f58bba 加工作区改动。Latest HEAD 是旧 3.5 导入，不冒充正式 3.6.2；正式旧清单与本次目标快照明确记录实际字节。GitHub release tag 是分发产物标识，不冒充未提交源码的 commit。
- 全部新增／修改／删除路径、大小、SHA-256：output/reports/update-test-3.6-to-3.7-20261105.csv。

## 纯净 TEST 基线

- 本地永久保留：`D:\Quenching\QM\MOD\QuenChing-Electron-Client\__Bin\test-baselines\3.6.1\QMC-3.6-TEST-OFFICIAL-CLEAN.7z`。312664989 字节；SHA-256：81a48493cee6abddebd8b208f37517664cbd5f2c631d30d1c5ded7cc38837b30。
- 从原归档解压，仅更换为官网 TEST 标记；459 个原官方文件逐项匹配，EXE／ASAR／内部版本没有修改。归档和交付客户端均未启动，不含设置、浏览器缓存、展开缓存或更新事务。
- 复测从归档解压新的运行副本，升级后目录不充当旧基线。每次发版后保留一份纯净 TEST 压缩基线已写入 AGENTS／发布技能／维护文档。旧的本机通道重复基线回收后，每版本只保留一份。
- 本次源码／资源／线上签名产物／精确大小及 SHA／URL／Git 状态／部署版本／验收和清理凭据保留于 _irys/releases/test-3.7.0-20261105/official/。

## 官网测试任务清理结果

本轮已将废弃本机测试副本、旧通道重复压缩基线、验证副本、Wrangler 中间输出和缓存送入 Windows 回收站，共 2919252234 字节（约 2.92 GB），未永久删除。旧本机服务已关闭，仅保留一份官网 3.6 TEST 纯净基线。官网静态分发产物、签名清单、真实验收证据和未运行的交付客户端保留。
