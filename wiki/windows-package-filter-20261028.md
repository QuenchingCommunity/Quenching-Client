# Windows 打包误包含临时文件

本次仅修复本地打包规则，未发布或上传客户端。

## 原因

`win.files` 为筛选 7-Zip 平台二进制而加入了仅含排除项的列表。electron-builder 25.1.8 将根级 `files` 归一化为 FileSet，但 Windows 字符串规则另外生成默认匹配器；仅有排除项时，该匹配器自动加入 `**/*`。因此根级运行时白名单被绕过，打包器会遍历 `_tmp` 等开发目录。报错中的临时抓包 XML 在读取时不存在，触发 ENOENT。

## 修复

- `electron-builder.yml`：在 `win.files` 保留 `package.json` 正向规则，阻止自动补入 `**/*`；原有平台二进制排除规则保持有效。
- `scripts/test-win-package-files.mjs`：调用打包器实际的配置归一化和文件匹配逻辑，验证运行时白名单、临时／源码／私有目录排除、原生依赖保留，以及旧规则确实能复现问题。
- `package.json`：新增 `test:win-package-files` 命令。
- 发布技能准备清单：记录此规则及成品 ASAR 检查要求。

`postinstall` 建议与本次失败无关。`npmRebuild: false` 继续保留；本项目 StormLib 使用已有 N-API 二进制，不能直接覆盖原有 patch-package 安装脚本。

## 本次验证

- `npm run test:win-package-files`：通过。
- `npm run build`：生产构建通过，显示 `complete`，无 fatal；资源包内容未变化。
- `electron-builder --win --x64 --dir --publish never`（输出重定向到本次 `_tmp` 子目录）：退出码 0。
- 成品 ASAR 共 341 项，根级仅有 `dist`、`node_modules`、`package.json`、`release-version.json`，不含临时目录、源码和私有工具；statics／assets 正常外置。
- 由成品 Electron 33.1.0 加载成品 ASAR 内 StormLib／CascLib，并执行 unpacked 7-Zip，全部通过。
- 验证 ASAR 大小 80,348,206 字节，SHA-256：`b1d84cce8cb001af0695c535b86cdf5904d2eb2799e677493ac3eaec481535dc`。

日志和小型验证报告保留在 `_tmp/win-package-filter-20261028/`。本次为构建故障验证，无正式发行或游戏内人工验收。
