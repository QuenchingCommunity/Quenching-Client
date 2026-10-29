# 光照设置分组与单位角度

2026-10-28 按用户最新要求完成源码修改与生产编译，暂缓重新打包新界面。

## 界面

- 水面效果从“画面设置”移至“游戏设置”，完整包／DE／SD／MOD 状态限制沿用原逻辑。
- 左侧新增“光照设置”，分成四张卡片：旋转光照单开关、光照类型（标准／RPG／对战）、亮度 1–5、光照角度 0–360°。
- 角度提供滑块和数字输入；拖动结束或输入框失焦后提交一次，不在拖动的每个刻度同步资源。
- 八种语言均补齐标题与说明。旧配置没有角度时保留原模型方向，界面以 45° 为默认参考；选择后持久化，不被模式预设覆盖。

## 单位角度与旋转

沿用 `src/shared/dnc-rotation.ts` 的 XYZW 四元数约定，对世界 Z 轴做水平旋转。0°／360° 同向，保留原仰角及局部 roll。普通单位光照按其游戏 06:00 方向对齐角度，保留整条轨迹的相对变化；旋转光照以所选角度为 06:00 起点，昼夜环绕一周并保留 DE 的仰角变化。

角度只写所选版本源目录中已知的 unit MDL，不修改 terrain、shader、植被、水面或玩家额外文件。旋转实验仍只覆盖原有四个地表单位模型，地下和地下城不参加旋转；关闭旋转从当前版本和角度生成静态／普通轨迹，不退回忽略所选角度的方向。

单独调整角度走 `mdl:update-lighting-angle`，通过 DNC 队列和原子替换提交；全部写入成功后保存配置，失败恢复已写文件。MOD 关闭时只保存选择。启动、切版本、切光照或亮度同步均带上同一角度。

对战 terrain 的 `0: { 0.25, 0.25, 0.75, 0 }` 仍由独立逻辑控制；普通模式恢复源 terrain，角度控件不会覆盖它。

## 主要文件

- `src/Renderer/components/MainWindow/SettingsModal.tsx`：分组、四张卡片、角度控件。
- `src/Renderer/hooks/useWar3Settings.ts`、`src/Main/preload.ts`、`src/types/electron-api.d.ts`：配置保存和 IPC。
- `src/shared/dnc-rotation.ts`、`src/Main/services/dnc-lighting.ts`、`rotating-lighting.ts`、`asset-sync.ts`、`src/Main/ipc/mdl-handlers.ts`：角度运算、单位写入、旋转起点、正常同步。
- `src/Renderer/utils/i18n/locales/`：八种语言文案。

## 验收

- `test-unit-light-angle.ts`：通过；0／45／90／180／270／360°、仰角保留、06:00 旋转锚点、闭合周期、111 个模型／模式组合、仅改单位旋转、旋转关闭后保留角度。
- `test-graphics-settings-transition.ts`：通过；真实组件服务端渲染验证分组、控件和禁用条件，角度独立保存、失败保留原配置。
- `test-startup-rendering-files.ts`：通过；Retail／PTR 实际 IPC、旋转中的角度更新、普通同步后保留角度、非法值拒绝、MOD 关闭只保存、terrain／shader 不受角度影响。
- `test-rotating-lighting.ts`：通过；原有 721 个独立插值方向、06:00 起点、27 个组合、关闭恢复和失败回滚继续成立。
- 国际化检查：八种语言各 1338 个键，无缺失／重复键或占位符不匹配。
- `node --import tsx scripts/webpack.build production`：通过，preload／renderer／main 全部完成，总计 48.90 秒。未为本轮新界面重新打客户端包。
- 未进行 Warcraft 游戏内画面实测。

## 便携格式与旧候选

用户明确改用 7z。Windows 新标准导出入口为 `scripts/export-win-portable.mjs`，`yarn run export:win`；构建并导出可用 `yarn run dist:win:7z --test-base <独立测试地址>`。私有旧入口 `_irys/export-win-test.mjs` 只转发；新入口拒绝 `.zip` 输出。Mac 导出与 workflow 改为 `.tar.7z`，PAX 中保存签名 App 的链接、权限、ACL 和扩展属性；Mac 实机打包尚未验收。MOD 历史 ZIP 协议及上游 Electron 原始下载继续按原协议读取。

新导出工具通过原生压缩、Unicode、根目录更名、CRC、内容比对、源保留和输出保护测试。此前已经打包的 HDR／terrain 修正版改为 7z，大小 196,635,619 字节，对比同内容 ZIP 的 263,946,876 字节缩小约 25.5%；其 SHA-256 为 `c92d8592a6518f05fcf2fcf32221316c15ac1ba0951c5328772368d473c70c33`。该归档位于 `__Bin/QMC-3.7-TEST-Win-x64-terrain-hdr-20261028.7z`，尚不包含本文的新设置界面。

用户要求移入回收站后，以下旧候选已成功回收：

- `_tmp/battle-terrain-package-20261028/builder/`
- `__Bin/QMC-3.7-TEST-Win-x64-terrain-20261028.zip`
- `__Bin/QMC-3.7-TEST-Win-x64-terrain-hdr-20261028.zip`

未清空回收站。当前保留的 7z 和 `builder-hdr` 是上轮可对照候选，不作为新界面的交付。
