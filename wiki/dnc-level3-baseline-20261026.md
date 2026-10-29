# DNC 3档定稿与其他档位推导（2026-10-26）

用户最后提交 `C:/Users/uizor/Downloads/dnc-lighting-edits (1).json`，共16份普通模式3档修改：HD全部12份，DE地下／地下城4份。完整输入归档于 `artifacts/dnc-lighting-20261026/dnc-level3-final-input.json`。

HD／DE的普通模式3档为基准，未编辑的DE文件沿用原编辑器的普通3档实际生成结果。因此资源目录中的25份MDL现在存放最终3档值，不能再额外乘旧的1.1。原模板备份在 `_tmp/dnc-editor-20261026/level3-backup`，用于回滚；逐文件新旧SHA-256见交付目录的 `dnc-level3-baseline-manifest.json`。

普通／对战同档主光强相同：`Intensity = I3 × [1 + (档位−3) × 0.15]`，即1～5档为70%、85%、100%、115%、130%。`AmbIntensity = A3 + (档位−3) × 0.015 + (对战 ? 0.04 : 0)`。颜色、旋转、阴影、关键帧时间不变。计算保留6位小数，不再将0.015舍入为0.01或0.02；普通3档保留输入原文。

`src/Main/services/dnc-lighting.ts` 为实际应用入口。`isVersion30` 在当前客户端涵盖3.0和3.0.1+，HD／DE均使用此基准。旧RPG仍回退普通；melee兼容别名对应对战。2.04的资源和旧算法不变。

没有通过本次任务更新Latest、魔兽安装目录、已打包EXE／ASAR或网络发布源。源码构建只更新dist，不代表游戏目录已经应用。

验收：`scripts/test-dnc-level3.ts` 覆盖全部250份HD／DE配置、3档原文、16份用户修改、精确步进、静态／动画光强、其他字段不变和旧模式别名；现有HD着色器路由与RPG兼容检查继续保留。交付ZIP逐文件与实际处理结果比对，2.04共120份输出与原快照完全一致。HTML检查覆盖全部HD档位、DE地下、对战偏移与手机布局。

启动落盘测试 `scripts/test-startup-rendering-files.ts` 补齐恢复3.0支持后的旧着色器资源样本与预期：Retail显式v30使用专用legacy着色器；PTR继续使用PTR资源。该测试同时检查重复应用时从源基准恢复，避免亮度系数累积。

交付位于 `artifacts/dnc-lighting-20261026/`：新版HTML（保留同类地形同步按钮）、原始输入、来源清单和HD／DE全部档位ZIP。新HTML使用新快照ID，已将本次用户修改融入基准。
