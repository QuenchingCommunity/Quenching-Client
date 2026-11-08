# Campaign 单位旋转光照与草地提亮（2026-11-08）

用户要求普通草地再亮一点；核实3.0.1 DE DNC文字版，采用dncCampaign旋转方式仅应用units，旋转时锁定40%阴影长度与45度光照角度。

## 资源与取样

现有MDL文字模板在assets/unpacked/dnc/dnc30-de；DE原始13份MDX与来源清单保存在backup/de-dnc-original-20261027。安装CASC正式服版本仍为3.0.1.24371。

本次只读枚举CASC得到dnccampaign下Act2OutdoorDNC、CloudyDNC、DncUndercityFinal。前两者的两个Rotation轨迹完全一致，主光轨迹各97个Linear关键帧，区间3367..63367；Undercity是固定光照。选用前两份共有的ObjectId0主光轨迹。逐关键帧与原始MDX的KGRT整数时间／四元数浮点数核对一致，来源路径及SHA记录在assets/unpacked/experimental/de-campaign-rotations.json。验收资料中的CampaignRotation.mdl是Rotation片段文字提取，并非完整Campaign模型转换。

## 实现

替换原先根据6帧DE地表参考合成360度轨迹的运行逻辑，直接映射Campaign97帧的原始时间比例到当前单位DNC区间，保留原始旋转路径与变速方式。仅调整光源方向：按40%现有阴影长度映射处理仰角，再将06:00方位对齐45度。只写既有四个地表units允许列表的ObjectId0 Rotation，不碰terrain、portrait、地下、地下城或自定义DNC；不继承Campaign颜色或光强。

共享resolveUnitLightSettings在rotatingLighting开启时强制生效40/45，UI显示固定值并禁用两个控件，直接IPC和排队后再次检查均拒绝修改。开启不覆盖玩家保存的角度／阴影长度，关闭时按关闭后的状态解析并恢复这些保存值，防止误用开启状态的固定值。

## 草地与部署

用上一轮保存的用户修改版BC7原图，每层RGB乘1.12后转换BC3。原有10层mip继续各自转换，Alpha不提亮且保持128阈值裁剪分类。只更新对战普通草地diffuse，游戏路径及清单哈希校验通过。资源包更新植被颜色包和新增Campaign参考所在核心包。当前旋转开关为false，保持该选择，没有为了预览强行开启，也没有写游戏DNC文件。

## 验证

2052组DNC方向／阴影长度隔离检查、36组阴影长度文件场景、27组旋转模式／亮度组合、Retail/PTR实际IPC及旋转开关往返恢复、控件直接接口锁定、画面设置切换回归通过。原始Campaign97帧逐数值来源校验通过；草地包完整性与实际成员SHA通过。未进行游戏内画面验收，未导出新便携包或上传发布。

记录：artifacts/campaign-rotation-20261108/verification.json、artifacts/foliage-brighten-20261108/verification.json。构建日志：_tmp/campaign-rotation-20261108/build-final.log。
