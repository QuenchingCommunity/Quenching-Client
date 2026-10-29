# UI 公共资源拆分

后续同日三组资源已展开到 `assets/unpacked/packages/zip-ui-{pub,20,30}`，随统一 `resources.7z` 按需提供；以下大小和原始 ZIP 备份记录是本次拆分时的验收证据，公共优先、版本 FDF 叠加的功能保持不变。

根据用户要求，将两份完整 UI ZIP 拆为一个公共资源包和两个 FDF 版本包。仅修改客户端 assets 和配套代码；未修改玩家目录或 Latest，未上传发布。

| 文件 | 内容 | 大小 |
| --- | --- | --- |
| `zip-ui-pub.zip` | 135 个公共非 FDF 文件：115 DDS、2 PNG、18 MDX | 20,634,320 字节 |
| `zip-ui-20.zip` | 38 个 FDF | 32,684 字节 |
| `zip-ui-30.zip` | 38 个 FDF | 35,901 字节 |

总大小从 41,319,405 降到 20,702,905 字节，减少 20,616,500 字节，约 49.9%。原两包只有 8 个 FDF 文件内容存在差异，其他 FDF 也保留在各版本包中；八处 UIQUE 版本字段、字体及父级 DecorateFileNames 均保留。公共包＋版本包组合后每个文件的路径和内容与拆分前完全一致。

## 接入

- `ui-service.ts` 的 UI 安装和经典反馈补丁统一先解压 pub，再叠加 `resolveUiZipName` 选择的 20／30 包；两包都存在才开始准备。先完成 staging，失败不清空已有 UI。
- 样式标记升级为 `zip-ui-pub.zip+<版本包>:<样式>:<发布标签>:layout-3`，旧记录刷新一次，重复同步仍跳过解压。
- `client-mod-files.ts` 将公共包的原路径和样式映射后的路径纳入清理所有权。
- `prepare-release-assets.mjs` 检查三包布局；只更新两个 FDF 包内的八处版本文字，不重压公共包。
- Win／Mac 现有 assets 整目录复制规则会携带新公共包，未新增独立上传或发布流程。
- 新增 `split-ui-archives.mjs`，可幂等拆分并验证组合等价；非 FDF 出现版本差异时拒绝。首次替换有定点备份及失败恢复。

## 验证

- `test-ui-split.mjs`：拆分结构、冲突拒绝、幂等性、真实两包逐文件组合等价通过。
- `test-release-assets.mjs`：版本更新、八处字段、字体校验、公共包不变及缺包／错误布局拒绝通过。
- `test-ui-default.ts`：20／30 三种样式、公共包先解压、版本 FDF 正确、Retail/PTR、经典反馈、所有权、旧标记迁移、缺失／损坏公共包保护及重复同步跳过通过。
- `prepare-release-assets.mjs --check`、改动格式检查通过。
- 用户随后明确要求暂不打包。本次 `npm run dist:win` 已在 webpack 编译阶段中止，并确认没有剩余 webpack／electron-builder 进程；本次生产构建未完成，未生成新客户端包。

拆分前后字节数和 SHA-256、原包定点备份位置见 `_tmp/ui-split-20261028/result.json`；比较清单见同目录 `comparison.json`。原包备份仍用于核对与回滚，不按普通构建缓存清理。
