> 后续更正（2026-10-29）：下文是上一轮历史操作，已按用户要求撤回原生 Video/bloom 同步，并只还原该字段为操作前的 0。没有验证这一偏好字段是本次辉光所需门控，不能用它断言辉光关闭。辉光开关只同步 PostProcessingConfig.txt 的 [Bloom] Enabled。大气光关闭现在直接删除整份 ui/MiscData.txt，游戏目录已应用，保留备份。见 artifacts/atmosphere-simple-20261029/verification.json。

# 辉光开关同步和大气光残留（2026-10-29）

用户报告开启提高辨识度后没有明显描边／颜色增强，并发现辉光打开但原生 Bloom 关闭、大气光关闭仍有雾。

现场读取：客户端 improveReadability、postProcessing、postProcessingOutline、postProcessingGlow 为 true，atmosphericLight 为 false。实际 HD、Fog、VolumetricFog 均与当前 ao_066_outline 配套完全一致；全部十个资源配置的 HD 都有 256/2048 个有效队伍标记变体。本地文件读取已启用。参数保持队伍色表面增亮 0.33、队伍色内侧描边 2 像素／混合 0.16。以上不是实际游戏 draw 或画面验收。

暴雪原生 ASSAO 与自定义 Fog 描边独立；不能根据 assao=0 断言描边不执行。本次保持原生 assao=0 和全局 ASSAO Enabled=0。

## 两处修复

1. 辉光此前只增删 shader，既不更新全局 Bloom Enabled，也不更新用户偏好 Video/bloom。现在启动同步和开关都同步这两层，正确传递尚未落盘的 IPC 开关值；仅修改 Video 段的 bloom，不动其他段、ASSAO 或 portraitBloom。偏好文件缺失不创建，已有文件写入前保留备份。
2. atmospheric-light.ts 在关闭且无恢复记录时直接返回，完整包自带的 TerrainZFog 会残留。现在无恢复记录时移除这一段，有原始记录时还原原来的段；其他 MiscData 配置保持。清理前另存备份，重复关闭不继续改写。不会删除整份 MiscData，也不承诺关闭地图自己设置的雾、体积雾或战争迷雾。

## 本地应用及验证

已直接同步当前游戏：原生 bloom=1，全局 Bloom Enabled=1，原生 assao=0；移除本地 MiscData 的 TerrainZFog，其他字段不变。所有游戏 shader 哈希和客户端选择保持不变。未检查游戏是否运行，也未要求退出。

通过 test-atmospheric-light.ts、test-post-processing-config.ts、test-rendering-presets-readability.ts 及全部资源写入器检查。部署记录：artifacts/readability-gates-20261029/verification.json；备份：_tmp/readability-gates-20261029/backup。

描边在游戏画面中的无效问题尚未完成实机定位，不能以资源／离线检查代替运行时结论。本次没有改描边强度、宽度、材质参数或 ASSAO。
