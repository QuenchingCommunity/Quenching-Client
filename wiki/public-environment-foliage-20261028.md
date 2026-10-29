# 公共环境与独立植被包组合

`env-20-30-public.zip` 已移除 foliage，当前仅有 `sky` 和 `environmentmap`（6 个文件）。客户端在公共环境首次安装、强制刷新和从 DE 恢复时，按本次传入的设置补装独立植被包。

- 植被开启：地形 `latest`、`decisive`、`v30`、`t30` 使用 `zip-foliage-que.zip`；其他非复古地形沿用 `zip-foliage-other.zip`。
- 植被关闭或地形为 `retro`：移除活动 foliage，不解压植被包。
- 普通光照切换：公共环境已经就绪且 foliage 存在时不重复解压；即使公共环境标记已存在，缺失的 foliage 仍会补装。
- DE 不使用公共环境时仍沿用原有停放逻辑；恢复到 HD 后按当前设置重新选择植被，不直接沿用旧停放版本。
- 植被替换仍为检查源 ZIP 存在后删除活动目录，再完整解压；不把活动目录改名，不使用来源标记跳过明确刷新。独立植被同步与环境停放／恢复共用原有目录队列。

代码入口为 `asset-sync.ts` 的公共环境同步，以及 `foliage-service.ts` 的 `syncPublicEnvironmentFoliage`。公共环境完成标记在组合成功后写入。使用同一次传入的 `quenchingDir`，不另行猜测资源源目录。原有客户端文件清理清单已包含两个植被 ZIP，无需修改其所有权规则。

本次测试：

- `test-foliage-sync.ts`：植被包选择、默认设置、缺失修复、关闭／复古、缺包保护、光照切换不重解压，以及原有删除重解压／队列／锁失败回归通过。
- `test-startup-rendering-files.ts`：公共环境测试包不含 foliage，验证真实组合、Retail/PTR、HD/DE/2.x、恢复时使用新配置及已有标记下补装通过。
- `test-environment-layout.ts`、`test-graphics-settings-transition.ts`：通过。
- `npm run build`：生产构建通过，webpack 总计 34.72 秒，着色器包校验复用且摘要不变；日志保存在 `_tmp/public-environment-foliage-20261028/build.log`。

本次没有直接修改玩家目录，没有修改资源包内容或上传发布。
