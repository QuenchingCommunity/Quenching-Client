# 本地 3.7 TEST 标识核对（2026-10-25）

本次范围是本地工作版本，未访问、上传、签名或改动任何线上版本、门禁和更新清单。

根 `release-version.json` 为 `displayVersion: "3.7"`、`channel: "test"`，共同生成 `3.7 TEST`。`package.json.version` 保留真实数值版本 `3.7.0`，不把 TEST 放进客户端／MOD 版本比较字段。

`scripts/lib/release-label.mjs` 统一格式；`src/shared/local-release.ts` 供主进程、渲染进程及构建标题使用。转正式必须显式改 channel，重新生成、构建和验收。

覆盖的活动入口：

- 首页版本标签、悬停中的客户端身份、关于页、更新提示中的当前客户端文字：`v3.7 TEST`。
- BrowserWindow、HTML 页面标题、备用主进程启动日志：统一带 `v3.7 TEST`。
- 客户端 HTML 和 Latest WebUI：`Version 3.7 TEST By 天下正义`；图片保留无版本底图。
- 两个 UI ZIP 内八处 `QuenchingVersionText`：`V3.7 TEST`；UI 样式缓存键带 TEST，避免沿用普通 3.7 的旧 UI。
- `assets/quenching/local-release.json`、Latest 根 `local-release.json`：对外／内部版本、test 通道和文字明确记录；Windows 和 Mac 打包配置携带根 `release-version.json`，Mac 主应用显示名附 TEST。
- 实际测试游戏 `_retail_`：WebUI、现有两个 UIQUE 字段、`.quenching/local-release.json`；Latest 与此分支 `_patch/keep.que` 增加 `// Local build: 3.7 TEST` 注释。
- `dist` 由本次配置重新构建。

`installed-mod.json`、`keep.que` 中可解析的正式 MOD version／sequence 保留真实 3.6.2／38 基线；本地测试身份与正式更新基线分别记录。不会声称签名安装清单中的资源已完成一次正式 3.7 升级。旧版兼容代码、测试夹具、历史发布记录、Git 历史中的旧版本保留。

`__Bin/QMC3.6-Win` 是旧便携包，不是本次 3.7 候选，不改名冒充升级。本次重新生成的是当前源码、附加资源、Latest 测试文字和 dist；未导出新 EXE／ASAR／Mac 便携包。后续导出须按测试优先流程生成独立 TEST 候选并核对包内版本。

`channel: test` 是本地构建身份，不代替 `quenching-update-test.json` 的独立网络测试通道。此次未改网络入口、签名更新、正式资源清单、自动更新通道选择、用户配置空间或线上状态。

复核入口：

```powershell
node scripts/prepare-release-assets.mjs --check --sync-latest
node scripts/audit-local-release.mjs
node scripts/test-release-assets.mjs
node --import tsx scripts/test-ui-default.ts
node scripts/check-i18n.mjs
```

审计结果为 `logs/local-release-3.7-test-audit.json`。游戏文字部署前的原文件保存在 `logs/local-release-backup-*/`，只备份文字／标识文件。该审计不代表用户已完成游戏实机验收或测试自动更新验收。
