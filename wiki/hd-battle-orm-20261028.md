# HD 对战金属度和粗糙度（2026-10-28）

用户最终参数为金属度输入倍率 **0.5**、粗糙度输入加法 **0.05**、粗糙度输入倍率 **1.1**。中途提出的金属度 0.75 已被最终的 0.5 覆盖。

```text
metallic_input = ORM.B * 0.5
roughness_input = (ORM.G + 0.05) * 1.1
```

保留各材质后续原生的粗糙度钳制、范围映射和地形层混合。参数覆盖 HD Retail／PTR 对战物体、地形、悬崖及对应的辨识度 HD 材质。各变体通过采样 swizzle 追踪 G、B 实际目标分量，辅助 AO 采样不参与调整；ORM.A 与战争迷雾可见性／描边写入协议保持原状。

地形和悬崖基底已有粗糙度输入调整 `(G - 0.1) * 0.9`，HD 另一条布局已有 `(G - 0.25) * 1.1`，本轮替换这些输入设置，避免在它们上面重复叠乘。没有粗糙度输入设置的 HD 路径追加对应加法与乘法。所有路径的金属度输入均从原有 0.75 改为 0.5。

最终资源按用户指定写入 `assets/unpacked/shaders/` 与 `assets/unpacked/shaders.zip`，共 8 份 BLS 和 1 份辨识度索引。标准、RPG、DE、Fog、独立 3.0 兼容源，以及 `assets/quenching` 中的旧副本不属于本轮修改范围；未部署游戏或 Latest。完整指纹对照保存在本轮任务目录。

生产构建入口 `scripts/build-lighting-materials.py` 已接入相同 ORM 调整逻辑，并优先从 `assets/unpacked/shaders` 读取展开资源；可用 `--assets-root` 显式选择基底。6 份原始 Battle 候选已与完整标准派生重建结果逐字节核对一致。

2432 个相关材质变体、2816 次 ORM 输入覆盖通过核验，改变后的程序通过 WARP 创建检查；48 项 GPU 检查覆盖两种 HD 布局、地形、悬崖及独立粗糙度／金属度输入组合，同时核对其他通道不变。最终报告位于 `artifacts/battle-orm-20261028/verification.json`，回滚对象保存在 `_tmp/battle-orm-20261028/backup/`。

后续用户明确授权部署，并要求本地资源部署不检查游戏运行状态。已将 `assets/unpacked` 中的 HD 对战物体、地形、悬崖三份材质部署到当前 Retail 3.0.1.24371 的 `_retail_/shaders/ps/`，逐文件 SHA 校验通过；其余着色器和客户端配置保持不变，亮度为 3。部署凭据与游戏目录中的回滚备份位置见 `artifacts/deploy-battle-orm-20261028/deployment.json`。
