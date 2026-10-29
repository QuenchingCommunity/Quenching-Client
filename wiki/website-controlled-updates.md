# 官网控制更新与独立内测

2026-10-18：元数据完整超时／备用站、旧文本门禁处理及 schema 1/2/3 统一发布源策略见 [通用更新网络修复](update-network-fix-20261018.md)。后续版本（含 3.7）沿用同一策略；该记录明确区分源码、签名候选与未部署的官网备用路径，不能把源码通过当成线上已切换。

2026-10-09：本次为源码、私有发布器和隔离回归修改；没有重打便携包、上传新版本、替换正式 manifest 或部署测试接口。3.6 已分发客户端不会自动获得未发布的代码。以下区分已实现行为与网站待部署事项。

## 1. 谁决定更新内容

客户端固定的只有可信元数据入口、公钥、通用协议和文件写入范围。客户端不内置版本对应的文件列表、具体资源 URL 或镜像站地址，也不按 GitHub release 创建时间决定目标。

| 控制项 | 来源 |
| --- | --- |
| 是否公开 | `qm.txzy.net/version.que` 的 `allowed` |
| 客户端目标 | 签名 `client-manifests/latest.json` 的 `targetVersion` |
| MOD 目标 | 签名 `mod-sync-manifest.json` 的 `version` / `sequence` |
| 最新官方文件列表 | `fileSync.inventory` 指定的 gzip 元数据：路径、大小、SHA-256 |
| 下载源及优先顺序 | `fileSync.objects` / `fileSync.artifacts[*].sources` |
| 可选 GitHub 镜像 | `fileSync.githubMirrors`，按签名数组顺序；空数组或缺失则不自动追加镜像 |
| 可选 EXE / ASAR 差分 | `fileSync.deltas`；不匹配或失败用目标整文件 |
| 明确退役 MOD 文件 | `fileSync.deleted`，仍须核对官方所有权和磁盘旧哈希 |

签名清单中的镜像策略示例（这是字段示例，不是完整有效 manifest）：

```json
{
  "fileSync": {
    "githubMirrors": [
      "https://gh-proxy.com/",
      "https://gh-proxy.org/",
      "https://ghfast.top/"
    ]
  }
}
```

镜像只自动代理本项目两个公开 GitHub Release 的附件，不代理官网元数据、私有 R2 链接或凭据。HTTPS 证书和目标哈希校验保留。观察 15 秒后慢速换源、接近完成不轻易中断、最后一源不因低速反复中断，均沿用原下载行为。成功且校验通过的镜像可在相同策略下优先复用；远程移除或重排镜像后旧偏好失效。单次 403 不永久封禁整个站点。

官网调整源、镜像、优先级，不要求客户端重新编译，但发布方必须重新签名完整 manifest，网站部署签名后的原字节。仅改 URL 不用重传资源；改资源必须更新哈希和目标版本。修改已发布版本的内容并期待同版用户再次更新不受支持。

**旧正式 3.6 清单尚无 `githubMirrors` 字段。发布含本次代码的新客户端之前，必须让该次候选清单明确提供需要保留的镜像，不能忘加字段而以为旧内置镜像仍会生效。** 旧客户端已有的硬编码行为不能仅靠清单改写完全移除。

## 2. 不维护逐版本补丁图

启动约 10 秒检查：只读小型发布索引和当前版本标记。MOD 从当前分支 `_patch/keep.que` 读取；旧 3.4 用三个目录哨兵。客户端从真正运行的程序读取内部版本，不遍历目录猜版本。

用户确认后：

1. 取得当前版本的官方记录：优先使用安装时保存的 gzip 文件列表；首次缺少时下载 manifest 中的 `baselines[当前版本]`。历史记录是每版一份小型元数据，不是版本对版本的补丁。
2. 下载同一份最新官方列表，按路径、大小、哈希比较。3.6、3.7、3.8 都直接与最新列表比较，不依次安装中间版本。
3. 下载最终新增或变化的目标文件。同一个文件中间改了五次，只取最终内容；改回当前记录内容则不取。发布方必须提供对所有支持旧版本有必要的最终对象，不只提供“上一版到最新版”的变化。
4. 客户端对候选文件读取实际本地哈希：已是目标则复用；只有实际哈希匹配可选差分时才用差分，否则下载该目标整文件。EXE / ASAR 成对提交，Electron 内核变化仍提示手动换便携包。
5. MOD 只处理官方两版之间的变化项，不全量检查或修复玩家个性化目录。画质导致的资源位置变化沿用既有应用逻辑；清单中没出现的玩家文件不删除。删除仅限显式退役且实际内容属于官方的文件。
6. 保留原安装事务、进度、失败回滚、配置和另一分支。两种更新共用一个确认弹窗，都需要更新时先 MOD 再客户端。

这不是“每次扫描实际安装里的全部文件”。官方记录用于计算候选变化，候选文件再做必要的实际校验；官方版本间没变化的玩家文件不强制恢复。没有可信旧记录时提示缺少官方记录，不随意把玩家目录当旧正式包。

### 发布资料如何维护

- 每个产品维护一份持久发布 store。每个正式版本保留一个小型官方快照；同样内容按 SHA-256 共用对象，不因来源版本不同复制资源。
- 常规发布只运行 `_irys/build-file-sync.mjs`，为当前最新版本生成一份 schema 2 索引。不要每次循环运行旧 `build-client-update.mjs` 为所有历史版本重新做一套补丁。
- 已分发 3.5.0 / 3.5.1 的 schema 1 入口是固定的一次协议迁移桥。保留已有可用桥和其引用，旧用户先到能读 schema 2 的版本，再走最新清单。不要删除已有 URL，也不要把旧客户端入口直接改成它不认识的 schema 2。
- 公开 Release 给玩家放 Win / Mac 便携 ZIP；自动更新对象推荐独立更新 Release。移动现有对象前必须先有新 URL、重新签名并保证旧引用仍能下载；本轮没有迁移线上附件。
- 按文件下载与手动 ZIP 是不同入口。整份更新 ZIP 会让所有人下载其中全部内容；当前客户端不支持远程 ZIP 范围读取，不能把已有对象压成 ZIP 后只改 URL。

私有发布器本次新增参数：

```text
--github-mirror https://gh-proxy.com/
--github-mirror https://gh-proxy.org/
--github-mirror https://ghfast.top/
--metadata-url-base https://qm.txzy.net/quenching/client-files/
```

`--github-mirror` 可重复，次序进入签名清单；不传则空策略。`--metadata-url-base` 可重复，指定 gzip 元数据的下载根；文件对象仍由 `--url-base` / `--chunk-url-base` 指向 GitHub 等资源源。生成文件不等于上传，元数据改指官网之后，网站必须真的部署对应 gzip 原件。

## 3. 独立测试 flag

2026-10-24 起发布顺序固定为：带持久标记的本地 TEST 包 → 用户人工通过 → 独立测试自动更新 → 用户再次通过 → 正式大包及验证。资源位置、Git 历史与两次人工验收记录见 [测试优先发布流程](../.agents/skills/quenching-release/references/test-first-workflow.md)。

交付的 Windows TEST 包必须在 EXE 同级带 `quenching-update-test.json`（schema 1、enabled true、本次 baseUrl），首次直接双击及更新后重启均自动设置 `QUENCHING_UPDATE_TEST=1`。配置和 Chromium 数据分别隔离到 `.test-config`／`.test-user-data`；不依赖用户配置 CMD／环境变量。只用终端设置变量属于开发／自动化入口，不能代替首次本地包中的持久标记。默认只用以下测试端点：

```text
https://qm.txzy.net/quenching/update-test/version.que
https://qm.txzy.net/quenching/update-test/client-manifests/latest.json
https://qm.txzy.net/quenching/update-test/mod-zip-manifest.json
https://qm.txzy.net/quenching/update-test/mod-sync-manifest.json
```

测试路径不存在、返回 HTML、签名错误或下载失败，都不回退正式 manifest / version.que。旧的 `QUENCHING_*_MANIFEST_URL` 和 `QUENCHING_VERSION_URL` 覆盖不会优先于此 flag。

可用 `QUENCHING_UPDATE_TEST_BASE=https://qm.txzy.net/quenching/update-test/某次候选/` 切换候选目录。仅隔离回归允许 `http://127.0.0.1:端口/`；远程仍需 HTTPS。

**测试版本号由测试 manifest 提供，不伪造用户已经安装的版本。** 例如测试下一内部候选 `3.6.1`，测试目标就是 `3.6.1`，当前仍如实是 `3.6.0`。演练不同旧版本，用各旧版的隔离便携副本和官方快照，而不是给同一 EXE 强塞假基线。这避免重复更新循环，也能真实验证跨度。

PowerShell 示例，先复制独立客户端 / 小型资源夹具，关闭正式客户端，再在此终端启动测试副本：

```powershell
$env:QUENCHING_UPDATE_TEST = '1'
$env:QUENCHING_UPDATE_TEST_BASE = 'https://qm.txzy.net/quenching/update-test/候选目录/'
& 'D:\独立测试目录\QMClient.exe'
```

生产回归退出测试副本，在启动正式客户端的终端取消 flag：

```powershell
Remove-Item Env:QUENCHING_UPDATE_TEST -ErrorAction SilentlyContinue
Remove-Item Env:QUENCHING_UPDATE_TEST_BASE -ErrorAction SilentlyContinue
# 不要带着旧的 PREVIEW_UPDATES、VERSION_URL、MANIFEST_URL、CLIENT_MANIFEST_URL 覆盖变量。
```

测试 flag **不是只读模式**：确认安装仍会操作所选测试目录。因此不把它对准真实玩家游戏目录。测试目标版本 / 序号若人为高于随后正式目标，关 flag 不会自动降级；用正式候选的真实目标版本进行预发布，或丢弃独立测试副本。

## 4. 测试候选转正式要改什么

只有本地包和测试自动更新两次人工验收通过后才进入正式阶段。测试 ZIP 中必须有持久标记，正式 ZIP 中必须没有。正式导出使用未启动过的构建输出，明确移除／过滤专用标记，并排除测试配置、缓存和启动脚本；不修改用户已验收的测试安装。运行正式候选时清除测试／预览／URL 覆盖变量，再验证正式入口。测试／正式二进制相同时可复用冻结构建，不要求仅为了去标记重新编译。

发布侧仍有必要步骤，不能只关 flag 就把测试资源公开：

1. 首次本地测试使用真实 I0，人工通过后制作真实更高 I1 的测试自动更新；第二次人工通过后，正式候选使用已验收的最终 I1 和冻结二进制。确认源资源、ZIP、官方快照和运行版本一致。不要把版本标成 3.6.99，再期望关 flag 后自动降到正式 3.6.1。
2. 将已验证对象上传到正式、不可变 URL；测试资源不写入正式对象的已有 URL。资源哈希不变时可复用同一对象，不必重传。
3. 把元数据、对象源和候选目录引用改成正式 URL，明确镜像策略；若签名清单字段有变化，发布方重签。若字节 / 内部版本变化，则重建快照及对应对象后重测受影响部分。
4. 网站部署正式签名 manifest 和 gzip 原件，再按授权发布窗口开放正式 `version.que`；保留旧迁移桥。用户测试不授权替换正式 endpoint。
5. 关闭 flag 后，用正式地址做必要快速核对和实机验收。候选里不夹带 `_irys`、私钥、测试环境文件。

## 5. 网站维护者的操作单

本轮无需动正式 3.6。部署测试环境时：

1. 创建上述三个 `/quenching/update-test/` 端点；gate 使用原 JSON 协议，`allowed:0`，版本填候选实际显示版本 / MOD 版本。
2. 原字节部署发布方生成并签名的两产品测试 manifest，不自行编辑 / 签名；两个 manifest 引用各自候选快照和测试对象。Windows 客户端仍只接收 win32-x64 方案，Mac 不使用 Windows 清单。
3. 将 `--metadata-url-base` 指定的 gzip 原件部署到对应 URL，包括首次迁移需要的旧快照；不要给 JSON 或 gzip 返回 SPA HTML。大资源不需要放进网站项目。
4. 不修改正式 `version.que`、正式 latest、正式 MOD 清单或旧 3.5 迁移端点。测试端点失败应明确返回 404，不重定向正式路径。
5. 收到正式发布授权和正式签名原件后，再按上一节切换正式文件。URL / 镜像维护以后通过签名 manifest 完成，不改客户端硬编码。

## 6. 本轮验收边界

```powershell
npm run test:update-channel
npm run test:update-download
npm run test:file-sync
```

测试使用真实更新服务、本地 HTTP 远程模拟、临时安装树和临时签名密钥：跨多个旧版本到同一个目标、只取最终变化、没有启动全量扫描、候选实际哈希不同整文件回退、镜像远程启停 / 重排、篡改签名拒绝、资源 / 客户端回滚、独立 test 端点和 flag 关闭恢复正式路由。测试不联系真实官网、不关闭玩家游戏、不修改真实客户端 / 资源树。

上述通过不等于公网 `qm.txzy.net` 测试端点已部署、国内各网络已验收或新便携包已分发。真实旧 3.5 程序仍须通过现有桥获得新代码；本轮不重建或移除它们的已用附件。
