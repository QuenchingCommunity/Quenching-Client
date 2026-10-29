# 对战 HD／Terrain 来源审计（2026-10-26，不含 Fog 分析）

这是10月26日旧melee材质的历史记录。10月27日已按用户要求改为从标准派生新的HD RPG／对战材质，并增加DE无云对战分档，见 [新规则与验证](rpg-lighting-materials-20261027.md)。以下旧参数不代表10月27日后的源码资源。

本次只读取源码、配置、ZIP、BLS并反汇编，没有修改着色器、设置或游戏文件。

## 当前落盘状态

正式服目录 `D:/Quenching/War3Reforged/Warcraft III/_retail_/shaders` 中，PS的HD、Terrain、Cliff、SD-on-HD、Foliage均与客户端standard散文件及ZIP逐字节对应。HD为 `e127d0ff…`，Terrain为 `d081c231…`，Cliff为 `3e570ca7…`。记录包名为 `shaders-300-hd`。

`AppData/Roaming/Quenching Mod Client/config.json` 保存的是Retail、HD、standard、3档，`improveReadability=false`。因此这次读取时磁盘上没有安装对战melee或其辨识度HD扩展。此结论描述读取时状态，不能反推用户先前截图／观察时的状态。

完整哈希匹配：`_tmp/shader-origin-audit-20261026/installed-match.json`。

## 点击对战后的来源

按当前3.0.1+ Retail HD代码：`renderingPresetSettings('battle')`选择battle、4档，并启用物体着色器、后处理及提高辨识度。

1. 从 `assets/quenching/shaders.zip` 选择 `shaders/shaders-300-hd/ps/melee/`，VS来自同包 `shaders/shaders-300-hd/vs/`。standard和battle共享这份VS目录。
2. Terrain与Cliff分别使用melee目录的 `terrain.bls`、`cliffblightmiscterrain.bls`。
3. 默认提高辨识度开启后，最终 `ps/hd.bls` 被 `shaders/readability-301/ao_066_outline/ps/hd.bls` 替换。该扩展构建于同一个melee HD基底，增加队伍色处理，保留原材质参数。
4. 关闭提高辨识度后HD恢复melee基底；不会因此恢复standard材质参数。

依据：`src/Main/services/mod-profile.ts`、`shader-bundle.ts`、`fog-shader-override.ts`、`src/shared/rendering-presets.ts`。

| 文件 | SHA-256 |
|---|---|
| melee/hd.bls | f8ccf4e61ac3d8c17e150adba920049836785bcff519379385d422671f5350cd |
| melee/terrain.bls | 6b1fb15eec223df82f0203e6fd782cfa32de0300c565f281ec7e26a303ab8d08 |
| melee/cliffblightmiscterrain.bls | 34eac7390b643df40becc933d0c1b4f47835c9e0048d4bdd64752cc6d239d1ae |
| readability ao_066_outline/hd.bls | cfa39d263d0b7b7d2856580fa48751ecc6d98b95c1d389b796573782f4e58e2a |

四份散文件与当前实际分发ZIP一致。详见 `_tmp/shader-origin-audit-20261026/pack-provenance.json`。

## 材质差异

下表来自实际BLS的HD变体128、Terrain/Cliff变体0的反汇编，描述对应材质路径；头像保护、无光照及深度变体不能一概套用所有材质参数。normal倍率是XY缩放并重新归一化，不等于高度或最终像素明暗直接乘该倍数。

| 参数 | standard | melee |
|---|---:|---:|
| HD额外法线XY倍率（保留游戏cb2[27].x） | 1 | 2.5 |
| Terrain/Cliff额外法线XY倍率 | 1 | 1.8 |
| HD漫反射倍率 | 1 | 1.5 |
| Terrain/Cliff漫反射倍率 | 1 | 1.4 |
| HD基色亮度倍率 | 0.75 | 1.01 |
| HD基色偏移RGB | +0.034 | 0 |
| HD粗糙度映射范围 | 0.25～0.95 | 0.05～0.95 |
| Terrain/Cliff粗糙度映射范围 | 0.25～0.95 | 0.05～0.95 |
| HD金属度（B为ORM.B） | B×0.75 | saturate((B+0.01)×1.1) |
| Terrain/Cliff金属度 | B×0.75 | saturate((B+0.05)×1.25) |
| HD环境填充倍率 | 0.6 | 0.8 |
| HD/Terrain/Cliff环境镜面采样倍率 | 0.75 | 1 |
| Terrain/Cliff环境填充倍率 | 0.6 | 0.6 |
| HD视线长度平方调整 | ×2.1 | ×1.1 |

melee HD另有ORM.R材质AO补齐：0.002～0.02为空值渐变保护区，AO因子最低0.5；补齐非金属F0为0.03，额外自发光RGB为0.01且带暗底保护。Terrain/Cliff的非金属F0补值为0.002。Terrain各层粗糙度前置处理仍为(G−0.1)×0.9；两种模式的这部分相同。

HD两种模式都保留RGB矩阵 `[[1.21,-0.06,-0.01],[-0.03,1.21,-0.01],[-0.03,-0.06,1.21]]`。Terrain/Cliff保留 `[[1.07,-0.06,-0.01],[-0.03,1.04,-0.01],[-0.03,-0.06,1.09]]`。两套均有既有云影，melee与standard的云实现也存在差异；本记录没有把它们称为原版中性材质。

辨识度扩展的配置值是队伍色自发光0.33、队伍色轮廓宽2像素／强度0.16，且保护子视图；这是扩展原材质的独立处理，未把既有2.5／1.8法线设为中性。Fog自身的参数不在本次说明范围。

实际汇编与差异保存在 `_tmp/shader-origin-audit-20261026/*asm.txt`、`*-standard-vs-melee.diff`。例如melee HD汇编109～110行为游戏法线强度之后追加 `mul r1.xy, r1.xyzw, l(2.500000)`；Terrain83行为 `mul r4.xy, r4.xyzw, l(1.800000)`。

## 历史来源的证据边界

历史迁移文档将这套melee／DE追溯到客户端原有的自定义3.0材质，再适配3.0.1的新原生排列、深度裁剪与容器接口。不能把它当作今天统一着色器源码默认参数的新整包输出。

文件级能够明确绑定的HD记录是 `D:/Quenching/QM/shaders/05_Builds/resource_profiles_301_20261022_07/report.json`：其中melee的HD哈希与当前 `f8ccf4e6…` 完全一致。这次同步保留HD和地形材质，更新SD-on-HD共享控制。

辨识度HD随后由 `_irys/build-client-readability.py` 读取这份melee基底，叠加team_color_301实现；`profiles.json` 的baseHdSha256再次约束相同基底。初始旧melee的单次完整构建收据未在本次核对中定位，不能凭现行Python全局常量反推旧BLS参数。本次的2.5／1.8来自BLS本体，而非当前Python文件里的2.1／1.75。

迁移依据：`D:/Quenching/QM/shaders/99_Docs/Client_HD_SD_New_Version_Migration_20260928.md`、`Client_Ground_PTR_Migration_20260928.md`；保留材质的同步说明：`Client_Latest_301_and_204_Experiments_20261022.md`；队伍辨识度集成说明：本仓库 `wiki/rendering-presets-readability-20261024.md`。

2026-10-26的DNC定稿只改主光强和环境光强；没有重建以上BLS的材质法线参数。
