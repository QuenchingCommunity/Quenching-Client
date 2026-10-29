# 3.0.1 原版基线更新与 HD 对战缩放（2026-10-23）

## 当前第二版

用户要求在初版对战尺寸基础上，除憎恶、骑士、科多兽外，其余非英雄单位与建筑再减 0.02。当前普通条目总计减 0.06、特殊条目总计减 0.08；三个例外仍总计减 0.04，最终分别为憎恶 0.96、骑士 0.83、科多兽 0.91。英雄保留自身皮肤尺寸。

当前为 783 个减 0.06、20 个减 0.08、3 个减 0.04，另有一项别名继承。运行时规则、独立测试包与实际游戏目录均同步更新，普通模式的原版基线保留。皮肤继承及正常／对战尺寸恢复行为沿用初版；示例自定义普通单位 1.5 在对战为 1.44，坦克涂装 1.2 在对战为 1.12。

修改前已核验真实游戏目录仍为上一版部署哈希 `3293fc895cee2f12aff34a3f393750fa823ffdf9695e182f888ccb171c1d0d4d`，数值未被覆盖。部署时游戏正在运行，磁盘替换后需完全退出并重新启动游戏读取。保留上一版 ZIP、核对报告、改动 CSV 和部署记录，文件名前缀为 `revision1-`。

下述为初版实施记录；减值以本节第二版为准。

## 原表核对

只读打开 `D:/Quenching/War3Reforged/Warcraft III*w3`，从 CASC 提取 `war3.w3mod:units\unitskin.txt`。安装的 `.build.info` 和正式服 EXE 均对应 **3.0.1.24371**。

- 原表：967,257 字节，983 个区段；SHA-256 `bf51f06435c5604b173677dc22d56bd2cb447200456f9ac9b17e452338fcc459`。
- 旧模板：967,096 字节；SHA-256 `7ea22262526d20cce5e812a5d56491a4a5a5d54c3187a61b4c7c026ee8d53631`。
- 有 24 处字段差异，均为 DE 的声音、颜色和缩放；HD 字段一致。

已将客户端 `assets/quenching/skin/unitskin-new.txt`、`unitskin-sd.txt`、`unitskin-de.txt` 和资源源目录 `D:/Quenching/QM/Latest/units/unitskin.txt` 更新为此次 CASC 原表，四者 SHA-256 相同。正常模式保留原版缩放。旧版 `legacy/` 和复古模型资源表 `unitskin-old.txt` 保留。

## 对战行为

对战对应客户端 `lighting=battle`。在 3.x 共用的 `v30` 皮肤配置中，HD／HD 复古配置开启对战缩放；正常与 RPG 恢复原尺寸，SD／DE 不开启。2.x 配置不参与这次缩放。

- 所有非英雄单位、普通建筑的 HD 模型缩放减 0.04，包含中立与战役条目。
- 指定对象减 0.06，不叠加 0.04：`hvlt hlum utom uzig uzg1 uzg2 etrp etol etoa etoe hmtt hrtt hwt2 hwt3 hdhw ocat ehip echm ufro emtg`。
- 原版表共 786 个普通条目、20 个特殊条目；176 个英雄／英雄皮肤区段保留。`espm` 从 `espv` 继承。
- `ocat` 是兽族投石车；刃车、角鹰兽骑士和腐化古树等其他条目按普通规则。

正常与对战共用皮肤选择和皮肤表，基于所选皮肤自身的 modelScale 减值。例如自定义普通单位缩放 1.5，在对战中为 1.46，返回正常仍为 1.5；工程坦克涂装为 1.2 时，对战为 1.14。英雄涂装保留自身尺寸。

`src/shared/battle-unit-scale.ts` 在每个被处理的区段保存游戏忽略的原值注释，便于重复应用、模式切换和文件停放后准确恢复；只有通用 modelScale 的条目新增 HD 覆盖，保留 SD／DE。皮肤写入、恢复原版、删除／修复涂装、复古表重建和强制初始化均使用相同的恢复／叠加规则，避免重复缩小。

基线编号从 2 升为 3。升级时刷新当前表与已停放的普通配置，复制玩家明确选择的皮肤字段；先还原对战减值，再继承皮肤原尺寸。选择“原版”的条目直接采用新原表，避免把旧 DE 数值写回。关闭皮肤的配置继续关闭。

## 验证

以下检查已通过，均未向真实游戏安装目录写入：

```powershell
node --import tsx scripts/test-battle-unit-scale.ts
node --import tsx scripts/test-unit-skin-profile.ts
node --import tsx scripts/test-skin-versions.ts
node --import tsx scripts/test-version-skin-service.ts
node --import tsx scripts/test-graphics-settings-transition.ts
node --import tsx scripts/test-startup-rendering-files.ts
node --import tsx scripts/test-full-package-switch-state.ts
node --import tsx scripts/test-mod-update-profile-apply.ts
```

另通过缩放辅助函数、皮肤字段写入和配置切换模块的 TypeScript 定向检查。测试覆盖全部 806 个直接缩放条目、反复切换不累积、原表字节往返、自定义／内置皮肤缩放、原版重置、英雄与 SD／DE 隔离、当前和停放表的基线升级，以及真实文件写入的正式服／PTR 光照同步流程。

本次为源码与本地资源修改，尚未重新打包发布客户端或 MOD，也未完成游戏内目测验收。最初独立测试包和 CASC 核对记录保存在 `experiments/unitskin-hd-small-20261023/`。
