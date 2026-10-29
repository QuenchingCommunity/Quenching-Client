# 本地中间产物清理记录

按用户要求，将确认无用的缓存、测试解压副本与旧测试客户端展开目录放入 Windows 回收站。没有永久删除文件，没有清空回收站。

本次共 27 项，约 6.01 GiB。包括 Go 编译/模块缓存、Webpack/Babel 缓存、打包测试的 win-unpacked 副本、早期匹配 GUI 展开目录、旧浏览器控制台与驱动运行日志。

每个目标均核对绝对路径在本仓库内、没有 Git 跟踪文件，并检查祖先与子树没有需要跟随的 junction/符号链接。调用 Windows IFileOperation 显式回收；每项操作后确认源路径消失，且实际回收站中存在原路径匹配的 `$I` 元数据和对应 `$R` 对象。没有调用永久删除 API，也没有在失败时回退永久删除。

保留了源码、assets、Git 历史、依赖包本体、正式 ZIP/7z、当前构建与便携包、源码存档、已确认可用的 r8/r8.1 基线及 r9.2 客户端、资源备份与回滚记录。没有仅因目录叫 `_tmp` 就整体清除；近期资源迁移中的 previous/backup 等原始副本仍保留。某些旧测试客户端展开目录移走后，同名完整 ZIP 仍保留。

清单、原路径、大小和回收站记录名在 [核验结果](evidence/recycle-cleanup-20261028/results.json)，分类理由在 [清理清单](evidence/recycle-cleanup-20261028/plan.json)，统计在 [汇总](evidence/recycle-cleanup-20261028/summary.json)。

需要恢复时，打开 Windows 回收站，按本次删除时间或清单中的文件夹名称查找，右键“还原”。回收站仍占用磁盘空间，本次统计表示从项目目录移走的体积，并不表示磁盘空间已经释放。

回收 API 行为依据：[Microsoft IFileOperation::SetOperationFlags](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ifileoperation-setoperationflags)。实际回收结果以本次逐项元数据核验为准。
