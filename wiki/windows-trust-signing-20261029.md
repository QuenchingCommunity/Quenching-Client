# Windows 发布者信任与原生模块签名

2026-11-07 用户明确允许本次及当前流程生成未签名 Windows 正式包，不再将 Authenticode 身份作为正式构建必需输入。显式 forceCodeSigning 仍生效；如配置身份则保留原生模块签名、ASAR 维护及签后检查。自动更新清单 Ed25519 验签与文件 SHA-256 继续强制执行。下文为 2026-10-29 的调查与当时流程，关于正式版必须有证书的要求已被此次用户约定替代。

用户要求先提交当前版本，已建立修复前基线 `82a96cf`（3.7 TEST）。没有推送；本地日志、实验产物、私有工具和 offline.exe 未进入此次提交。本次签名修复在其后工作区进行。

## 原因与边界

截图为加载 `@jamiephan+casclib.node` 时无法确认发布者，与 Smart App Control／代码完整性拦截一致；最终策略需受影响机器的 CodeIntegrity 日志确认，不能把所有 Windows 提示统一视作病毒误报。

本地检查 QMClient.exe、CascLib 和 StormLib .node 均未签名。原 electron-builder 规则没有将 .node 纳入签名。本机没有可用代码签名私钥证书，没有配置 CSC／云签名身份。自动更新清单密钥不能替代 Windows Authenticode 代码签名。

微软要求有效且来自受信任提供者的代码签名身份，见 [Smart App Control 说明](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control)。开发机自签名／本地信任不能证明玩家机器也信任。代码签名也不能保证 SmartScreen 声誉提示或 Defender 检测立即消失。

## 构建修复

- 确认本地 electron-builder 25.1.8 支持 signExts，新增 .node／.dll，与原有 EXE 一同处理，签名算法 SHA-256。
- Windows x64 包排除 Linux、Mac 及其他 Windows 架构原生模块。
- beforePack 根据真实 release-version.json 强制正式 Windows 包 forceCodeSigning。缺少签名配置就失败；TEST 可本地构建，但明确提示未签名风险。直接 electron-builder 也经过该入口。
- 接受当前 builder 支持的 CSC_LINK／WIN_CSC_LINK、signtoolOptions 文件证书／Windows 证书选择器、azureSignOptions 或签名钩子；不输出凭据。
- afterPack 只对打包输出中的 unpacked 原生 PE 签名，不签源 node_modules。签名会改变大小和摘要，因此重建实际签后 ASAR，验证原 unpacked 集合、大小与 SHA-256，更新尚未签名的主 EXE 内 ASAR 完整性资源，再由 builder 签主 EXE。
- 对已签 unpacked 文件防止后续重复签名，避免时间戳变化再次使 ASAR 过期；没有关闭或放松原有完整性检查。
- afterSign 检查所有 PE 文件的 Authenticode 状态 Valid 及时间戳，再验证 ASAR。PowerShell 子进程隔离 PS7 的模块路径，兼容 Windows PowerShell 5，不修改执行策略。

全部检查只在构建／发布验收中执行，不增加正常客户端启动和资源解压成本。签名后才生成便携归档、自动更新快照及差分，不能复用签名前哈希。

## 验证与尚缺条件

- `test-windows-signing.mjs` 通过：正式无身份拒绝、配置识别、原生签名范围、签后 ASAR 记录、packed 内容保持、源输入保持、防重复签名；使用模拟字节附加验证签后结构，真正 Windows 信任检查明确拒绝该伪签名。不能将其视为可信证书的实签验收。
- `test-win-package-files.mjs`、`test-resource-packaging.mjs`、`test-resource-bundle.ts` 通过。
- 实际 `yarn dist:win` TEST 成功，155.28 秒；日志确认 Windows .node／DLL 进入签名处理，因无证书而跳过实签。
- 新产物 44 个 ASAR 外文件的大小／SHA-256 通过；实际 QMClient.exe 进程加载 CascLib、StormLib 通过；Linux .node 已排除。
- 实际信任检查：1 个 Valid、14 个 NotSigned。当前产物仍是未签名 TEST 候选，不能宣称玩家拦截已消除。

还需取得可信代码签名身份，真实签名并在开启 Smart App Control 的干净 Windows 中验收。本次未创建证书、未购买服务、未上传客户端、未修改线上更新门禁。

另有 Defender／SmartScreen 具体检测时，应收集产品、检测名称、具体文件及 SHA-256，再针对最终签名产物走 [微软开发者文件分析入口](https://www.microsoft.com/en-us/wdsi/filesubmission)。本次未提供病毒检测名称，也没有擅自提交文件。

构建／测试／未签名产物记录在 `_tmp/windows-trust-20261029/`；签名成功构建报告输出到 `_tmp/windows-signing/signature-report.json`。签名身份通过安全的本地环境配置，不发送私钥或密码到聊天。
