# HD 地面材质参数同步（2026-10-27）

上一轮仅更新 `hd.bls` 的漫反射、饱和度和曝光，地形与悬崖只保留此前的云影和法线设置，导致附加颜色／亮度调整没有一起应用。本轮将三个材质系列同步为下表，正式版和 PTR 均覆盖。

| HD 模式 | 漫反射倍率 | 附加饱和度 | RGB 线性曝光倍率 |
|---|---:|---:|---:|
| 对战 | 1.4 | 0.95 | 0.9 |
| RPG | 1.25 | 0.95 | 0.75 |

覆盖 `hd.bls`、`terrain.bls`、`cliffblightmiscterrain.bls` 的 PBR 路径，包括对应的地形、悬崖、荒芜等地面材质。三者均在原生 Lambert 系数上乘漫反射倍率，在各自基底颜色矩阵之后追加饱和度与曝光。各基底原有颜色矩阵不重写；参数同步不代表不同贴图、材质与朝向在游戏中呈现完全相同的颜色。

对战继续移除云影，RPG 保留云影直射亮端 1.5／暗端 0.5，并沿用 HD、地形、悬崖的额外法线倍率 1.5。此前 HD 的 F0、环境镜面、Fresnel、RPG 粗糙度等规则不变。非 PBR 路径、标准模式、DE、Fog、DNC 和独立 3.0 资源均保持本轮开始时的内容。

移除地面云影时保留颜色缓存，完成饱和度和曝光调整后再写入最终颜色输出，避免提前把矩阵结果重定向到输出后，颜色调整读到未初始化的寄存器。该路径已用实际指令的 GPU 输出验证。

构建入口：

```powershell
python scripts/build-lighting-materials.py --output _tmp/<task>/candidate --hd-only --families hd terrain cliffblightmiscterrain
```

候选材质通过 WARP 创建检查，并核验 12 份 BLS 的全部 2816 个相关材质变体。56 项实际 GPU 检查覆盖队伍色发光、三类材质的 Lambert 系数和颜色调整、对战地面最终输出与 RPG 粗糙度。原生战争迷雾可见性写入器指令尾部逐字节保持，配套辨识度仅重建 HD 材质。

本轮更新 12 份原始 HD 材质、4 份辨识度 HD 材质、1 份索引及客户端 `assets/quenching/shaders.zip`；资源包只允许这 17 项内容变化。游戏目录及配置用本轮开始时的指纹核对，继续保持标准模式、亮度 3。按用户此前选择只更新客户端资源，本轮未部署游戏、Latest 或网络源。

验收报告位于 `artifacts/hd-ground-sync-20261027/verification.json`，回滚备份位于 `_tmp/hd-ground-sync-20261027/backup/`。
