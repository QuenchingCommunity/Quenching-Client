# 淬火客户端资源盘点与统一 7z 流程

本次按 `assets/quenching` 原资源、当前源目录和实际客户端调用核对。源资源现在位于 `assets/unpacked`；原 ZIP 已展开为 `packages/<原 ZIP 名去扩展名>/`，版本与样式同名文件彼此隔离。动态读取的贴图／模型按资源组确认，不把“没有逐文件字面量引用”误判为不用。

统一包含 1022 个文件，展开源 969,488,353 字节，7z 98,272,243 字节。资源按固定素材种类分成五个独立 7z，不是分卷；每包使用独立文件流以支持只提取请求项；未变化构建验证源摘要后复用，源有变化时只重压变化文件并移除已删除成员。

| 独立资源包 | 压缩字节数 |
| --- | ---: |
| resources-core.7z | 18,609,183 |
| resources-ui.7z | 20,189,406 |
| resources-terrain.7z | 20,711,057 |
| resources-foliage-color.7z | 19,658,872 |
| resources-foliage-detail.7z | 19,103,725 |

| 资源组 | 文件数 | 展开字节数 |
| --- | ---: | ---: |
| EULA.docx | 1 | 73,092 |
| EULAEN.docx | 1 | 64,848 |
| Mac.txt | 1 | 77 |
| Readme.docx | 1 | 146,635 |
| TrajanPro3-Regular.otf | 1 | 181,288 |
| camp | 2 | 581,143 |
| dnc | 49 | 70,530 |
| experimental | 1 | 1,624 |
| packages/env-20-30-public | 6 | 10,348,694 |
| packages/lordaerontree | 6 | 16,778,208 |
| packages/zip-blight-que | 33 | 154,055,176 |
| packages/zip-blight-retro | 16 | 2,798,848 |
| packages/zip-foliage-other | 103 | 7,382,214 |
| packages/zip-foliage-que | 176 | 181,330,472 |
| packages/zip-ui-20 | 38 | 191,732 |
| packages/zip-ui-30 | 38 | 237,139 |
| packages/zip-ui-pub | 135 | 78,863,170 |
| reg.reg | 1 | 330 |
| shaders | 179 | 474,616,827 |
| skin | 13 | 6,776,634 |
| tile | 13 | 413,812 |
| tx | 3 | 3,874,340 |
| water | 205 | 30,701,520 |

## 启动必须直接可读的内容

`1.ico`（Windows 窗口／托盘／打包图标）、`logo.png`（Mac/Linux）、更新公钥、历史基线及少量基础配置／WebUI 文本保留在 `assets/quenching`。缺少 logo 时统一准备入口从 `public/logo.png` 补齐。字体是 webpack 构建输入，编译输出随 renderer 分发，不等待游戏资源解压。`assets/fonts`、`assets/images`、更新助手和原生 7-Zip 工具继续直接分发，不属于待展开的游戏资源。

## 未发现当前运行时读取的候选

以下保留在展开源及五包中，没有删除；首次完整展开也会包含这些文件，但未发现当前功能读取。随附文档／旧 .NET 文件与已废弃效果模板分开列出；需要精简时可按此清单单独审阅。

| 文件 | 展开字节数 | 依据／用途判断 |
| --- | ---: | --- |
| EULA.docx | 73,092 | 旧文件／随附文档，保留供回退，无当前功能调用 |
| EULAEN.docx | 64,848 | 旧文件／随附文档，保留供回退，无当前功能调用 |
| Mac.txt | 77 | 旧文件／随附文档，保留供回退，无当前功能调用 |
| Readme.docx | 146,635 | 旧文件／随附文档，保留供回退，无当前功能调用 |
| reg.reg | 330 | 旧文件／随附文档，保留供回退，无当前功能调用 |

`dnc30-de-rpg` 和 `zip-blight-retro` 属于兼容清理资料：当前视觉选择器不启用，但仍用于识别客户端已知路径，因此未直接删除。`.vs` 等开发目录不进入资源包。

## 命令与运行期

`yarn run electron`、`start`、`build`、`pack` 共享 `scripts/prepare-client-assets.mjs`；所有 `dist:*` 经公共构建入口，直接 electron-builder 也有 beforePack 检查。并发 dev 命令共用跨进程锁；中断后可恢复过期锁。旧 `prepare-shader-bundles.mjs` 仅转发统一入口，不再生成独立 shader ZIP。

先显示窗口，首屏绘制后再准备资源。没有展开文件时完整展开并显示现有全局进度弹窗；已有文件时后台静默检查，按内容替换不同文件。缓存位于当前用户数据目录的 `resources/unpacked/current/`，跨版本复用未变化文件，与客户端安装文件及自动更新官方快照分离；暂存后提交，失败恢复旧缓存。正常启动不重复读取整包和整棵缓存树计算 SHA；只检查内容记录及文件元信息，未知或外部改动文件才单独算摘要。旧客户端遗留 ZIP 不覆盖新清单中的资源组。

Windows 和 Mac 分发规则均排除整个 `assets/unpacked`、原始资源目录和独立旧 ZIP，只带五个 `resources-*.7z`、清单及启动必需小文件。本次没有生成客户端便携包、上传或发布。

完整逐文件盘点见 [CSV](evidence/quenching-resource-files-20261028.csv)，内容 ID／大小／SHA-256 见 [元数据](evidence/resource-bundle-20261028.json)。原资源迁移及旧版备份记录在 `_tmp/resource-bundle-20261028/relocated.json`。
