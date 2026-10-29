# 测试版 Starter Map 离线入口

2026-10-29 按用户要求加入本地测试功能。当前内部版本 3.7.0、`release-version.json` 通道 test；本次只修改源码、编译和隔离验证，没有打包／上传，没有实际执行用户的 offline.exe 或启动 Warcraft III。

## 使用

Windows 测试客户端在“启动游戏”左侧显示“离线测试”。入口要求已选游戏目录和 Retail 分支。点击时检查游戏根目录的 `offline.exe`，检测游戏为 3.0.1；缺失程序、PTR、其他版本或提取失败均明确报错，不启动外部程序。不会自动下载、复制或内嵌此工具。

固定读取 CASC：`war3.w3mod:maps\(2)a_starter_map_losttemple_lv.w3x`，不是普通四人 Lost Temple，也不扫描玩家地图目录。仅点击时打开 CASC，读取这一份文件，关闭原生句柄；写到当前用户数据目录 `offline-test/(2)a_starter_map_losttemple_lv.w3x`，通过同目录临时文件替换，每次从当前安装读取，防止同名旧缓存影响测试。

实际检查用户根目录的工具随附代码确认支持：`offline.exe <地图绝对路径> --hd <1|2|3>`。1／2／3 对应当前 SD／HD／DE 选择，命令行覆盖工具自身 config 的画质，不改用户 config.txt。运行目录为游戏根目录，不经 Shell 拼接。外部程序脱离客户端进程保持运行。启动前复用普通游戏的资源准备逻辑，保留 MOD 开关与版本检查；原有 Battle.net／直接启动入口不变。

提示“已启动”代表操作系统成功创建外部进程，不代表游戏已进入地图；第三方工具后续运行状况仍需用户实机验证。

## 正式版排除

- 测试资格取自构建元数据 `release-version.json`，不因自动更新测试环境变量或本地测试通道标记改变正式客户端功能。
- 正式模式 `partial.webpack-conf.ts` 将 `offline-test-launcher` 替换成无功能模块，不注册离线 IPC，不带 CASC 地图启动实现。
- Preload 仅测试版提供离线调用接口；界面仅测试版 Windows 渲染按钮；后端仍重复检查测试版资格。
- `.gitignore` 忽略 offline.exe；Windows app／extraResources／statics、public 拷贝、Mac app／资源／statics 过滤此文件；资源构建器也拒绝将同名文件收入五个 7z。现有魔兽根目录程序保持原样。

## 验证

- 从本机游戏 CASC 实际读取地图 243,045 字节，SHA-256 `247ffb4836c265f4760a0907d43bbf04bdb6f6e716e1920bc4f46771fb109e30`；用 StormLib 确认存在 `war3map.w3i`。临时地图已清理，没有复制进 assets。
- `scripts/test-offline-starter.ts` 通过：测试版 IPC／正式版拒绝、固定 CASC 路径、三档画质参数、中文及特殊字符路径、根目录定位、缺失文件／CASC 失败／进程失败不误报。外部进程由桩替代，不执行真实工具。
- 实际正式配置 Webpack 替换验证通过：只对内存加载的测试元数据替换为 production，使用真实项目配置中的 NormalModuleReplacementPlugin 构建；结果不含离线 IPC、offline.exe 调用或固定地图实现。未改真实 release-version.json。记录在 `_tmp/offline-test-20261029/production-check.json`。
- `test-battle-net-integration.ts` 普通游戏／地图／战役 Windows、Mac、Retail、PTR 启动回归通过。
- `test-resource-packaging.mjs` 实际 Windows matcher 与 Mac 策略排除 offline.exe，通过；Mac 打包脚本语法检查通过。
- i18n 8 语言各 1345 键，缺失／重复／占位符检查通过。
- `yarn run build` 完成，85.85 秒（webpack 66.91 秒）。

临时检查、构建和验收日志在 `_tmp/offline-test-20261029/`。用户的程序没有进入 Git 跟踪，也没有进入本轮资源清单。实际进图和第三方工具持续运行需在本次代码的新测试客户端中人工验证，旧 `__Bin/win-unpacked` 尚不包含此入口。
