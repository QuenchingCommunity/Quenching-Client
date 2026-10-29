# HD对战追加材质参数与游戏部署（2026-10-27）

在同日已完成的标准派生、无云影对战材质上，追加用户指定的参数：

| 参数 | HD对战 | HD RPG |
|---|---:|---:|
| DIFFUSE_MULTIPLIER | 1.6 | 保留1.5 |
| DIELECTRIC_F0 | 0.06 | 保留0.05 |
| OUTPUT_SATURATION | 0.95 | 保留0.9 |
| OUTPUT_EXPOSURE | 1.2 | 0.8 |

曝光仍为RGB线性倍率；不改alpha。原有HD对战的无云影、标准法线、F90／反射／补光设置保留。RPG继续保留云影与1.5法线。地形、悬崖、DE、DNC和Fog效果没有通过本次追加参数修改。

`scripts/build-lighting-materials.py` 从同一份未变化的标准基底重新生成，避免重复应用。新增`--hd-only --material-only`支持只构建此次变动的四份Retail／PTR HD材料。实际反汇编确认Lambert系数为1.6/π，F0为0.06，饱和度0.95，线性曝光1.2；RPG曝光0.8。两种材质各覆盖512个相关HD变体，原生接口和非请求路径保持。

配套重建四份HDRPG／对战辨识度HD及索引。当前Fog含其他任务的最新修改，本次保持其字节和索引元数据；未回退Fog。资源ZIP条目不增删，只有上述八份HD文件及一份索引共9项内容改变。

两种新基底各通过41项离屏GPU检查，共82项。完整辨识度开关／恢复与各模式选择测试、DNC与着色器分档测试均通过。交付证据位于 `artifacts/hd-battle-materials-20261027/`，包含实际参数反汇编摘录、GPU报告、资源包校验及游戏部署回执。

用户自行退出游戏后部署。实际目标为 `D:/Quenching/War3Reforged/Warcraft III/_retail_/shaders/ps/hd.bls`，已核实Retail版本3.0.1.24371。根据当前保存的HD对战、辨识度关闭状态，部署普通对战HD；RPG 0.8已进入客户端资源，切换到RPG时使用。保留用户当前亮度3档，不通过材质部署改写偏好；首页对战预设的默认4档规则仍不变。

只替换了游戏的`ps/hd.bls`，其他着色器与配置逐项核对不变。部署SHA-256：`35767c00203e76cf6d3bb05fda44822ec3de31f236108678fb2f94b3246d7fe6`。游戏旧文件与清单位于`.quenching/backups/hd-materials-20261027-*`；客户端资源及原ZIP备份位于 `_tmp/hd-battle-materials-20261027/backup`，保留回滚。

没有向Latest、网站、网络更新源发布，也未重打EXE／ASAR；这次只修改材质资源与已明确授权的游戏文件。
