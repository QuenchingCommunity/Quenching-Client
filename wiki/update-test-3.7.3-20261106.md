> 网站绑定方式已撤回：整体www改绑属于主站事故。当前以 [主站恢复记录](main-site-restoration-20261106.md) 为准，不能沿用本文历史部署方式。

# 3.7 TEST：正式／测试共用更新流程

当前处于测试自动更新阶段，内部目标 3.7.3、界面版本 3.7 TEST，等待用户人工验收。正式更新仍为客户端 3.6.1、MOD 3.6.2 / sequence 38。

## 入口与隔离

| 内容 | 正式 | TEST |
| --- | --- | --- |
| 网站 | `qm.txzy.net`，兼容 `www.tianxiazhengyi.net` | 用户指定 `www.tianxiazhengyi.net` |
| 门禁 | `/version.que`、`/quenching/version.que` | `/version-test.que`、`/quenching/version-test.que` |
| 客户端 | `client-manifests/latest.json`、`<当前内部版本>.json` | `client-manifests/latest-test.json`、`<当前内部版本>-test.json` |
| MOD | `mod-zip-manifest.json`、`mod-sync-manifest.json`、`manifest.json` | `mod-zip-manifest-test.json`、`mod-sync-manifest-test.json`、`manifest-test.json` |

两通道由同一 URL 生成器按相同顺序尝试 `/api/quenching/`、`/quenching/` 元数据别名及协议兼容索引。当前 TEST 提供 schema 2 客户端和 schema 3 MOD；未提供的旧协议 TEST 索引返回 404，不转正式。测试门禁为 allowed=1；TEST 标记不再绕过 allowed=0。门禁、签名、快照比较、下载／切源、安装事务、重启健康确认和回滚均使用共用实现。

EXE 同级 `quenching-update-test.json` 选择测试站点，配置／浏览器缓存隔离，更新后保留标记。新包基址为 `https://www.tianxiazhengyi.net/`。已分发旧 TEST 客户端仍请求 `/quenching/update-test/.../version.que` 和无后缀索引，网站保留这些 TEST 专属兼容入口。新客户端读取旧 www 非版本化 TEST 基址时转为上述文件名配置。网站根 `version.que` 及正式索引保持原字节，旧正式客户端不会因此读到 TEST。

旧 3.6.1 二进制自带 TEST 预览门禁逻辑，不能靠服务器修复。本轮正向升级使用 allowed=1，未依赖该绕过；allowed=0 的测试／正式一致性验证针对新的共用实现。旧客户端升级到 3.7.3 后才获得该修复，不能宣称旧版已具备新行为。

## 发布与传输

- 客户端公共 prerelease：`QuenchingCommunity/Quenching-Client` 的 `test-client-3.7.3-20261106`，14 个新增对象／差分／快照，266850411 字节；相同对象继续复用已发布 URL。上传子进程清除代理变量，未使用 4444。
- 网站：现有 Vercel 项目 `tianxiazhengyi-legacy`，部署 `dpl_DB8dBFLuKBCTi8RBsNc5xdk6FRYq`，仅绑定 `www.tianxiazhengyi.net`。构建从公共 GitHub 获取并核对哈希后提供静态文件，超过单文件限制的备用对象拆为有哈希的内部传输片。
- 文件源由签名清单指定：本次已验证的现有 `gh-proxy.com`、`gh-proxy.org` 公共 Release 镜像、GitHub 原始 URL、网站静态备用。镜像不承载元数据、不接收凭据，不绕过完整 SHA-256。www 静态大文件实测慢，因此不作为首选 payload 源；这只是清单源配置，两通道使用相同下载代码。
- MOD 仍为原 `test-mod-3.7-20261105/QMF3.6.2-to-3.7.zip`，23341597 字节，SHA-256 `a885499a4412cd9e785a070181b33bf106cec86202720013bf56c87df69b3609`，目标 sequence 39，无新 MOD 内容或 sequence。
- `qmapi-cn1.txzy.net` 为匹配服务，误加更新服务已经撤回，禁止用作任何更新源。未采用的 `quenching-www-test-artifacts` Worker 已删除；网站没有使用它。

## 基线与验收

新的未启动纯净 TEST 归档：`__Bin/QMC-3.7.3-TEST-Win-x64-20261106.7z`，195000858 字节，SHA-256 `df18954e924a535826387cfcf30080b6a6e0aa389d426bbdb59bba45f14b615b`。内含真实内部版本 3.7.3 和 www 根 TEST 标记，无用户设置、缓存、展开资源或更新事务。

原版 3.6.1 压缩基线保持不变：`__Bin/test-baselines/3.6.1/QMC-3.6-TEST-OFFICIAL-CLEAN.7z`，312664989 字节，SHA-256 `81a48493cee6abddebd8b208f37517664cbd5f2c631d30d1c5ded7cc38837b30`。复测从此归档解压独立副本，只调整副本的 TEST 入口；更新过的目录不反用为旧基线。

回归已覆盖 allowed=0/1、测试索引篡改、相同别名／schema 回退顺序、TEST 失败不转正式、轻量检查、文件同步和便携标记保留。网站 10 个元数据入口返回字节与本地产物一致；正式原始元数据另逐文件核对。实际旧客户端完成升级／健康重启，重新打开仍为 TEST，156 个客户端目标文件、35 个 MOD payload 文件的哈希全部通过，设置、玩家额外文件及 PTR 分支保留。成功记录为私有账本 `completed-journal.json`、`fresh-reopen-verification.json`。首次脚本在提交成功后使用旧 ASAR 解析缓存读取新文件报错，独立新进程复核通过，脚本已加入缓存失效处理；不是客户端安装失败。

用户人工入口为 `__Bin/update-test-3.7.0-20261105/Start-Test.cmd`，启动原版 3.6.1 的单独工作副本。启动器不会关闭已有人工窗口。人工应检查下载、退出、自动重启、3.7.3、设置保留、再次启动仍处于 TEST；手动验收完成前不发布正式 3.7。

私有账本位于 `_irys/releases/test-3.7.3-20261106/`：签名索引、逐文件 URL／大小／哈希、Git 映射、线上核对、实机结果及清理回执。废弃构建和重复候选检查路径／链接后送回收站，保留纯净基线、签名索引和验收证据。
