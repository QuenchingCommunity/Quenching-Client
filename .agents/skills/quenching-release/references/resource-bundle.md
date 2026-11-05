# 统一资源源目录与按需 7z

用户 2026-10-28 最新要求：客户端资源原件统一展开在 `assets/unpacked`，生成五个大小接近、按素材种类固定分组的独立 7z；不能把 `unpacked` 本体或旧 ZIP／旧单一 `resources.7z` 带进客户端。五包不是分卷，不共用字典，可以分别解压；此要求替代之前的单包方案，但不允许用新版着色器重建旧 3.0 ABI。

固定映射在 `src/shared/bundled-resource-paths.mjs`：`resources-core.7z`（着色器／DNC／水面／皮肤／树木／基础资料）、`resources-ui.7z`（UI／tx／字体）、`resources-terrain.7z`（腐地／地形配置）、`resources-foliage-color.7z`（植被颜色／模型）、`resources-foliage-detail.7z`（植被法线／材质）。不能为了每次构建重新均分而自动迁移未改文件到其他包；这会导致不必要的更新。

- `camp/dnc/experimental/shaders/skin/tile/tx/water` 为展开目录。3.0 原字节数据在 `shaders/shaders-300-legacy-hd`、`shaders-300-legacy-de`、`fog_shaders-legacy`，共 57 个原文件。
- 原 UI、植被、环境、腐地和树木 ZIP 为 `packages/<ZIP 名去扩展名>/` 逻辑组，9 组各自隔离同名文件。UI 公共组先于 20／30 FDF 组叠加；UIQUE 版本仍为两个版本组各四处字段。
- 常规资源编辑直接改展开源。旧 ZIP 迁移工具只用于明确的一次性 intake；不能在每次构建时从过期 ZIP 覆盖新源。
- `scripts/prepare-client-assets.mjs` 是标准入口：先对齐版本文字，再按实际源内容生成／复用五个 7z 与清单。`electron/start/build/pack` 均调用它；所有 `dist:*` 经该构建入口，electron-builder beforePack 也调用。并发 dev 进程共用锁；旧 `prepare-shader-bundles.mjs` 仅转发，不再创建 shader ZIP。
- 7z 使用独立文件流，以便原生 7-Zip 只展开选择的文件。schema 3 清单记录总内容 ID、五包各自内容 ID／SHA-256／大小、逐文件归属包／SHA-256／大小、逻辑资源组。源不变时不重压，四个无变化包不改字节／mtime；源有变化时只更新对应包的变化成员。发布为可回滚事务，清单最后提交。
- `1.ico`、`logo.png`、更新公钥／基线及少量启动配置保留包外。缺少 logo 时从 `public/logo.png` 复制。字体从展开源参与 webpack，随 renderer 输出直接加载。更新助手、7-Zip 原生工具、全局 `assets/fonts/images` 不经过游戏资源缓存。
- 2026-10-29：`ui-misc.txt` 小型大气光模板也在包外，Win／Mac 分发策略必须保留；只补丁修改游戏 `[TerrainZFog]`，不替换已存在文件的其他内容，不更改 shaders。当前 PTR 与 3.0.1 的物理资源共用，`PTR_INDEPENDENT_SHADERS=false`；保留逻辑 PTR 包名、门禁和独立 Fog 能力。独立素材备份及恢复说明在 `_tmp/atmospheric-ptr-20261029/ptr-backup/RESTORE.md`，不进入 assets。
- 用户最新启动要求：先显示客户端，renderer 两帧后发送就绪握手，再准备展开缓存。没有任何展开文件时全量展开五包，使用现有全局进度弹窗；已有文件时后台静默检查／替换，不弹成功通知。其他自动资源消费者等待该准备任务，不能抢在首屏前解压。无窗口绘制的显式 headless 自动化在页面加载后启动任务。
- 正常运行使用轻量模式：不重复计算归档或整棵展开树的 SHA；解压器负责 CRC，发布时核对必要文件类型／大小。缓存记录逐文件内容摘要与 size／mtime／ctime；正常已有缓存只检查记录和文件元信息，只有无记录或外部改动的文件单独算摘要。严格摘要验证模式保留给构建／验收，不用于正常启动。
- 2026-11-02 用户要求：Windows 缓存位于 EXE 同级 `unpacked/`，资源子目录直接置于其下，不再使用用户数据目录或 `current`／内容 ID 子目录。启动与按需消费统一使用该位置；同卷暂存位于 EXE 同级 `_tmp/resource-unpack-*`。macOS 放在 `.app` 同级，避免写入签名包；开发环境优先直接读展开源，无源时使用仓库 `_tmp/runtime-resources/unpacked`。跨版本复用未变化文件，不能仅按同名判断。旧用户数据目录的缓存不再读取，不跨盘搬动或自动删除；新位置不存在时走正常首次解压。替换／移除已记录的旧缓存文件采用暂存备份事务，失败恢复；缓存不进入客户端官方文件快照，使用过的导出目录须重新构建后再制作便携包。schema 2 资源清单与旧缓存模式仍可读取。
- 自动更新健康确认在首屏与轻量元数据初始化后完成，不等待可能较慢的首次派生缓存解压，以免误触更新助手的启动超时；游戏渲染资源重应用则等待缓存准备完成。缓存准备失败记录日志并结束进度，不把已正常显示的客户端误记为启动崩溃。
- 不允许旧客户端遗留 ZIP 优先于新清单逻辑组。缓存缺失／变动会按需修复；严格模式发现压缩包摘要错误时拒绝使用，正常模式使用更新下载校验及原生 CRC，不静默回退旧源。
- Win 和 Mac 共用相同分发策略：只带五个命名资源 7z、清单和启动必需小资源；不带 `assets/unpacked`、备份、旧资源 ZIP 或旧 `resources.7z`。外层客户端便携包使用 7z；仍按 A／B／C 流程，资源拆分不等于上传或发布授权。

客户端现有 schema 2 逐文件自动更新按包文件哈希比较。第一次迁移需新客户端代码、schema 3 资源清单和五包一同交付；以后只拉变化的包与相应元数据。不改线上索引，不把本地 HTTP 回归等同于正式更新已经发布。

验证：`test:resource-startup`、`test:resource-startup-real`、`test:resource-bundle`、`test:resource-shards-real`、`test:resource-shard-update`。启动回归验证首屏先显示、首次进度、已有缓存静默、同名旧内容替换、无变化零内容哈希、失败回滚及旧缓存接管。五包拆分验收见 `wiki/resource-shards-20261028.md`，最新启动流程见 `wiki/resource-startup-20261028.md`。
