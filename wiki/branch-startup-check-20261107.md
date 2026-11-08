# 启动资源检查误报（2026-11-07）

用户反馈前两天的 TEST 客户端在选择正确魔兽目录后，启动仍弹出“魔兽目录需要人工检查”。该提示来自 `channel-recovery-init.ts` 的统一异常处理，并非目录格式校验；仅凭截图无法确认对方机器上的具体异常。

已复现一种代码问题：已有 `phase: disabled` 的 MOD 开关记录（或旧配置中 MOD 关闭且无记录），同时启用了 Vision 模块。启动的关闭状态修复再次调用 MOD 总开关，命中“请先关闭 Vision Mod 模块”的正常保护，却被统一错误提示误报成未能恢复的事务，并退出。

按用户明确的规则，关闭淬火 MOD 时先关闭该分支的 Vision 模块及旧第三方资源槽，恢复被替换／停放的原文件，然后由淬火文件清单将受管资源移入 QMoff。启动发现淬火配置关闭或已有完成的关闭记录时，同样执行实际文件修正；不能只跳过保护、保留混合状态。淬火开启且第三方启用的正常组合继续保留。

Vision 与旧资源槽恢复都使用明确的游戏分支路径，不修改当前选中的 Retail／PTR 配置。重新开启淬火不自动开启第三方。淬火关闭期间，Vision 和旧资源槽都不能重新启用。

非法记录、旧版搬运记录和待检查的分支复制记录仍阻止继续操作，不自动删除记录或猜测文件归属。第三方原文件备份缺失、恢复失败时不执行后续淬火停用；已成功撤下的模块保持关闭，失败模块及必要备份保留，下次可从剩余状态继续处理。旧资源槽关闭使用可回滚的文件移动及原子状态提交，玩家修改及残留文件单独备份到游戏根目录 `.quenching/player-file-backups/third-party-*`。不扫描或清理玩家独立目录。

异常提示改为“魔兽资源状态检查未通过”，显示检查步骤、记录位置和原始原因；日志也记录这些信息。还需取得受影响用户日志才能确定是否为上述复现情况。

同次将对战模式的默认 HDR Exposure 从 1.8 调整为 1.6；已有有效自定义亮度保留。RPG 仍为 0.9，标准仍为 1.2。

验证通过：

- `node --import tsx scripts/test-branch-startup-recovery.ts`：验证先撤第三方再停淬火、无记录／完成关闭记录的启动修正、正常启用状态保留、非选中 PTR、缺失备份／损坏记录保护、旧资源槽及玩家独立目录保留。
- `node --import tsx scripts/test-vision-modules.ts`：16 种模块组合及独立恢复回归通过。
- `node --import tsx scripts/test-third-party-resources.ts`：旧资源槽导入、关闭、玩家修改备份及状态提交失败的文件回滚通过。
- `node --import tsx scripts/test-channel-recovery-init.ts`：两分支状态同步；旧搬运、复制和开关检查错误均显示步骤、路径与原因，失败仍退出。
- `node --import tsx scripts/test-hdr-exposure.ts`：对战默认 1.6，已有自定义 1.8 保留，配置写入回归通过。
- `node --import tsx scripts/test-graphics-settings-transition.ts`：实际设置保存流程中切换模式使用新的默认值，现有设置切换回归通过。
- `node --import tsx scripts/webpack.build production`：编译通过，57.37 秒。
- `node scripts/check-production-build.mjs`：正式 3.7.0 检查通过，TEST 选择和离线测试 UI／IPC 均已移除。

任务日志位于 `_tmp/branch-startup-recovery-20261107/`。未重新打包、部署或发布；未声称已确认或修复受影响用户机器上的具体故障。
