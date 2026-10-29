# 自动更新维护约定与代码地图

更新日期：2026-10-25。本文记录用户长期要求，以及本地代码／发布记录核对结果；不是本次线上连通性或正式上线证明。根 `AGENTS.md` 保存必须持续遵循的约定。

## 上传与资源位置

| 内容 | 位置 | 用途／核对方式 |
| --- | --- | --- |
| 客户端源码 | `D:/Quenching/QM/MOD/QuenChing-Electron-Client` | `package.json` 内部版本、`release-version.json` 对外版本 |
| 客户端附加资源 | 同仓库 `assets/`，其中 `assets/quenching/` 为着色器、DNC、UI 等 | 打包到 `resources/assets/`；不能为适配发布反向修改源资源 |
| 更新助手 | `assets/updater/client-update-helper.cjs` | 客户端退出后替换、重启、健康确认和回滚 |
| 完整包／MOD 资源唯一工作源 | `D:/Quenching/QM/Latest` | 独立 Quenching-Assets Git 工作区；不能用当前 HEAD 冒充某正式历史版本 |
| 客户端上传仓库 | `https://github.com/QuenchingCommunity/Quenching-Client` | Release 上传便携包、机器更新对象／可选差分；具体 tag 由本次清单确定 |
| 完整包／MOD 上传仓库 | `https://github.com/QuenchingCommunity/Quenching-Assets` | Release 上传完整 A/B、手动覆盖包、自动更新 ZIP；A/B 为两个普通 ZIP |
| 官网元数据 | `https://qm.txzy.net`，兼容站 `https://www.tianxiazhengyi.net` | 发布门禁和签名清单；是更新选择入口，不以 GitHub latest 创建时间判断目标 |
| 测试元数据 | `https://qm.txzy.net/quenching/update-test/<候选>/` | 每次显式指定独立 base；测试和正式索引／store 分开 |
| GitHub 镜像 | 已验签清单的 `githubMirrors` | 仅代理本项目公共 Release 文件，不代理元数据或私有凭据；不写死历史镜像列表 |
| R2 | 私有桶经 Worker，具体地址按本次签名配置核对 | 最后备用，独立验证可用才启用；本次未确认实际桶／Worker 地址 |
| GitLawb／Irys | 历史源；现已停用 | `_irys/` 是现有私有发布工具目录名，不表示仍使用 Irys 存储 |
| 本地私有工具与账本 | `_irys/`，被 Git 忽略 | 保留必要脚本、密钥引用、小型历史账本；新中间产物转入 `_tmp/` |

组织迁移前的 `UIZorrot/Quenching-*` 仍可能出现在旧签名清单／脚本中。新发布用 QuenchingCommunity；历史签名清单不能只改 URL 而破坏签名。发布前检查旧脚本硬编码，不盲重跑。

官网正式路由由 `src/Main/services/update-metadata-urls.ts` 生成：

| 元数据 | 路径 |
| --- | --- |
| 门禁 | `/version.que`、`/quenching/version.que`，按源码顺序尝试两站 |
| 客户端 schema 2 | `/api/quenching/client-manifests/latest.json`、`/quenching/client-manifests/latest.json` |
| 客户端 schema 1 兼容 | 相同前缀下 `client-manifests/<当前内部版本>.json` |
| MOD schema 3 | `/api/quenching/mod-zip-manifest.json`、`/quenching/mod-zip-manifest.json` |
| MOD schema 2 兼容 | 相同前缀下 `mod-sync-manifest.json` |
| MOD schema 1 兼容 | 相同前缀下 `manifest.json` |

测试 base 下使用相对 `version.que`、`client-manifests/latest.json`、`mod-zip-manifest.json` 和同一 base 的兼容 `mod-sync-manifest.json`。这些是源码配置入口，不表示本次候选已经部署。其他人工网盘分发不能凭既有插件或历史路径视为自动更新源，实际新增时应补齐本表。

## 当前自动更新原理

1. 前端启动约 10 秒后检查小型门禁与签名索引，根据真实客户端内部版本、MOD 版本／sequence 判断可更新性。用户确认前不下载／应用大资源；客户端和 MOD 共用确认流程，同时更新先 MOD 后客户端。
2. 测试包的 EXE 同级 `quenching-update-test.json` 由 `update-test-init.ts` 初始化 `update-channel.ts`，更新后保留测试入口，配置／浏览器缓存隔离。测试失败不切正式。该标记不会隔离游戏目录，自动化必须选独立测试游戏目录。
3. 客户端 schema 2 在 `stageClientFileSync` 中下载并验证当前／目标官方快照，先算官方版本之间变化，再对候选本地文件计算实际 SHA-256；EXE 和 ASAR 总会纳入候选。与目标相同就本地复制，否则匹配本地旧哈希的可选二进制差分，失败回退对应完整目标文件。其他未进入官方变化计划的文件不会因此被全量检查／修复。
4. 客户端暂存验证后退出，由独立助手执行替换和重启。新的官方快照与应用文件同事务提交，健康确认和回滚保护已安装状态。Windows x64 是目前自动更新范围；Electron 核心变化需新便携包，macOS 当前手动更换。
5. MOD 优先 schema 3 连续 ZIP，根据 sequence 规划相邻版本路径，每步下载整个 ZIP、验签／验哈希、验证 payload、事务安装和更新标记；默认最多 6 步。失败回滚本步，已经提交的步骤保留。它不是下载前对本地目标逐文件比对后按需取对象的实现。
6. 旧 MOD schema 2 比较官方快照，只下载官方变化对象；当前代码未像客户端一样先对这些对象逐一判断本地是否已等于目标。schema 1／3.4 特殊迁移继续兼容，不能把官方旧哈希作为更新资格要求。
7. 下载源以签名清单为准；GitHub 文件可使用清单批准的镜像。15 秒窗口低速／无进展切源，最终源保留完成机会；只有整产物校验通过才记住成功镜像。临时失败不绕过签名或哈希。
8. 安装作用于选定 `_retail_`／`_ptr_`，保留 QMoff 和另一分支。删除资源需显式可信删除记录及可接受旧哈希，玩家额外文件／改动不能因目标清单缺项而被清空。
9. 启动渲染刷新属于本地附加资源同步，入口 `startup-rendering.ts`、`asset-sync.ts` 和 `shader-handlers.ts`。它与网络版本更新不同，但安装后重应用设置时会交汇。2026-10-25 加入 shaders 目录移动重试及文件级回退／回滚；源码测试通过不等于已经打包上线。

## 用户新要求与开发缺口

客户端和完整包／MOD 均须尽量根据本地实际内容与可信目标比较后最小下载；现有实现只部分满足。后续开发依次落实：

- 在用户同意更新后、下载大对象前建立按需本地差异计划。启动检查保持轻量，只检查需要管理的路径，不全盘扫描猜版本。
- 客户端复用已符合目标的文件、已验证缓存和可获益差分；明确缺失／损坏的受管文件修复策略，不将官方快照之间无变化当成本地必然正确。
- 为完整包／MOD 补充可按需选择的传输颗粒度及元数据；连续 ZIP 无法跳过 ZIP 内单个文件，仅安装时跳过写入不能算节省下载。具体协议通过实现和实测选择，不仅修改文档或改扩展名。
- 跨版本直接比较目标，尽量消除中间版本同路径反复下载；保留有顺序依赖的迁移步骤及已分发旧协议兼容。
- 每版测试／正式独立入口、签名索引和发布账本；测试客户端真实版本递增后能拉取测试更新，重启仍留测试通道，正式候选移除测试标记。
- 用实测字节验收：相同内容零大对象下载、缺失／变化文件按需拉取、已有目标复用、跨版本重复消除、差分失败只回退对应文件、篡改拒绝、断点／失败回滚、测试不串正式，以及玩家文件保留。

这些是待实施／持续维护的验收要求，不能写作现有功能全部完成。最新用户要求优先于旧文档中固定使用 MOD ZIP／不再逐文件发布的方案约束；新方案仍需验证真实旧客户端升级路径。

## 中间产物与清理

开发／打包／验证的临时下载、解压、比较、候选中间文件和日志放 `_tmp/<任务>/`。测试与正式任务分子目录；未完成验收的候选保留到验收结束，不把每版完整旧树长期堆积成历史。

`_tmp/` 加入 Git 忽略。交付前清掉本次已无用途的大对象和临时树，保留小型清单、签名索引、Git 映射、哈希／URL 和必要验收证据到长期记录位置。密钥不因放进 `_tmp` 就可以公开。旧 `_irys/releases/`、`__Bin/` 等路径是历史证据或工具既有输出，不能不核对引用／可重取性就整删。

当前运行期尚有 `.quenching/update-staging`、`.quenching-client-update`、`.quenching-rendering-*` 等事务／暂存布局，测试也有系统临时目录用法，不能宣称已统一。改造时把可清理的中间文件放安装同卷 `_tmp/<事务>/`，保留必要持久事务／健康记录；确认成功或已恢复后清理。回滚失败备份与进行中的事务必须保留，不盲目移到不同卷破坏 rename 语义。

## 核心入口

| 职责 | 路径 |
| --- | --- |
| UI 检查／合并确认／顺序 | `src/Renderer/components/MainWindow/index.tsx` |
| 测试初始化与 URL 选择 | `src/Main/services/update-test-init.ts`、`update-channel.ts`、`update-metadata-urls.ts` |
| 门禁、签名和校验 | `src/Main/services/release-gate-service.ts`、`update-metadata.ts`、`src/shared/file-sync.ts` |
| 客户端计划、暂存及重启 | `src/Main/services/client-update-service.ts`、`assets/updater/client-update-helper.cjs` |
| MOD 计划和事务 | `src/Main/services/mod-update-service.ts`、`src/shared/mod-zip-update.ts`、`src/Main/ipc/mod-update-handlers.ts` |
| 本地标记／快照 | MOD 分支 `_patch/keep.que`、`_patch/qmf-<version>.files.json.gz`、`.quenching/installed-mod.json`；客户端 `resources/assets/updater/client-files.json.gz` |
| 完整包首装 | `src/Main/services/full-package-install.ts` |
| 下载与慢源切换 | `src/Main/services/update-download.ts` |
| 私有发布器 | `_irys/prepare-mod-latest.ts`、`build-mod-zip.ts`、`build-file-sync.mjs`、`export-win-test.mjs`；运行前核对实际参数和硬编码 |
| 回归 | `scripts/test-file-sync-node.mjs`、`test-mod-zip.ts`、`test-update-download.ts`、`test-update-channel.ts`、`test-portable-update-test.ts`、`test-combined-update-prompt.ts` |

完整发布流程及历史证据见 `.agents/skills/quenching-release/SKILL.md` 与其 references；本文不自行开启打包、上传或切换线上清单。
