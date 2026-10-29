# Fog 与 PTR 客户端交接（待 3.7）

日期：2026-10-21。本轮只有客户端源码／针对性测试和此文档，未提交、未发布、未改版本号、未启动真实客户端／游戏、未部署真实游戏资源。着色器编译、资源替换和 ZIP 重打包由 Fog 任务完成，本任务没有重编译或覆盖它们。

## 当前资源事实与证据边界

- 用户说明当前 PTR／Retail 兼容；本任务只读 `D:/Quenching/War3Reforged/Warcraft III/.build.info` 的活动产品行，Retail 是 `3.0.1.24371`，PTR 是 `3.0.1.24368`。这些行不能证明未来 PTR 使用相同格式，也不替代 PTR 游戏实拍或原生 shader 全量哈希审计。
- Fog 任务最终报告：`D:/Quenching/QM/shaders/05_Builds/official_fog_profiles_301_20261021_230335_213433/build_report.json`；其完整交接在 `D:/Quenching/QM/shaders/99_Docs/Official_Fog_Profiles_301_20261021.md`。双 GPU 程序创建／配对渲染结果属于该任务，不是本任务执行的游戏测试。
- 当前参数索引 `assets/quenching/shaders/fog_shaders/profiles.json`：标准／RPG AO 0.8、对战 AO 0.66，与亮度滑块解耦；描边默认关闭、强度 0.66、宽度 2 像素。四套入口为 `ao_080`、`ao_066`、`ao_080_outline`、`ao_066_outline`。
- 本任务读到的 `assets/quenching/shaders.zip` SHA-256 为 `cba0cf424c35ecf916ab57847e0367c75c3a4b87e09071817eff0094a4ee6e87`，与 Fog 任务交接一致；`assets/quenching/shaders-300-legacy.zip` 相对 Git 没有改动。

## PTR 策略：逻辑档位不等于着色器格式许可

`src/Main/services/mod-profile.ts` 中，PTR 始终使用当前最新逻辑档位 `v301`，保持 HD／DE、现代单位皮肤和 DNC 选择。旧读数 `2.0.4`、旧手动选择 `v203` 都不会把 PTR 降到 `dnc20`／`shaders203`。**这不是宣称所有 PTR 都兼容 3.0.1 shader ABI。**

真实写入许可单独放在 `src/shared/ptr-shader-compatibility.ts`：

- 当前只有一个活动 PTR 格式规则 `PTR_SHADER_RULE`，允许完整构建号 `3.0.1.24368`。不接受 `3.0.1` 前缀、任意更高版本、旧 2.x 读数或检测失败；手动选 `v301` 也不能绕过。
- PTR 固定走独立的 `shaders-ptr-hd`／`shaders-ptr-de` 资源入口，不再直接取 `shaders-300-*`。目录当前字节相同不构成路径别名或自动回退。
- 当前规则明确允许复用 `fog_shaders` 的 3.0.1 Fog／原生身份写入器；未来不兼容时可将规则的 `fogShaderPack` 改为独立 `fog_shaders-ptr`。缺这个目录或任一配对输入就失败，不静默回退 Retail Fog。
- 未验证状态会由公共 `assertShaderProfileSupported` 阻止 HD／DE 的配置资源写入、着色器开关和启用 MOD 的游戏启动。已有 `.quenching-shader-pack` 标记相同也不能绕过检查。游戏启动在未验证情况下给出明确错误；用户可关闭 MOD 后使用原版渲染。SD 不安装这些 HD／DE shaders，不受此 shader ABI 门禁限制。MOD 开关本身没有增加完整包／所有权要求。
- `resolveModProfile` 仍是可读取的解析操作，不会因为未验证而让设置读取整体抛错；兼容状态随 profile 明确返回。`getShaderResourcePath` 在提供可安装路径前也会检查。

主要门禁位置：`asset-sync.ts` 的 `syncLightingResources`／`syncProfileResources`，`shader-handlers.ts` 的统一当前 profile 解析，`game-launcher.ts` 的启动前同步（标记比较之前），以及 Fog 写入函数。

## Fog 链路复核与局部修复

Fog 任务已经接通 `postProcessingOutline` 的 UI、hook、类型、preload、IPC、配置保存／默认 false 和八语言文案，本任务保留这些改动，没有重做界面或变更设置存储位置。

本任务修复／补充：

1. `fog-shader-override.ts` 先解析并检查 Fog、volumetricfog、terrain、cliff 四个配对输入，再删除关闭的物体 shader 或复制目标。缺少配对文件不再先删掉原有 `hd.bls`。这属于输入预检，不宣称所有直接 IPC 文件写入都已变成全目录原子事务；启动资源同步仍沿用原暂存／目录交换回滚。
2. `objectShader=false` 时保持原生身份写入器，与 `postProcessing=false` 时移除该依赖的组合一致。物体关闭／后处理关闭 IPC 不再先重复删除文件再检查，而由同一受控应用入口处理。
3. 后处理阴影与辉光各自开关，Intel／AMD bloom 修复不复活已关闭的辉光；描边只选择 Fog 变体，不控制辉光。
4. `shader-bundle.ts` 只为 PTR 额外允许展开 `fog_shaders-ptr` 前缀，仍不展开未选择的 Retail shader pack。实际没有独立 PTR Fog 时不创建／伪造该资源。

## 本次执行的验证

以下均通过，安装写入只发生在独立临时目录：

```text
node --import tsx scripts/test-ptr-shader-compatibility.ts
node --import tsx scripts/test-fog-shader-override.ts
node --import tsx scripts/test-shader-301.ts
node --import tsx scripts/test-startup-rendering-files.ts
node --import tsx scripts/test-startup-rendering.ts
node --import tsx scripts/test-battle-net-integration.ts
node --import tsx scripts/test-post-processing-config.ts
node scripts/check-i18n.mjs
node --import tsx scripts/webpack.build production
```

- 覆盖精确构建许可、前缀／未知／旧读数／未来构建拒绝、手选旧版本不降低 PTR 档位、独立 PTR HD／DE 目录、现有标记不绕过启动许可。
- 未验证用例：`2.0.4`、`3.0.0.24268`、下一构建 `3.0.1.24369`、`3.0.2.1`、`4.0.0.1`、空版本。开关 IPC 的开启／关闭分支、光照同步、启动前检查均拒绝；逐文件哈希证明当前 PTR 和另一 Retail 分支着色器保持不变。
- 人工的未来规则／小型假资源仅测试 `fog_shaders-ptr` 路由、ZIP 选择性展开、缺配对保护、不回退 Retail，不代表真实未来版本已兼容。
- 真实现有 ZIP 的隔离安装与 Fog 变体、HD／DE、RPG／battle、亮度不改变 AO、后处理与辉光独立、身份写入器、缺输入保护、目录交换失败回滚通过。
- 启动／战网回归使用模拟进程，日志中的 `Launching` 不是真实启动游戏。没有启动客户端 UI。
- 八语各 1315 键，缺键／重复／参数不一致为 0；生产 webpack 构建完成。共享 PTR 策略／profile 两文件另做严格语义类型检查通过。未把全仓历史 TypeScript 错误算作已修复；未做全仓 tsc，也未宣称 UI 跨重启实机验收。

测试开始时发现两项夹具不再符合新策略（缺少新导入的 marker mock；旧断言还期待 PTR 走 Retail pack），已修正夹具并重跑通过，没有为通过测试取消门禁。

## 未来 PTR 如何维护

1. 先记录真实完整 PTR 构建号，验证其原生格式、Fog 和 terrain/cliff 身份协议、HD／DE、标准／对战／RPG、开关组合及目标 GPU。不能凭版本号升高或 UI 手选认定兼容。
2. **同一活动格式确实兼容新构建**时，才把完整构建号添加到该规则的 `builds`；目录仍为独立 PTR pack。
3. **不兼容的新活动格式**：更新 `shaders-ptr-hd/de`；需要时提供 `fog_shaders-ptr` 的四套 Fog 和 `identity_writers`，再替换当前规则 ID／构建列表和 Fog 入口。不要把旧规则留着授权新字节给旧构建；这里只支持一个活动 PTR 格式，不维持多套历史 PTR ABI。
4. 新资源字段／模型逻辑档位若超出现有 `v301` 含义，必须单独扩展并测试，不能只改数字或关闭检查。本次独立入口解决资源演进，不是未来 ABI 的通用转换器。
5. 依次运行上述回归和代码构建，核对资源 ZIP 中的目录与散文件；最后在对应 PTR 实机测试。本次保留到 3.7，发布／打包／真实游戏应用须另行授权。

Fog 任务另行报告其构建脚本 `D:/Quenching/QM/shaders/03_Scripts/unified_shader_suite/build_official_fog_profiles.py` 已默认保留 PTR，只在显式 `--sync-compatible-ptr` 且 PTR／Retail 输入全文件哈希一致时联动更新，否则拒绝；三种分支的临时目录测试由该任务执行。本任务未修改或重复运行该资源编译脚本。

## 留到 3.7 验收

3.7 冻结打包前必须重新核对届时的实际 PTR 完整构建号并按上节复验；`24368` 不是永久许可，也不能把过时许可表原样带进新发布。待真实客户端 UI 操作、设置保存并重启、真实 PTR／Retail 游戏内效果、各 GPU 实机和未知版本提示体验验收。当前 build 许可依据用户兼容说明与本机版本记录，不把离线 GPU 创建通过夸大成游戏内验证。私有发布工具、官网门禁和自动更新清单未修改。
