# 正式／TEST 构建开关

用户 2026-11-07 明确：正式 3.7 使用内部版本 3.7.0，不沿用独立 TEST 通道的 3.7.1～3.7.4 构建编号。Windows 本次不要求 Authenticode；自动更新 Ed25519 签名和 SHA-256 不变。

正式编译：`npm run build:production`。正式便携包：Windows 使用 `npm run dist:win:production`，Mac 在对应架构机器使用 `npm run dist:mac:production`。TEST 编译使用 `npm run build:test`。

开关写入 `release-version.json.channel`，标准资源准备链生成相同通道的 UIQUE、HTML、身份文件和五个资源 7z。正式编译将 TEST 标记初始化、测试地址选择和离线启动实现替换为空入口；编译固定测试标记为关闭，删除预览地址／测试公钥／测试基线等环境覆盖。下载、签名、版本判断、事务、健康确认和回滚继续共用原实现。

正式 renderer／preload 移除离线启动按钮及 IPC，正式语言包和样式也剔除该入口。正式 preload 使用 production 优化，避免只保留条件隐藏、仍打包测试 IPC 字符串。`check-production-build.mjs` 检查编译输出和构建身份；Windows beforePack 和 Mac 打包器也执行检查。包外测试标记、缓存、运行事务由既有便携导出检查拒绝。

`test-build-channel.mjs` 实际编译两种开关：正式包即使继承 TEST 环境也保持正式选择，TEST 仍能使用独立 `version-test.que`；同时验证八种语言与样式清理、正式产物检查拒绝残留 IPC。纯净 TEST 基线必须来自完整 TEST 编译，不能给正式包加一个标记冒充 TEST。
