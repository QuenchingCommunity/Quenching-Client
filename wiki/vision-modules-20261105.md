# Vision Mod 四模块（2026-11-05）

修改前快照提交：`68b0182`，包含当时客户端源码、四张 foliage 修改、资源便携缓存路径、签名流程及其他同事已完成的涂装调整。未推送。

## 原行为核查

通用第三方资源槽依据目录和文件路径判断冲突，不解析单位／树木 TXT 引用。`units` 冲突时会整目录停放，连带移走 unitskin、destructableskin 等表；不能保证混搭。旧 Vision Mod 的两个开关只枚举模型和 DDS，安装覆盖文件，关闭直接删除，且两开关共用贴图集合。这次替换 Vision 面板的开关，不改变通用资源槽为另一套智能合并引擎；通用槽与新 Vision 模块互斥。

只读检查 `D:/BaiduNetdiskDownload/Vision Mod v3.0.zip` 的目录清单。实际路径是 `terrainart`、`environment/foliage` 等，不是字面 `terrain`／`env`；实现同时兼容这些别名。压缩包原件未修改，未向真实游戏目录部署。

## 范围

| 模块 | 文件处理 | 淬火设置影响 |
| --- | --- | --- |
| 单位增强 | units、buildings 模型和贴图按文件叠加；跳过两目录全部 TXT，不导入 COS | 保留单位表与涂装；启用期间更换涂装后，关闭模块仍保留新表和 COS |
| 装饰物变化 | 完整替换 doodads、replaceabletextures；单独停放 units/destructableskin.txt | 停用树木和腐地设置；关闭恢复原目录及树木表 |
| 地形变化 | 完整替换 terrainart/terrain 和 environment/foliage、env/foliage | 停用地形、植被、水面和腐地设置 |
| 杂项变化 | 其他已识别游戏资源根目录；environment 只替换独立子目录 | 按实际文件禁用 UI 或着色器相关设置；不含着色器就不禁用着色器／光照 |

所有模块都排除 environment/dnc、env/dnc。杂项 UI 启用时也禁用依赖 UI/MiscData.txt 的大气光。配置／画质整套切换可能重建多类目录，模块开启时需先关闭对应 Vision 模块；MOD 总开关同样先关闭 Vision 模块。Retail/PTR 切换继承现有整体移动策略，额外携带模块状态、备份和第三方新增根目录。

## 实现与恢复

- 共享策略：`src/shared/vision-modules.ts`，前端按钮与保存检查共用，后端服务也检查地形／植被／树木／水面／UI／着色器／腐地入口。
- 文件服务：`src/Main/services/vision-modules.ts`；按模块保存 `.quenching-vision-modules.json`，原文件独立备份到当前分支 `.quenching-vision-backups/vision-*`。
- 源先暂存到当前分支 `_tmp/vision-*`，再改活动目录；切换串行，失败按相反顺序恢复。状态最后提交；恢复不完整时保留暂存以供排查。拒绝链接、路径越界和把游戏分支当导入源。
- 启用期间暂停自动整套资源重应用，避免启动时覆盖第三方目录；手动未冲突项目仍能修改。关闭每一项立即恢复其原文件；原源目录缺失时仍可关闭。更换 Vision 来源前需先关闭模块。
- 四个开关位于第三方支持的 Vision Mod 页；旧半身头像／模型增强 IPC 保留兼容，但新面板不再使用。

## 验证与交付

`test:vision-modules` 验证 16 种组合、TXT／COS／DNC 保留、使用中更换涂装后关闭仍保留、完整目录替换、模块独立恢复、冲突门禁、失败写入回滚、与通用槽互斥和事务清理。使用临时游戏目录，未运行真实游戏。另运行启动资源调度回归、多语言键与占位符校验、production webpack 编译；日志位于 `_tmp/vision-modules-20261105/`。

本次为源码实现与本地编译，未重新制作便携包、未发布，也未宣称游戏内画面已逐项人工验收。
