# 实验性旋转光照（2026-10-27）

设置 → 画面设置新增「旋转光照」，默认关闭，使用单个开关，保持每排三个选项。说明为：「让地表单位的受光方向随游戏昼夜环绕一圈。地形、地下和地下城保持原样，关闭后恢复原来的方向。」经典画质禁用此项，HD／DE 可用；2.04 HD 也保留可逆兼容。

## 当日修正：原始轨道只有小幅摆动

玩家反馈没有旋转后，检查了正在使用的 Retail HD 配置与 DNC：开关为 true，游戏文件中也确有六条 DE 关键帧。用既有 `_tileset/04_tools/dnc_light_inspector` 的 XYZW／旋转局部 +Z 约定换算，原始 DE 光源方位只有 −127.875° 到 −119.745°（约 8.13°），仰角为 45.167° 到 61.718°。所以直接复制原始 DE 不能得到环绕效果。此前只核对文件及源关键帧，未验证实际光方向走过的范围，验收不足。

用户随后明确选择「随游戏昼夜环绕一整圈，保留 DE 仰角变化」，并指定起始四元数 `{0.25, 0.25, 0.7, 0}`。现实现将指定起点归一化，保留完整起始朝向与滚转；原始 DE 的 SLERP 仰角曲线按该起点作整体偏移，保留相对起伏，方位按游戏一天的相位连续增加 360°。每 7.5°采样，并额外保留原始 DE 关键帧时刻，共 54 条关键帧。全部四元数归一化，首尾完全一致，避免只写两个等价朝向造成静止。仍只写单位模型的 Rotation，不改变原始 DE 留档、不改亮度及其他模型字段。

随后明确以游戏内 **06:00** 为起点。旋转与相对仰角轨道整体顺移六个游戏小时：06:00 对应指定四元数，12:00 方位转过 90°，18:00 转过 180°，00:00 转过 270°，次日 06:00 回到起点。对于跨度 60000 的 DNC，锚点为 `Interval.start + 15000`（HD 为 15000，DE 为 18367）；午夜首尾保持无缝。开关开启时刻不改变这个锚点。测试同时核对实际序列起始偏移、五个游戏时刻、完整环绕及关闭还原。

指定起点归一化后为 `{0.3187883565, 0.3187883565, 0.8926073983, 0}`，保留原四元数表示的方向。修正后使用独立的 gl-matrix 对 721 个动画采样点复核：完整扫过 360°，最大相对仰角误差 0.103394°，最大方位误差 0.076649°；27 组配置与 Retail／PTR 实际文件及 IPC 回归均通过。数学验收记录保存在 `_tmp/rotating-lighting-fix-20261027/math-verification.json`，本次构建日志使用同目录 `production-build.log`。准备应用当前目录时，读取到用户已把 `rotatingLighting` 切为 false，守卫在任何写入前停止，未修改当前游戏文件或重新打开开关。重启新客户端、开启开关并重启魔兽后验证游戏内效果；一圈对应游戏昼夜周期，而非固定 60 秒。

## 原始 DE 依据

从本机 `D:/Quenching/War3Reforged/Warcraft III` 的 CASC 读取，精确使用 `war3.w3mod:_de.w3mod:environment\dnc\...`，没有读取 MOD 的 loose 文件，也没有以 HD 资源冒充 DE。游戏版本为 3.0.1.24371，模型格式为 1800。

完整保留与客户端 DNC 覆盖对应的 13 个原始 DE MDX、来源路径、大小、SHA-256 和抽取时间：`backup/de-dnc-original-20261027/`。其中 `manifest.json` 记录全部原始模型，`unit-rotations.json` 保留四套地表单位轨道。该 backup 目录按仓库既有规则仅本地留档；运行所需数据独立放入源码资源目录，不依赖 backup 参与构建。

四套地表单位模型（Ashenvale、Dalaran、Felwood、Lordaeron）的原始 DE 旋转完全相同，包含 6 个四元数关键帧、Linear 插值、ObjectId 0、无父对象或全局序列。抽取工具先核对这些条件再输出运行数据。HD 的动画从 0 开始，DE 从 3367 开始，因此按各自 Interval 对齐关键帧，保留原有动画区间和昼夜周期。

重新留档的命令（目标目录必须不存在）：

```powershell
node scripts/archive-de-dnc.cjs 'D:/Quenching/War3Reforged/Warcraft III' 'backup/de-dnc-original-另一日期'
```

## 隔离与恢复

- `rotatingLighting` 仅严格等于 `true` 时启用；旧配置缺失该项时为关闭。不开启时保留现有 DNC 处理结果。
- 写入目标只允许四个已核对的 `...unit.mdl`。地形、头像、地下、地下城以及额外自定义 DNC 文件均不在允许列表中。
- 只替换目标 Light 的 `Rotation` 动画段，不重新序列化整个 MDL，不改强度、颜色、环境光、阴影、位置、序列或地形。
- 独立 IPC `mdl:update-rotating-lighting` 不调用整套资源同步，不解压植被、不换着色器，不重写地形。MOD 关闭时只保存选择。
- 先读取并校验四个文件，再写入；使用临时文件和原子文件替换。全部成功后才保存设置。写入或保存失败会回滚已经写入的文件；若外部锁连回滚也阻止，则保留带唯一名称的 recovery `.bak` 并报错。
- 关闭时根据当前画质／光照模式的处理后基线恢复 Rotation，包含 2.04 对战的原有旋转行为，保留实时文件中其他字段。
- 正常启动同步、画质切换和亮度／光照模式更新会在原有 DNC 处理结束后重新叠加已启用的旋转。正常同步与单独切换共用 DNC 目录队列，避免交错写入。
- 标准／对战预设不设置这个实验开关，用户选择保持独立。

## 本次改动文件

- `src/Main/services/rotating-lighting.ts`：允许列表、轨道替换、文件校验及回滚。
- `src/shared/dnc-rotation.ts`：四元数／光向量转换、原始 DE 仰角采样、连续完整环绕轨道生成。
- `src/Main/services/dnc-lighting.ts`：提取现有亮度处理为纯函数，供关闭开关时计算当前基线；既有默认行为不变。
- `src/Main/services/asset-sync.ts`：DNC 队列与正常同步后的实验叠加。
- `src/Main/ipc/mdl-handlers.ts`、`src/Main/preload.ts`、`src/types/electron-api.d.ts`：独立切换接口。
- `src/Renderer/hooks/useWar3Settings.ts`：默认值、配置迁移和独立保存流程。
- `src/Renderer/components/MainWindow/SettingsModal.tsx`：单开关、禁用条件与实验标记。
- `src/Renderer/utils/i18n/locales/`：八种语言的标题、说明及实验标记。
- `assets/quenching/experimental/de-unit-rotations.json`：原始 DE 旋转与来源校验值。
- `scripts/archive-de-dnc.cjs`：可复现的 CASC 只读抽取。
- `scripts/test-rotating-lighting.ts`、`scripts/test-graphics-settings-transition.ts`、`scripts/test-startup-rendering-files.ts`、`package.json`：隔离、界面和集成测试及命令入口。

本次没有修改任何打包用的既有 DNC 模板，也没有修改植被的删除后重新解压逻辑。

## 验证结果

全部通过：

1. `npm run test:rotating-lighting`：27 组画质／模式／亮度组合，核对原始 MDX 的哈希和关键帧；以独立 gl-matrix 实现验证实际光向量连续走满 360°、单位四元数、DE 仰角保留及首尾闭合；仅 Rotation 变化、排除项逐字节相同、重复开启幂等、关闭精确恢复、写入／保存失败回滚、目录队列失败后继续运行。
2. `npm run test:graphics-settings-transition`：默认关闭、单开关和三列布局、只调用独立 IPC、失败回滚设置、MOD 关闭只存配置、重载保持、对战预设不重置实验项，以及既有画质切换回归。
3. `npm run test:startup-rendering-files`：真实文件同步和真实 IPC，Retail／PTR 两分支；HD／DE 和模式／亮度切换后保留开关，重复启动同步不叠乘；独立切换不改变地形和着色器的修改时间，关闭还原。
4. `tsx scripts/test-dnc-level3.ts`、`tsx scripts/test-dnc-hd-battle.ts`、`tsx scripts/test-dnc-de-rpg.ts`：既有 250 组现代 DNC 校验与着色器／RPG 路由回归。
5. `npm run test:startup-rendering`：启动调度、关闭状态、异常隔离及前台／启动互斥回归。
6. `npm run test:i18n`：八种语言均为 1331 个键，无缺失、重复及占位符不匹配。
7. `tsx scripts/webpack.build production`：退出码 0，输出 `complete`，无 fatal／ERROR in／Build failed；产物主进程与渲染进程均检出新增功能。
8. 本次修改的已跟踪文件 `git diff --check` 通过。

测试全部在副本上进行，没有改玩家当前游戏目录，尚未进游戏目测实际昼夜效果。构建日志位于 `_tmp/rotating-lighting-20261027/production-build.log`。自动审批策略阻止了删除临时 `original` 解包副本的清理命令，故该副本仍保留；正式原始留档在 backup 中独立保存。
