# HDR 与整体亮度（2026-11-06）

用户要求将 HDR 从画面页移至设置的光照页，并新增整体亮度。源码保留原有 1–5 档光照模型强度，界面改称“光照强度”，与新的全画面整体亮度区分。

- HDR 开关沿用独立 tonemap 控制：开启恢复对应 tonemap 着色器且 `[Tonemap] Enabled=1`，关闭移除该覆盖着色器且写 `Enabled=0`。
- HDR 开启才显示整体亮度滑杆，内部范围 0.75–2.4、步进 0.01，界面端点为“最小”“最大”，提示按相对百分比显示，不暴露配置字段名。
- RPG 默认 0.9，标准默认 1.2，对战默认 1.8。切换光照类型时恢复对应默认值；随后手动调整会保存，重启、切换 HDR、修改其他光照强度均保留。HDR 关闭时切换类型也会保存该模式默认亮度，保持关闭状态。
- 启动和整套资源同步通过同一规则写入 Exposure；标准／对战预设包含对应 Exposure。旧配置无新字段时按保存的光照类型迁移，不从默认标准值错误覆盖 RPG。
- `shader:update-hdr-exposure` 仅复制缺失的默认 PostProcessingConfig（如有必要）并原子更新 Tonemap 两个字段，不重同步 DNC、着色器、地形、植被或 UI。配置操作共享文件队列，保留 AO、辉光、自定义字段、BOM 和换行；非法或超范围输入拒绝。
- MOD 关闭时只保存偏好，Retail/PTR 分别写入所选分支。旧 3.0 ABI 不提供此功能，经典画质及 Vision 接管的相关设置沿用门禁。

主要代码：`src/shared/hdr-exposure.ts`、`post-processing-config.ts`、`asset-sync.ts`、shader/mdl IPC、preload/API 类型、`useWar3Settings.ts` 和 `SettingsModal.tsx`。八语界面同步新增键，默认 PostProcessingConfig Exposure 调整为标准值 1.2；未更改同事的 shaders。

验证：

- `scripts/test-hdr-exposure.ts`：模式默认、自定义值保留、范围端点、非法值、Tonemap 开关、分支隔离、AO/Bloom/自定义字段/BOM/CRLF 保留、并发更新、幂等、重复键及写失败恢复。
- `scripts/test-hdr-exposure-ipc.ts`：真实新 IPC 在临时游戏目录的读写，验证不改着色器、保存偏好、HDR 关闭及 MOD 关闭行为、Retail/PTR 隔离。
- `scripts/test-graphics-settings-transition.ts`：真实设置 hook 和 SettingsModal 静态渲染，验证旧页无 HDR、光照页唯一开关、HDR-off 隐藏滑杆、范围、模式默认、只触发 Exposure IPC、失败设置回退，以及原有模式转换回归。
- `scripts/test-post-processing-config.ts` 原配置回归、多语言校验、production webpack 编译。

结果：上述功能／配置／IPC／设置界面回归及 production 编译通过（23.98 秒）。八语新增亮度键齐全，重复键和占位符检查通过。全量 `check-i18n` 仍报两个本次未修改的更新界面缺失键：`common.close`、`msg.update.incomplete`，调用处位于 MainWindow/index.tsx 且已有中文回退；不将全量检查记录为通过，也未顺带修改同事的更新功能。

验证只操作仓库 `_tmp/hdr-exposure-20261106/` 下的隔离目录，没有向真实游戏部署；未重新打包、更新、上传或发布。既有纯净 TEST 归档保持原样。游戏内视觉效果仍需实际体验。
