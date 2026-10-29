# 协议、代码与发布工具位置

路径相对仓库根；私有工具实际保存在 `_irys/`，不随 Git 克隆。缺失时报告缺少哪项输入／工具；不要把私钥或整个 `_irys/` 纳入仓库以“补齐发布环境”。以下接口是当前源码合同，不代表它们均已在线部署。发布阶段与资源／Git 历史以 [测试优先流程](test-first-workflow.md) 为准；先两次人工验收再做正式大包。

## 1. 仓库与元数据接口

| 用途 | 位置／说明 |
| --- | --- |
| MOD GitHub | `https://github.com/QuenchingCommunity/Quenching-Assets`；完整包和 MOD 更新产物 |
| 客户端 GitHub | `https://github.com/QuenchingCommunity/Quenching-Client`；Win／Mac 便携包和 Windows 更新产物 |
| MOD GitLawb | `quenching-mod-updates`；公开仓库 URL 由 `_irys/gitlawb-migration-source.ts` 给出 |
| 客户端 GitLawb | `quenching-client-updates`；核对已签名客户端清单和私有 checkout 的 remote，不盲猜 DID |
| GitLawb 下载 | `https://node.gitlawb.com/api/v1/repos/<DID>/<repo>/blob/<path>`；不是 GitLab Releases |
| GitHub 下载 | `https://github.com/<owner>/<repo>/releases/download/<tag>/<asset>`；不用 Raw Content |
| 发布门禁 | `https://qm.txzy.net/version.que`；备用 `https://www.tianxiazhengyi.net/version.que` |
| 新闻 | 主域根 `newscn.md`／`newsen.md`，旧域兼容；只有中文界面拉中文，其余已支持语言拉英文 |
| MOD schema 2 | 主域 `/api/quenching/mod-sync-manifest.json`、`/quenching/mod-sync-manifest.json` |
| MOD schema 3 连续 ZIP | 主域 `/api/quenching/mod-zip-manifest.json`、`/quenching/mod-zip-manifest.json`；新客户端优先，旧端点不覆盖 |
| MOD schema 1 | 主域 `/api/quenching/manifest.json`、`/quenching/manifest.json`；旧客户端继续用 |
| 客户端 schema 2 | 主域 `/api/quenching/client-manifests/latest.json`、`/quenching/client-manifests/latest.json` |
| 客户端 schema 1 | 主域 `/api/quenching/client-manifests/<当前内部版本>.json`、`/quenching/client-manifests/<当前内部版本>.json` |
| R2 | 私有桶经 Worker 下载；最后备用；从本次签名产物和发布方配置确定实际地址 |
| 埋点 | `https://qm.txzy.net/v1/telemetry/events`；后端存储迁移不改客户端入口 |

更新目标由签名索引中的 MOD sequence／客户端 targetVersion 决定，不走 GitHub 最新创建时间，也未实现直接发现 GitHub Latest Release 并自动下整客户端的兜底。公开 tag／显示名可以不变，内部目标必须向前。

2026-10-23 上述两库及 OpenQuenching／Quenching-Gitbook 转移至 QuenchingCommunity；旧 UIZorrot 地址依靠 GitHub 重定向兼容。新发布使用组织地址，保留旧签名清单原字节，不为换 owner 直接改已签名 JSON。已分发旧客户端镜像识别只支持旧 owner，故旧清单仍保留旧 URL；新客户端和发布器源码同时识别两个 owner。不要在旧命名空间重建同名仓库，否则会破坏重定向。私有历史发布脚本仍有旧 owner，下一次运行前须显式核对目标（含 gh -R、url-base 和镜像前缀），不能盲重跑旧发布。详见 wiki/github-organization-migration-20261023.md。

`version.que` 支持旧纯文本 `v3.4` 和 schema 1 JSON。当前 JSON 必须含 `schema:1`、有效 `version`、数字版本 `modVersion`、整数 `allowed:0|1`；不是字符串 `"1"`。源码见 `src/shared/release-gate.ts`。

独立内测使用 EXE 同级 `quenching-update-test.json` 启用 `QUENCHING_UPDATE_TEST=1` 和本次 `QUENCHING_UPDATE_TEST_BASE`，首次交付必须有持久标记。该 base 下分别提供 `version.que`、`client-manifests/latest.json`、`mod-zip-manifest.json`／`mod-sync-manifest.json`，失败不回退正式。详见 `src/Main/services/update-test-init.ts`、`update-channel.ts` 和 `test-first-workflow.md`。

旧预览变量是 `QUENCHING_PREVIEW_UPDATES=1`，不能代替独立测试通道；候选位置可使用 `QUENCHING_VERSION_URL`、`QUENCHING_MANIFEST_URL`、`QUENCHING_CLIENT_MANIFEST_URL`。仅对本次隔离启动生效，不写入正式包／系统永久环境。生产回归清除这些变量。预览变量不授予官网下载或发布权限，也不能凭空补出未部署的 manifest。

## 2. 客户端运行代码地图

| 负责内容 | 代码位置 |
| --- | --- |
| 应用内部／公开版本 | `package.json`、根 `release-version.json`、读取公开 JSON 的 `src/Renderer/version.ts` |
| UIQUE／WebUI 版本生成及检查 | `scripts/prepare-release-assets.mjs`、`scripts/templates/quenching-webui.html`；见 `version-assets.md` |
| 生产编译 | `scripts/webpack.build/`；Main／Renderer／Preload 的 partial 配置 |
| Win 打包范围、ASAR／原生解包 | `electron-builder.yml` |
| 便携导出的测试／正式通道 | `scripts/portable-release-channel.mjs`、私有 `_irys/export-win-test.mjs`；默认测试并要求本次 base |
| 测试标记与配置隔离初始化 | `src/Main/services/update-test-init.ts`、`update-channel.ts`；EXE 同级 JSON，更新后保留 |
| Mac 原生架构制作 ad-hoc .app／ZIP、冷缓存下载及 ZIP 启动验收 | `.github/workflows/build-mac.yml`、`scripts/package-mac-app.mjs`、`scripts/lib/electron-download.mjs`、`scripts/smoke-mac-archive.mjs`；Windows 不可代替 Mac 打包及启动验收 |
| 主进程更新服务注册／健康确认 | `src/main.ts`、`src/Main/ipc/client-update-handlers.ts`、`src/Main/ipc/mod-update-handlers.ts` |
| 活动 preload／API 类型 | `src/Main/preload.ts`、`src/types/electron-api.d.ts` |
| 初检、合并弹窗、确认、进度、更新顺序 | `src/Renderer/components/MainWindow/index.tsx` |
| gate 下载及预览判断 | `src/Main/services/release-gate-service.ts`、`src/shared/release-gate.ts` |
| 新协议验证／文件差异／对象与分片 | `src/shared/file-sync.ts` |
| 官方 gzip 快照 | `src/Main/services/file-sync-snapshot.ts` |
| MOD 检查、下载、备份、提交与回滚 | `src/Main/services/mod-update-service.ts` |
| MOD marker／3.4 轻量识别 | `src/Main/services/mod-version-detection.ts`、`src/Main/services/mod-integrity-service.ts` |
| 客户端检测、暂存、差分、单文件回退 | `src/Main/services/client-update-service.ts` |
| 退出后替换、重启、健康确认、回滚 | `assets/updater/client-update-helper.cjs` |
| 完整包 ZIP／A-B／文件夹安装 | `src/Main/services/full-package-install.ts` |
| 分支开关／QMoff | `src/Main/services/branch-mod-toggle.ts` |
| 画质／安装后资源应用 | `src/Main/services/graphics-layout-service.ts`、`src/Main/services/version-skin-service.ts`、`src/Main/services/ui-service.ts` |
| 配置、语言与目录持久化 | `src/Main/services/config-manager.ts`、`src/Renderer/hooks/useWar3Detector.ts`、`src/Main/services/war3-path.ts` |
| WebUI 源资源与同步 | `src/Main/services/webui-assets-service.ts`、`src/Main/services/asset-sync.ts`；源目录按该服务核对 |
| 新闻语言选择 | `src/Main/services/news-service.ts`、`src/Renderer/utils/news.ts` |
| 外部皮肤依赖与路径重写 | `src/Main/services/custom-skin-service.ts`、`src/Main/services/model-resource-service.ts` |
| 埋点固定入口 | `src/Main/services/startup-telemetry.ts` |

部分资源设置服务命名沿用旧版习惯，应阅读调用链确认实际作用于所选 `_retail_`／`_ptr_`，不凭名称推断路径。

### 版本与快照落盘

MOD `_patch/keep.que` 末尾有效记录示例：

```text
-v3.5-
-s35-
-d3.5-
```

新资源版本使用本次真实 version／递增 sequence／公开 displayVersion；只写最后一个版本号却忘序号可能使下一版无法被管理。普通 3.5 无 sequence 的历史标记可映射 35，其他版本不能靠浮点乘法猜 sequence。

- 所选分支 `_patch/qmf-<version>.files.json.gz`：官方资源快照。
- 所选分支 `.quenching/installed-mod.json`：已安装 MOD 状态；不是启动全量遍历的依据。
- 客户端 `resources/assets/updater/client-files.json.gz`：官方客户端快照，与更新事务一起提交。
- 客户端 `.quenching-client-update/`：事务、备份和健康记录；不是发布方 store。
- 发布方 `--store/file-sync-history.json` 及小型快照是持久元数据；测试／正式 store 分开。大对象缓存可按已验证 URL／哈希重取，不要求永久保留，不整删历史账本和小快照。

## 3. 私有发布工具与参数

### MOD 当前资源输入：Latest 唯一事实源

准备入口 `_irys/prepare-mod-latest.ts` 直接扫描 `D:/Quenching/QM/Latest`，不生成完整 `mod-root` 副本。当前资源内容不能从旧快照／旧目录补齐。完整包入口 `_irys/package-full-36.mjs` 从该候选读取版本与小型元数据，资源字节只读 Latest。命令、元数据同步和保留策略见 `latest-source.md`。

### MOD schema 3：每个资源版本一份 ZIP

2026-10-09 用户决定 MOD 用连续版本间 ZIP，客户端保持已验收的文件差异更新。私有工具 `_irys/build-mod-zip.ts` 只生成一份 ZIP 和官网签名索引，不上传散文件；参数、格式、兼容边界及验收见 `wiki/mod-zip-updates.md`。首轮不传 `--chain`，后续传上版 schema 3 索引并只追加新过渡。GitLawb 当前停用，镜像由签名官网索引控制。

### schema 2：当前客户端发布器和旧 MOD 兼容

`_irys/build-file-sync.mjs`：扫描官方输入，读取小型历史账本，生成快照、需要上传的 SHA-256 `.bin` 对象、可选分片／差分及签名索引，不自行上传或改官网。客户端扫描排除根级测试标记／配置／缓存／启动说明，保留测试选择文件在 ASAR 外；测试产物不混入正式 store。

通用参数：

```text
node _irys/build-file-sync.mjs
  --product quenching-client 或 quenching-mod
  --root 本次最终官方输入目录
  --version 本次内部版本
  --display-version 对外版本（可选）
  --output 独立的本次候选目录
  --store 本产品持久历史目录
  --url-base HTTPS整文件和快照下载根（可重复，顺序为备用顺序）
  --private-key 发布机现有签名私钥路径
```

MOD 还必须提供 `--sequence`（当前工具接受 35 及以上）；客户端必须提供 `--runtime-version`（实际 Electron 版本）。输出 MOD `mod-sync-manifest.json`，客户端 `latest.json`。

首次迁移任选：

- `--seed-snapshot 正式旧版.files.json.gz`，可重复提供各旧版本。
- `--seed-root 未改过的旧正式解压目录 --seed-version 旧内部版本`；MOD 另给 `--seed-sequence`，客户端建议明确 `--seed-runtime-version`。

MOD 3.4 的原目录还藏有旧资源 ZIP，不能简单 `--seed-root` 扫原工作目录当已安装布局。先用已生成的 3.4 官方清单或正确展开的旧正式树。

可选：

- `--chunk-url-base GitLawb分片下载根`，可重复；`--chunk-size` 是字节，默认 `16777216`（16 MiB）。大对象优先按该源分片下载，再用 url-base 的整对象备用。
- 小对象和快照只用 `--url-base`，所以需要 GitLawb 小文件源时，也提供它的整文件根，不只设置 chunk-url-base。
- 客户端 `--delta-base 真实旧正式目录 --zstd 发布机zstd.exe`，仅 EXE／ASAR 且有压缩收益时生成可选差分。两项一起传，不生成差分也可按变化整文件更新。

最新与旧版快照每版一份。对象名按哈希，不按目标相对目录上传；分片 `.bin.partNNNN` 不给玩家手工解压。发布器检测到已记录内部版本对应不同摘要会拒绝；先冻结版本和输入，再生成。

### schema 1 客户端兼容引导

`_irys/build-client-update.mjs` 参数：

```text
node _irys/build-client-update.mjs
  --old 真实旧正式win-unpacked
  --new 本次最终win-unpacked
  --out 本次独立兼容产物目录
  --base-version 真实旧内部版本
  --target-version 新内部版本
  --private-key 发布机现有签名私钥路径
  --zstd 发布机zstd.exe
  --url-base 该产品HTTPS下载根（可重复）
  --artifact-prefix 本次唯一前缀（可选）
```

输出 `<base-version>.json`（已签名）、EXE／ASAR `.zst`、其他变化 `.bin`。当前工具不输出便携 ZIP，不支持 Mac，不自动给同版本不同二进制基线提供救援方案。不要在不同客户端发布中复用同一 URL 前缀覆盖文件。

### schema 1 MOD／3.4 特殊迁移

| 工具 | 当前职责与限制 |
| --- | --- |
| `_irys/build-mod-baseline.ts` | `--root --version --sequence --output`；生成官方资源 gzip 清单，不扫描玩家目录 |
| `_irys/build-mod-delta.ts` | `--from --to --from-sequence --to-sequence --version --output`；旧固定 3.5 基线累计补丁，非新协议常规发布器 |
| 同上 `--legacy-34` | 仅 34→35／目标3.5；另给 `--baseline-output`；展开旧 `QM3.3part1.zip`、`QM3.3part2.zip`、`RetroModel.zip` 参与比较 |
| `_irys/build-35-migration-manifest.ts` | 仅3.4→3.5；显式 `--artifact --output --gitlawb-chunks --gitlawb-blob-root --gitlawb-part-size-mib --github-url`，旧默认路径过期 |
| `_irys/sign-mod-manifest.ts` | `--input --output --private-key --key-id`；签名旧 MOD unsigned 清单 |
| `_irys/split-mod-patch.ts` | 旧 qdelta 传输分片，固定旧文件命名；不是拆首装 A／B ZIP 的工具 |
| `_irys/sync-qmf35-shaders.ps1` | 写死 QMF3.5 并删除备份后的目标 shaders；授权且核对目标后才能用，不作为只读检查 |

### 上传与验证工具，先查硬编码

- `_irys/publish-client-351-gitlawb.ps1`：固定3.5.1／20261002目录，只选 `.bin/.zst`，**不能直接上传 schema 2 快照和分片**。
- `_irys/publish-gitlawb-final-35-16m.ps1` 等：旧3.5 qdelta；不可直接套新对象产物。
- `_irys/verify-client-351.mjs`：固定内部3.5.1及输出路径；校验两平台资产／ASAR／Mac权限，不是通用下一版验证器。
- `_irys/verify-client-351-sources.mjs`：固定旧 schema 1 清单；逐源真实字节验签／哈希。
- `_irys/verify-signed-mod-manifest.mjs`：固定旧补丁大小、哈希、分片数；不能拿它的固定断言作为下一版期望。
- `_irys/test-production-client-update.mjs`：真实便携客户端升级，但固定3.5.0→3.5.1。`--live` 才使用正式站点，不应在未审查它的版本、目标及清理逻辑前运行。
- `_irys/test-client-helper-rollback.mjs`：旧助手隔离回滚验证，使用时核对本次输入与故障注入。
- `scripts/check-update-site.mjs`：固定3.5 MOD旧接口；默认预发布期待旧 `v3.4`，`--staged`／`--release` 使用3.5门禁。不能用它证明新的客户端 latest／schema2／下一版已上线。

公钥是 `assets/quenching/update-public-key.pem`。发布机签名私钥、GitLawb identity／UCAN、R2上传凭据只查存在及配置引用，不打印其内容。不要因重建包生成新的公钥导致已分发客户端不能验签。

## 4. 可复用的源码测试入口

基础更新回归：

```powershell
node scripts/test-portable-release-channel.mjs
node --import tsx scripts/test-portable-update-test.ts
npm run test:update-channel
npm run test:file-sync
npm run test:mod-zip
node scripts/test-mod-update-node.mjs
npm run test:mod-version-lightweight
npm run test:combined-update-prompt
node --import tsx scripts/test-release-gate.ts
node --import tsx scripts/test-full-package-archives.ts
node --import tsx scripts/test-branch-mod-toggle.ts
node --import tsx scripts/test-mod-update-profile-apply.ts
node --import tsx scripts/test-post-install-profile.ts
node --import tsx scripts/test-ui-default.ts
node --import tsx scripts/test-graphics-layout-startup.ts
npm run test:war3-detector-persistence
npm run build
```

按本次受影响功能追加 `test:custom-skin-textures`、`test:system-language`、`test:skin-i18n`、`test:news-language`、`test:i18n`、`test:post-processing-config`、`test:webui-asset-sync`。埋点有关时再跑 `test:startup-telemetry` 和 `node scripts/test-startup-telemetry-state.mjs`；普通发布不趁机改其 URL。

`test:file-sync` 使用真实服务、隔离配置／小文件／本地 HTTP，覆盖跨版本只下载差异、官方历史新增／恢复／改回、对象／分片／差分回退、签名篡改、文件保留、应用回滚和助手健康确认。它不能证明已分发旧客户端能识别 schema 2，也不能代替两次人工验收、正式源和按需获取旧客户端的升级验证。

开发浏览器回归在 `scripts/research/`，选择本次相关页面。网络／IPC 模拟与真实游戏只读预览分清；没有页面运行错误才可交付。全仓 TypeScript 既有诊断单列，不能以生产构建通过宣称全仓类型检查通过。
