# 测试优先的发布流程（2026-10-24）

2026-11-05 用户更新：每次发版后，本地保留一份未启动的纯净 TEST 便携归档，附真实内部版本、测试基址、大小及 SHA-256。每次测试从归档生成独立运行副本，更新后的目录不作基线。归档不得含配置、浏览器缓存、展开缓存或事务数据；保留测试标记。此要求优先于下文旧客户端不常驻的默认规则，只保留单份压缩基线，不叠加各版本展开树。测试通道过期或目标变化只调整本次运行副本的标记并记录，不修改基线归档或旧二进制。

2026-11-08 用户更新：客户端外层便携包统一 ZIP，替代此前 Windows .7z／Mac .tar.7z。Windows 导出为 `scripts/export-win-portable.mjs`，`_irys/export-win-test.mjs` 仅兼容转发；使用 `yarn run export:win <目录> <输出.zip> <根目录名> --test-base <独立候选地址>`。Mac 使用原生 ditto ZIP，并验证解压后的签名、权限、链接及真实启动。内部五个资源 7z 和历史 TEST 7z 基线保持兼容；测试隔离与两次人工验收顺序不变。

本流程来自用户本次决定，替代先构建正式包／正式更新再交付测试、每版常驻保留完整旧版的做法。修改发布流程本身不代表开始打包、提交 Git、上传或部署。

## 1. 资源位置与历史

| 内容 | 唯一工作源 | 打包后的对应位置 |
| --- | --- | --- |
| 客户端源码、版本及构建配置 | `D:/Quenching/QM/MOD/QuenChing-Electron-Client` | 编译到 `dist`，应用代码进入 `resources/app.asar` |
| 客户端全部附加资源 | 同仓库 `assets/`；`assets/quenching/` 含着色器、皮肤表、DNC、地形／水面、UI／环境 ZIP 等 | `resources/assets/`，保持构建配置中的过滤规则 |
| 客户端更新助手及工具 | `assets/updater/` | `resources/assets/updater/` |
| 构建生成的静态文件 | `dist/statics/`，由源码和构建配置生成 | `resources/statics/` |
| 完整版／MOD 全部资源 | `D:/Quenching/QM/Latest`，独立 Quenching-Assets Git 工作区 | MOD 版本 ZIP、按需制作的首装 A／B ZIP |
| 测试与正式的版本／源策略 | 各自官网签名索引，测试位于独立 `update-test` 目录 | 下载对象可按哈希复用，但测试选择入口和正式发布入口分开 |

客户端 `assets/` 与 Latest 分别属于两个 Git 仓库。只在本次需要的角色中读取它们；需要对齐资源时作为明确的资源编辑处理，不在打包时拿客户端 assets 临时覆盖 Latest。Latest 中的 `_manual` 已按用户要求移除；`.git`、维护说明和日志不进入完整包。

**历史以 Git commit/tag 为主，不另建每版完整旧树。** 发布记录保存客户端与 Latest 的准确 commit、版本／sequence、资源清单、产物大小／SHA-256 和可重新下载的 URL。上一版变更可用 `git -C D:/Quenching/QM/Latest diff --name-status <前版提交> <目标提交>` 查看；需要旧文件时按 commit 只读提取相关 blob，不 checkout/reset 当前工作区，不额外创建整套旧树。PowerShell 文本重定向不能用来保存二进制 `git show` 输出；使用保持字节的读取／写入工具，并核对 SHA-256。

每个发布版本要能对应到完整资源提交。未提交内容记录在本次候选输入中，在进入正式发布前建立准确的 Git 版本映射；不能把当前 HEAD 自动当成上一正式版。2026-10-24 本地审计：Latest 的 HEAD 是 `34d7336`（2026-10-04 的 QMF3.5 导入），本地已有后续未提交变更；现有 tag 为 `3.3`、`3.5`、`latest`、`updater-transport-2026-09-26`。所以目前不能声称 Git 已完整记录正式 3.6／3.6.1；这项缺口需要建立可验证映射，而不是继续要求永久保留完整旧包。该审计是历史记录，后续发布重新核对。

Git 源码重编译不保证得到相同的旧 EXE／ASAR。需要验证旧客户端或生成可选二进制差分时，从原 Release 按需取得旧包或所需单文件，校验已记录哈希，测试后释放临时副本；没有旧二进制时可以不制作可选差分，保留目标整文件回退。保留小型签名索引、官方快照和发布历史；远程可取回的大对象是可回收缓存，不默认每版常驻保留 ZIP、解压目录、`mod-root` 或全量冻结副本。不要整删含历史账本与小快照的 store。

## 2. 三阶段顺序与两次人工验收

| 阶段 | 可以制作／验证 | 必须交给用户的结果 | 进入下一阶段的条件 |
| --- | --- | --- | --- |
| A：本地测试包 | 当前源码＋客户端 assets 的真实便携包，第一次导出就带测试标记；MOD 有变化时提供本地测试资源输入／必要的安装包 | 可直接双击 EXE 的 TEST 包、准确版本／哈希、测试游戏目录说明、测试接口基址、已知问题 | 用户明确确认该本地包人工验收通过 |
| B：测试自动更新 | 在 A 通过后，才构建／签名／部署本次测试更新目标和测试索引；只在独立测试链路验证下载、应用、退出、重启及资源设置 | 用 A 的已验收测试安装触发更新的方法、源／目标真实版本、独立测试接口、自动检查结果 | 用户再次明确确认测试自动更新通过 |
| C：正式包与验证 | A、B 两次通过后，才导出正式 Win／Mac 大包、需要的 MOD A／B，准备正式更新清单及正式通道验证 | 无测试标记的正式候选、哈希、验证报告、官网交接与回退元数据 | 正式上传／部署／门禁按本次发布授权执行 |

阶段 A 完成就停在交付测试包；没有第一次人工通过，不提前制作本次测试自动更新。阶段 B 完成就交付更新测试；没有第二次人工通过，不提前制作正式大包。自动化 PASS、已上传、没有收到问题、用户说准备发布，都不能代替这两次针对具体候选的人工验收。记录对应用户消息、候选版本及哈希；更换本次验收所覆盖的内容后，重新做受影响阶段，不能沿用旧候选的通过结论。

A 的客户端版本 I0 必须如实写入应用。B 的目标 I1 必须高于 I0，例如 `3.7.0 → 3.7.1`（仅举例）；公开文案仍可统一为 3.7，C 使用 B 已验收的最终 I1。不能把同版当更新、伪造已安装版本、临时降版、复用已升级完的目录来制造成功。MOD 同样需要真实递增 sequence；只有 MOD 变化才增加 MOD 版本，只有客户端变化不生成空资源补丁。没有本次资源更新时，测试 MOD 状态只能来自测试目录的小型签名索引／占位方案，不能转向正式索引兜底。

三个阶段尽量复用冻结构建及内容寻址对象，不为“测试”与“正式”无理由重复保存整套资源树。C 在未启动过的打包输出中移除专用标记后导出，或者使用明确过滤标记的正式导出路径；不要修改用户已验收的测试安装。代码、版本或资产字节变化就重新生成相应快照／签名并重测，不能只移除标记就声称正式已通过。

## 3. 测试标记的真实含义

Windows 测试包在 `QMClient.exe` 同级携带：

```json
{
  "schema": 1,
  "enabled": true,
  "baseUrl": "https://qm.txzy.net/quenching/update-test/本次候选/"
}
```

文件名为 `quenching-update-test.json`，位于 ASAR 外，首次双击、更新替换 ASAR 和再次双击后都保留。`src/main.ts` 首先加载 `src/Main/services/update-test-init.ts`，由标记启用 `QUENCHING_UPDATE_TEST=1` 及指定基址，默认将配置放到 EXE 同级 `.test-config`，Chromium userData／sessionData 放到 `.test-user-data`。测试标记不改 appId、不改真实版本，不是隐藏窗口、开发模式或只读模式。只有 `QUENCHING_AUTOMATED_TEST_HEADLESS=1` 用于自动化隐藏窗口。

测试入口均相对于该 base：

- `version.que`；
- `client-manifests/latest.json`；
- `mod-zip-manifest.json`，兼容时再试同一测试 base 的 `mod-sync-manifest.json`。

测试服务保持签名和下载哈希校验；缺失、HTML 响应、签名错误或下载失败不转正式元数据。`QUENCHING_PREVIEW_UPDATES=1` 只是预览开关，不等于这条独立测试链路；仅文件名写 TEST、开发启动或临时终端环境也不能代替首次测试包中的持久标记。标记没有隔离游戏资源目录，确认操作仍会写所选游戏；自动化只用隔离测试目录，不替用户确认更新或关闭其正在人工测试的窗口。

运行时显式 `QUENCHING_UPDATE_TEST=0` 可以覆盖标记，因此交付测试包须在无预设环境下验证直接双击仍进入测试链路。正式候选必须没有标记／测试配置／测试缓存／测试启动脚本，并清除测试、预览和 URL 覆盖变量；Windows 之外的包要核对真实启动路径与签名要求，不能照搬 EXE 同级路径。macOS 仍手动替换，不承诺 Windows 自动更新。

## 4. 工具与本次发布记录

每次版本变化在 A、B、C 均核对 `version-assets.md` 中的对外 JSON、客户端显示、UIQUE 八处字段和 WebUI HTML，并核对版本字体及父级 `DecorateFileNames`。人工验收须在游戏内看到 UI-que 命令面板版本：测试为 `V3.7 TEST`，正式为对应正式版本而不带 TEST。不能仅以 ZIP 中存在文字代替显示验收。构建会自动生成文字及必要的字体解析设置；两张 PNG 为无版本底图，后续不随升版重画。内部版本／MOD sequence 仍按各自协议处理。

`_irys/export-win-test.mjs` 保留历史文件名，导出默认 `--channel test`，必须显式提供 `--test-base`；它在输出 ZIP 之前写入并校验标记，ZIP 内也必须有该文件。`--channel production` 只在阶段 C 使用，拒绝带标记或已运行测试状态的输入；不会替用户关闭测试标记。

```powershell
# A：构建后的首次便携导出，只有本地测试包。
node _irys/export-win-test.mjs __Bin/client-CANDIDATE/win-unpacked __Bin/QMC-CANDIDATE-TEST-Win.zip QMC-CANDIDATE-TEST-Win --channel test --test-base https://qm.txzy.net/quenching/update-test/CANDIDATE/
# C：两次人工通过后，对无测试标记的正式构建输出显式导出。
node _irys/export-win-test.mjs __Bin/client-FINAL/win-unpacked __Bin/QMC-FINAL-Win.zip QMC-FINAL-Win --channel production
```

测试标记、测试配置和缓存不能进入客户端官方文件快照或差分对象；否则升级可能覆盖测试选择或发布测试者设置。`_irys/build-file-sync.mjs` 对这些根级路径显式排除；测试／正式 store 与索引目录分开，不能把测试版本记录混入正式发布历史。

私有发布记录只需保留：本次阶段、客户端／assets／Latest 的 Git commit 和待提交变更摘要、I0／I1 与 MOD version／sequence、包及索引的大小／SHA-256／URL、A 人工验收消息、B 人工更新验收消息、C 正式验证及授权。仍区分本地生成、上传、测试部署、正式部署、人工验收；未经用户实际确认不得自行填写“通过”。

相关检查：`node scripts/test-portable-release-channel.mjs`、`node --import tsx scripts/test-portable-update-test.ts`、`npm run test:update-channel`。它们验证导出标记、配置隔离、重启保留和测试失败不走正式，不能代替两次人工验收。
