# 3.7 TEST 更新连接修复（2026-11-06）

**已撤回：本页记载的 CN1 更新服务是错误部署。用户已明确 CN1 是匹配服务器，相关配置和文件已撤回。现行入口及验收请看 [3.7.2 网站 TEST 记录](update-test-3.7.2-20261106.md)，不要复用本页的 CN1 地址／部署步骤。下文仅保留历史证据。**

当前阶段为 B：官网 TEST 自动更新复测，等待用户人工通过。修复后的内部版本 **3.7.1**，对外版本仍是 **3.7 TEST**。正式目标仍为客户端 **3.6.1**、MOD **3.6.2 / sequence 38**，没有发布正式 3.7。

## 已确认的问题

- 用户确认下载后返回旧版界面，原运行目录没有安装事务／助手日志，不能判为更新成功。
- 同一主域名的某个 IPv4 能建立 TCP 却卡在 TLS；原版 3.6.1 的正式客户端检查也实测超时。它的客户端索引只请求 `qm.txzy.net`，不会因恢复备用站就自动获得新的切源能力。
- 正式备用站 `www.tianxiazhengyi.net` 的门禁、客户端索引原来为真实 404，现已恢复。
- 已分发旧程序不会自动获得新连接代码。持续无法接通主域名的旧正式客户端，可能仍须通过之后验收发布的新便携包过渡；不得宣称旧版连接问题已经全部消失。

## 共用代码修复

- 客户端和 MOD 的元数据／下载共用 `update-network.ts`：TLS 建连有时限，失败后尝试 DNS 的其他地址，保留原 URL、Host、SNI 和证书校验，不修改系统代理、DNS 或 hosts。
- 正式检查依次尝试不同官网主机，再尝试同主机别名，增加独立入口 `qmapi-cn1.txzy.net`。
- 官方 TEST 入口可在 `qm.txzy.net` 和 `qmapi-cn1.txzy.net` 的同一个 TEST 候选目录间切换；自定义／本机测试入口保持隔离，TEST 不回退正式索引。
- 客户端更新准备失败保留 `.quenching-client-update/last-error.json`，记录真实版本、目标、阶段及已去除 URL 凭据／查询参数的错误；界面改为需确认关闭的错误框。
- 这些是共用源码修改，应随验收后的正式版本分发，不是 TEST 专属修补。

## 当前入口与服务归属

| 内容 | 实际位置 |
| --- | --- |
| 主站正式元数据 | `qm.txzy.net`，独立 Worker `quenching-update-metadata-formal` 的 19 条精确路径 |
| 原正式备用网址 | `www.tianxiazhengyi.net/version.que`、`/quenching/*`、`/api/quenching/*`；Vercel legacy 项目仅对该 host／这些路径转发至 CN1 |
| 独立服务器 | `https://qmapi-cn1.txzy.net`；Nginx 的独立更新路径，不更动现有匹配／虚拟局域网服务 |
| 正式客户端对象 | CN1 `/quenching/update-files/client/v3.6.1-updates/`，保留签名配置的 GitHub 来源 |
| 正式 MOD ZIP | CN1 `/quenching/update-files/mod/<原 tag>/<原文件名>`，保留原版本及 GitHub 来源 |
| 本轮 TEST | `/quenching/update-test/3.7.1-20261106/`，QM／CN1 两站；独立 Worker `quenching-updates-test-371-20261106` |
| 上轮 TEST 入口 | `/quenching/update-test/3.7.0-20261105/` 的可变客户端索引现指向 3.7.1；原不可变对象保留 |
| TEST 上传 | `QuenchingCommunity/Quenching-Client` prerelease `test-client-3.7.1-20261106`；11 个新文件，248270600 字节 |

主站的小更新文件直接静态分发；超大完整文件仍使用固定 GitHub 白名单流式回退。CN1 直连是单独的签名来源；主站到 CN1 的中转未通过验收，不作为已可用方案。上传进程清除 HTTP(S)／ALL_PROXY，没有经过本地 4444；这不表示修改了用户的系统代理。

正式签名索引仅补充来源，目标版本／sequence 不变。正式门禁的 63 字节原样保留。主站和两个备用入口服务相同的签名字节。今后更新正式元数据必须同步此独立 Worker 与 CN1，单独修改论坛工作区的 public 文件不会覆盖这些精确路由。TEST Worker 不接管正式路由。

服务器静态根为 `/var/www/quenching-updates/releases/network-repair-20261106/public`，Nginx 配置为 `/etc/nginx/sites-available/qmapi-cn1.txzy.net`；正式 Worker 配置位于本仓库私有账本的 `network-repair-20261106/formal-worker/wrangler.json`。

## 验收证据

- TLS 卡住／另一地址可达的真实 HTTPS 夹具通过；Host／SNI／证书拒绝、取消和成功地址复用通过。元数据、下载、文件同步、通道隔离与错误反馈回归通过。
- 原正式＋TEST 共 44 个文件、1115529006 字节，服务器从 GitHub 真实下载并验证，再经过 Nginx 实际 HTTPS 全量读取核对。
- 新 TEST 11 个文件、248270600 字节同样验证；21 个不变对象复用上轮签名来源，未重新上传。为 3.6.1 和 3.7.0 都准备了可选 EXE／ASAR 差分。
- Electron 33.1.0 / Node 20 下核对三个正式入口的 24 份元数据字节／签名，并实际下载校验正式 MOD ZIP。
- 隔离的原版 3.6.1 经 CN1 TEST 完成 MOD 38 → 39、客户端 3.6.1 → 3.7.1；安装事务完成后，新程序正常启动。调试端口不会随助手重启保留，验证脚本后续通过正常重新打开检查。
- 新程序重新打开后客户端 156 个文件、MOD 35 个 payload 匹配；语言、路径、玩家额外文件、PTR 和 TEST 标记保留。清除通道／代理环境变量后，仍凭 EXE 同级标记选择 TEST。
- 新客户端在隔离配置中关闭 TEST 选择，能读取正式客户端 3.6.1 和 MOD 3.6.2 / 38，不推进正式版本。
- Electron / Node 20 的最终 TEST 检查中，6 次主站请求失败后均成功切到 CN1，同一测试目录及签名保持一致；实际差分下载通过哈希校验。
- 从独立服务器检查主站的 15 项静态文件／测试元数据，以及两个超大完整文件回退（377676800 字节），实际 GET／大小／SHA 均匹配。
- MOD 夹具为隔离稀疏目录，不等于完整旧包或游戏画面验收。客户端升级保留旧布局文件，不将缺项当作玩家文件删除依据。

本轮只比 3.7.0 候选修改 `QMClient.exe`、`resources/app.asar`、`resources/assets/quenching/local-release.json`、`resources/statics/package.json` 四个分发文件。五个资源 7z 和 MOD ZIP 不变，不增加 MOD sequence。

## 人工重测

1. 若原 TEST 窗口仍开着，由用户关闭。代理不关闭人工测试窗口。
2. 双击 `__Bin/update-test-3.7.0-20261105/Start-Test.cmd`。这是保留的 3.6.1 工作副本，标记已切至 CN1 的本轮 TEST。启动器额外保存 stdout／stderr 供失败定位。
3. 确认更新至内部 3.7.1，观察下载、退出、自动重启、版本及设置；检查选定测试游戏目录的 MOD 与画面。
4. 用户通过之前不开放正式 3.7。当前纯净 3.7.1 TEST 7z 未启动，3.6.1 纯净基线归档保持原 SHA，不为改测试入口重复压缩。

全路径清单：`output/reports/update-test-3.6-to-3.7.1-20261106.csv`。客户端 20 新增、5 修改、323 项旧包文件不再随纯净新包分发（不代表更新器删除）；MOD 4 新增、31 修改、204 显式退役记录。后续正式候选包含同一共用修复，并使用高于 3.7.1 的内部版本；不覆盖已发布 TEST 字节。

纯净候选：`__Bin/QMC-3.7.1-TEST-Win-x64-20261106.7z`，195026778 字节，SHA-256 `bca654e3fc05c98f0910effd538ff12c37e2033a8c6bfa5f1a70ccd213acae58`。

私有账本：`_irys/releases/network-repair-20261106/` 与 `_irys/releases/test-3.7.1-20261106/`，包含签名索引、逐文件大小／SHA／URL、部署版本、失败与成功证据和清理回执。源码 HEAD `68b01827874dbb0ea8e237c7140183073663b80a` 加工作区修改；Latest HEAD `34d7336e990b95594fa559ce08d9033f69f58bba` 加原资源修改。分发 tag 不冒充包含这些未提交修改的源码 commit。
