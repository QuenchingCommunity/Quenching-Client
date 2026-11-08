# 单位光照方向与地形 DNC 边界（2026-11-08）

用户反馈对战 foliage 仍暗，并明确光照角度只能修改 unit DNC。

现场：HD、自动检测 3.01、对战光照、v16 地形，方位角 231、阴影 43、亮度 4、HDR Exposure 1.09。只记录必要设置，不重置用户参数。

最终便携包资源、源码、运行客户端展开缓存及游戏的普通草地 diffuse 均为 BC3 新图 `4a9c9a5c1d3519519a3b57cbfee0352a1718f814ab373d9b09d2a2401ee58bf7`。完整 zip-foliage-other 103 个文件均与客户端缓存和游戏一致；实际对战 foliage.bls 与源 melee 版本哈希也一致。因此不是漏打包或这一组文件未同步。素材仅格式转码，没有擅自提亮用户美术。

错误在旧 `applyBattleTerrainRotation`：每次对战资源同步会把 terrain Rotation 改成静态 `(0.25,0.25,0.75,0)`，覆盖原始 terrain 四元数或动画。另一个 2.x 表面基线分支也会改 terrain Rotation。已移除前者，后者只处理亮度/颜色而保留 terrain Rotation。unit 方位角、阴影长短及旋转功能继续按既有实现工作。

本地游戏 6 个 terrain DNC 恢复对应原始 HD DNC 的 Rotation，只恢复识别出的已知错误块；保留模型其他字节、6 个 unit 文件和客户端配置。必要备份置于游戏同卷 `_tmp/quenching-terrain-rotation-20261108-*`，详见交付记录 `game-restoration.json`。重启/切模式通过源码同步也会恢复原始源参数，不依赖此次手动修复。

回归覆盖 2052 个非 unit 模型方向组合、18 个 unit 正向控制、250 个 HD/DE 亮度/颜色文件场景、真实 Retail/PTR 启动同步及旧错误 terrain 的修复、单位设置独立 IPC/失败回滚。草地最终明暗仍需重新加载地图后由用户实机验收；文件和参数一致不等于游戏画面已验收。
