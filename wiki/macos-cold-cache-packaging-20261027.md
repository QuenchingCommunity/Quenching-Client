# macOS 冷缓存打包及交付 ZIP 启动验证（2026-10-27）

用户指出公开源码仍调用 Windows 的 curl.exe。本次核对公开 main（f18bd2c8fcd8a5bd7ca7fc30054f418f52fe28e9）后确认问题存在。已有 StormLib／CascLib 原生构建、架构检查和 ad-hoc 签名不等于已发布的 3.6.1 Mac ZIP 得到修复。

本次是 Mac 打包链路修复和 CI 候选验证，不合并本地尚未提交的 3.7 界面／资源改动，不替换 Release 或更新清单。

## 改动

- `scripts/lib/electron-download.mjs`：macOS／Unix 使用 curl，Windows 使用 curl.exe；HTTP 失败、命令缺失及超时有明确错误。下载先写唯一临时文件，确认 Electron ZIP 结构及必要文件存在后才原子提交缓存。错误页和截断包不因大于 1 MiB 被当作有效缓存。优先官方 Electron Release，其次保留现有两个镜像。
- `scripts/package-mac-app.mjs`：复用异步下载器，原生模块检查、架构隔离、ASAR、ditto 和 ad-hoc 签名逻辑保留。
- `scripts/test-electron-download.mjs`：Unix／Windows 命令选择、真实本机 HTTP 404／备用源下载／缓存复用、错误页、截断 ZIP、超时、缺少命令及临时文件清理。
- `.github/workflows/build-mac.yml`：可选 arm64／x64／all；先断言 runner 架构。全新 `QUENCHING_ELECTRON_CACHE` 强制覆盖没有 Electron 缓存的下载路径。现有 node-gyp 仍依赖 distutils，原生编译显式使用 Python 3.11，不改 Electron 版本。
- `scripts/smoke-mac-archive.mjs`：实际解压生成的 ZIP，检查可执行权限、framework 符号链接、Mach-O 架构和签名；使用解压包的 Electron 加载 ASAR 中的 StormLib／CascLib，再启动真实客户端页面，验证 DOM、preload 和 IPC，保存截图、日志、报告与 ZIP SHA-256。使用隔离配置／userData，不选择玩家游戏目录。
- 发布技能的 `preparation.md` 和 `contracts-and-code.md`：补充冷缓存、Python 3.11、ZIP 重解压及真实启动要求，纠正仍称可在 Windows 制作可用 Mac 包的旧工具表述。

## GitHub 记录

- PR：https://github.com/QuenchingCommunity/Quenching-Client/pull/9
- 分支：codex/macos-cold-download-20261027；独立于当前本地脏工作区，最初只提交五份 Mac 修复／验证文件。
- 第一轮：https://github.com/QuenchingCommunity/Quenching-Client/actions/runs/40488660178 ，实际 ARM64 runner 上下载器回归通过；原生构建因 Python 缺少 distutils 失败。
- 第二轮：https://github.com/QuenchingCommunity/Quenching-Client/actions/runs/40489220990 ，增加 Python 3.11 后，冷缓存实际下载、ARM64 原生构建、生产编译、ASAR、ad-hoc 签名和约 413.2 MiB ZIP 生成通过；重解压后签名、framework 符号链接、权限及 ASAR 原生加载也通过。启动探针在 DOM 建立前读取 body，导致探针误报，已修正等待逻辑。
- 第三轮：https://github.com/QuenchingCommunity/Quenching-Client/actions/runs/40490174607 ，提交 c43fc5b5b6ece2c24e06f1d3d48fca0a0a6ef661，整个 ARM64 macOS 工作流在 4 分 35 秒完成并全部通过。冷缓存下载、原生构建、签名、ZIP 重解压、真实页面、preload／IPC 均通过；已查看实际启动截图，正常渲染客户端主页，没有 React 错误页，IPC 读回 retail。Electron 为源版本 33.1.0，未升级。
- GitHub 插件读取成功，写入 Git tree 返回 403 Resource not accessible by integration；使用用户当前已登录的 gh 完成独立分支／PR及 Actions 触发，没有向 main 直接推送。

## 本地验证

- `node scripts/test-electron-download.mjs`：通过，包含真实 curl 与本机独立 HTTP 服务。
- `node scripts/test-mac-native-packaging.mjs`：通过，包括 Windows 不可冒充可用 Mac 候选、错误二进制架构及加载器优先级检查。
- 新下载器、打包器、ZIP 启动脚本 `node --check`：通过；改动文件 git diff --check：通过。
- Windows 本地测试不算 Mac 实机验收；Mac 结果以本次 runner、提交 SHA 和交付 ZIP 的实际验证为准。

新中间文件、请求体和失败日志位于 `_tmp/mac-download-20261027/`。签名方式仍为 ad-hoc；GitHub 候选 artifact 不代表已发布的 Mac ZIP 被替换，也不代表普通用户下载后的 Gatekeeper 或交互体验已通过。

## 已验证候选

| 内容 | 记录 |
| --- | --- |
| 文件 | QMClient-darwin-arm64.zip（GitHub artifact 中的内层交付 ZIP） |
| 大小 | 433297029 字节 |
| SHA-256 | f213aec397ab06391dd357500458fbb4695f17983e5301d2e49a519120e7517e |
| 源提交 | c43fc5b5b6ece2c24e06f1d3d48fca0a0a6ef661 |
| 源内部版本 | 公开 main 的 3.6.1；这是本次 CI 修复候选，不复用该内部版本发布自动更新 |
| ARM64 候选 artifact | https://github.com/QuenchingCommunity/Quenching-Client/actions/runs/40490174607/artifacts/12727642181 |
| 启动截图与报告 | https://github.com/QuenchingCommunity/Quenching-Client/actions/runs/40490174607/artifacts/12728481903 |

本地证据保存在 `_tmp/mac-download-20261027/run-40490174607-evidence/mac-roundtrip-arm64-ThkZaU/`，包含 startup-report.json、startup.png 和 startup.log。没有下载或重复常驻完整 Mac 候选包；交付 ZIP 保存在 GitHub Actions artifact，当前保留 14 天。

## 合并及本地同步

用户明确确认后，PR #9 已合并为 `722b8a4bbbe5662eca44f56f1939005b839aa65e`。本地 main 已从 d460fe8 快进至同一提交，与 origin/main 一致。同步前对五个重叠文件单独备份及三方预合并；本地 package-mac-app.mjs 的额外版本／归档改动完整保留，恢复后的文件与同步前逐字节相同，其余工作区改动状态不变，没有创建全工作区 stash 或丢弃未提交改动。同步记录与备份在 `_tmp/pr9-pull-20261027/`。本次仍未替换任何已发布的 Mac ZIP 或部署更新清单。
