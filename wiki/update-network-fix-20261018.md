# 更新网络通用修复：源码、候选与部署边界

日期：2026-10-18。当前客户端仍为 3.6.1，MOD 正式清单仍为 3.6.2／38；本次不升版本、不改 Latest／源 assets、不上传客户端、不部署官网。

## 实现

- `src/Main/services/update-metadata.ts`：客户端清单、MOD 清单、发布门禁共用直接 Node HTTP(S) 请求。单次 15 秒硬截止覆盖 DNS／TLS／重定向／完整正文；一次端点故障转移总预算 45 秒，防止很多备用地址把检查拖成数分钟。网络失败在其他地址之后最多补试一次；404、非法 JSON、签名失败不反复请求。TLS、公钥、字节上限和下载哈希校验保留。
- `src/Main/services/update-metadata-urls.ts`：按路径生成主站 API／普通路径及旧站备用路径。最新索引优先于逐版本兼容地址；版本参数来自当前应用，不写死 3.5／3.6／3.7。旧站路径只有部署同一份元数据后才有实际冗余，目前不代表它已就绪。
- `src/Main/services/release-gate-service.ts`：旧站纯文本 `v3.4` 不再是现代更新的公开授权。必须取得结构化 JSON 门禁；`allowed:0` 立即返回关闭状态，不通过换源找一个 `allowed:1` 绕过去。主站有效 JSON 的版本不匹配也仍阻断 MOD；不能为了可下载而绕过版本绑定。
- `scripts/lib/update-source-policy.mjs`：无网络／无凭据的通用发布策略。schema 1 为每个公共 GitHub Release 文件加入明确镜像 URL，兼容不懂 `githubMirrors` 的旧客户端；schema 2／3 只更新签名镜像策略。不修改版本、文件列表、内容哈希、旧哈希或安装逻辑，也不将私有 URL／元数据送到公共镜像。
- 私有 `_irys/update-source-policy.json` 统一保存本次镜像顺序：gh-proxy.com → ghfast.top → gh-proxy.org。GitHub 仍先尝试，已校验成功的镜像仍会在本次进程后续下载中优先。org 保留在最后，不因部分用户不能用就全部移除。
- 私有三个发布器 `build-client-update.mjs`、`build-file-sync.mjs`、`build-mod-zip.ts` 都调用同一策略；可用 `--source-policy` 指定本次策略。显式 `--github-mirror` 在未指定策略文件时仍优先。以后新版本不必在客户端增加镜像列表／特殊版本判断。
- 小型官方 gzip 快照也由同一策略补入已配置的官网备用源（只处理 inventory／baselines，不处理私有带令牌 URL 或大文件对象）。最终候选已含旧站快照地址，必须先原字节部署对应快照并验证，再激活索引；避免只备份索引、下载时仍被单一快照域名卡住。

大文件下载器 `update-download.ts` 没有改动：15 秒观察、失败换源、小文件／快完成不误切、最终源不因慢速无限循环、成功哈希后记住镜像均保留。客户端文件差异／单文件回退和 MOD 相邻 ZIP 协议没有改变。

## 已执行的验证

```text
node --import tsx scripts/test-update-metadata.ts
node scripts/test-update-source-policy.mjs
node scripts/test-file-sync-node.mjs scripts/test-update-channel.ts --real-gate
node scripts/test-file-sync-node.mjs
node scripts/test-file-sync-node.mjs scripts/test-mod-zip.ts
node scripts/test-file-sync-node.mjs scripts/test-client-update-fallback.ts
node --import tsx scripts/test-update-download.ts --production-window
node --import tsx scripts/webpack.build production
```

均通过。元数据测试另外打成临时 ESM，在实际 Electron 33.1.0／Node 20.18.0 中通过。覆盖：无响应头、慢速滴流、正文中断、超大正文、DNS 前阶段卡住、重定向／不安全跳转、全流程预算、受控重试、旧文本门禁、关闭门禁、3.7／3.9.12／4.2 任意版本。独立测试 flag 失败后不会访问正式站点；检查不下载文件快照或资源。

生产下载策略回归实际切换耗时 15139 ms。客户端跨多版、旧 EXE 哈希不同／缺 zstd／损坏差分后的签名单文件回退、QMoff／玩家文件保留和更新失败回滚通过；未在真实玩家目录安装或操作游戏。

修改后直连官网复查（没有更改系统代理设置）：第一轮主站门禁约 10.1 秒成功，两个 API 索引在 15 秒完整截止超时；第二轮真实验签请求中，客户端 latest 首个地址成功，MOD 首个地址失败后普通备用路径成功。证明切换实际执行，也证明主站网络仍有波动，不能据某次成功承诺大陆所有网络稳定。

## 已准备、未部署的四份候选

最终目录：`_irys/releases/update-network-20261018-metadata/`。先前不含快照备用地址的 `update-network-20261018/` 只是本地中间候选，不用于部署。

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `client-manifests/3.5.0.json` | 77148 | `b419b283fca777c6dda0a91102d0ea1194a8a30cc94b73bca2b04ce8f4d166a6` |
| `client-manifests/3.5.1.json` | 62423 | `c1812f598b5853a484c2e39a93ce42a35b7ee676d151e271c29ae5d3aad4b615` |
| `client-manifests/latest.json` | 2781 | `78507b8e94d55e754c9adb4949d43806b9318f769fa52340cf831b7efe37bea3` |
| `mod-zip-manifest.json` | 2027 | `2c027ce6a1a107d97d1dc91cab71a97e5208e8e2888fc6ad12bc982cff32b2a3` |

先验证输入正式签名，再以现有私钥生成候选，并以客户端公钥及真实校验器复核。`verification.json` 记录四份通过；除传输源／镜像策略／签名外的所有字段逐项相同。旧桥接的原 GitHub、GitLawb 备用、文件哈希和目标版本不改；所有旧桥接文件均加入镜像 URL，但本次没有声称重新下载验收全部 112 个旧产物。上一轮实际大文件镜像下载证据见 `update-network-audit-20261018.md`。

通用重签命令（占位符需替换，不能直接部署示例）：

```text
node _irys/rewrite-update-sources.mjs --input ORIGINAL.json --output NEW-CANDIDATE.json
  --policy _irys/update-source-policy.json --public-key assets/quenching/update-public-key.pem
  --private-key EXISTING-PRIVATE-KEY-PATH
```

工具拒绝覆盖原件／已存在候选，不上传、不部署。公共仓库只跟踪纯策略算法和测试；整个 `_irys/` 继续忽略，私钥和私有发布配置不进入客户端。

## 官网维护者操作单（必须先获准）

1. 先保存线上所有将替换文件及门禁原字节，并重查其目标版本仍是本次审核的内容。若已有其他发布，停止，不用本候选覆盖较新的索引。不要编辑签名 JSON。
2. 先暂存而非激活上表候选；完成下一步独立备用站和 gzip 快照验证后，将原字节部署到主站两种路径：`/api/quenching/<文件相对路径>` 和 `/quenching/<文件相对路径>`。保持原 `latest`／MOD 目标版本及 gate 不变，不发布产品公告；旧 schema 1 继续放旧端点，不能被 schema 2 覆盖。
3. 在独立可访问的旧站上镜像同样路径／相同字节，给新版提供真正跨域备用。保留老 `/version.que` 的纯文本兼容入口也可以，但必须另部署 `/quenching/version.que`，内容与主站结构化 JSON 门禁一致。备用 gate 必须跟随每次门禁变化，绝不能永久固定 `allowed:1`。若不能同步门禁，不应启用该备用。
4. 两站还需提供清单引用的全部客户端官方 gzip 快照，含支持的历史版本。最终候选的 inventory／baselines.sources 已列出精确主／备地址，逐条 GET 验证大小和 SHA-256。为未来版本按合法文件名通用匹配路由，不只允许现有 3.6.0／3.6.1。现有签名快照 URL 不能随意删除；未来发布沿用策略为它们补入已验收的备用根地址，不能只镜像索引不镜像快照。
5. gate／JSON index 使用 `Cache-Control: no-store`，不要六小时缓存旧的公开开关。JSON 为 `application/json`；gzip 快照为 `application/gzip`，不能设置 `Content-Encoding:gzip`。缺失路径必须真实 404，不能返回社区首页 HTML。
6. 真正 GET 两站 API／普通地址，核对字节和上表 SHA-256；用正常验证的 HTTPS 测试，不关闭证书校验。验证 allowed=0／版本绑定的场景只能使用隔离测试地址，不为了测试关闭正式 gate。
7. 经批准替换清单后，旧客户端可立即利用新增的明确镜像 URL；新版请求超时、旧文本拒绝等源码修复需随下一客户端发布（如 3.7），不是服务器 JSON 能远程补进旧 EXE。

主站 `/quenching/version.que`、旧站该路径和跨域索引当前尚未确认部署；本轮实测旧站 `/quenching/version.que` 返回 404。上述操作尚未执行，不能写成线上已经稳定可用。

## R2 及仍需实机验收

本次没有可用的 R2 私有授权配置／新文件对象 Worker 协议。没有启用 R2、占用论坛媒体桶、上传资源或把私有桶改公开。后续仍需独立的更新对象空间、授权入口、按更新会话复用授权及限流，再测试 GitHub／镜像失败后的真实下载；不能用添加一条 URL 或历史旧补丁测速代替。

现在的改动不等于已发布新客户端，也不代表真实旧便携包升级／重启或大陆各运营商均验收。下一次 3.7 发布继续用既有的候选打包和用户实机流程，网络策略由官网签名清单控制；不要重新造逐版本客户端差分图。
