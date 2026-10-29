# Latest 唯一资源源目录（2026-10-24 修订）

完整包／MOD 新版本的资源字节只读取 `D:/Quenching/QM/Latest`。Latest 同时是独立 Quenching-Assets Git 工作区，历史资源按发布 commit/tag 读取；小型清单用于验证，确需正式 ZIP 中的文件时按哈希从 Release 取回，不要求常驻保存旧包／旧树。这些旧输入都不是新版本内容的回退源。客户端自身 assets 与应用代码不在本次源目录调整范围内。

发布按 [测试优先流程](test-first-workflow.md) 的 A／B／C 和两次人工验收执行：A 的本地测试包已通过后才制作 B 测试更新，B 通过后才制作 C 正式大包。资源历史留在 Git，不额外冻结一整份旧树。

## 当前完整包基准（2026-10-27）

用户确定 Latest 的默认资源基准为 **HD、魔兽 3.01、标准光照、亮度 3**。`_manual/` 已退役，不再随完整包维护或由同步工具重建；其他版本／画面／光照资源由客户端 assets 按实际选择管理。不得把客户端全部 shader 档位直接铺到完整包默认目录。

`scripts/sync-full-package-assets.mjs` 默认只读检查，`--write` 只同步已声明的默认资源映射；若 `_manual/` 仍存在会拒绝，而非自动删除。差异原件暂存在 `_tmp/latest-resource-sync-<任务>/`，验证通过后回收可再生中间文件。`scripts/audit-full-package-hd.mjs` 核对标准着色器、最终亮度 3 的 DNC、公共环境及其它映射，并要求 `_manual/` 不存在。本次基准另经实际 shader/DNC 应用函数在隔离目录验证，不能将这个文件核对当作真实游戏视觉验收。

## 准备候选

私有工具仍在忽略 Git 的 `_irys/`。明确新的内部版本及递增序号，不用不同资源复用已发布版本。

```text
node --import tsx _irys/prepare-mod-latest.ts
  --from PREVIOUS-OFFICIAL.files.json.gz
  --version NEW-VERSION --sequence NEW-SEQUENCE
  --output _irys/releases/NEW-CANDIDATE
  --sync-latest-metadata
```

该入口直接扫描 Latest，生成小型官方快照、增改删报告、前版快照和 `_patch` 元数据，不复制资源树、不上传或部署。`--sync-latest-metadata` 备份并同步生成的版本标记及清单到 Latest，不改游戏资源。编辑中的 Latest 允许有未发布改动；标记记录最后发布／候选版本，并不证明工作内容仍与该版一致。不要将有未发布改动的工作目录当原正式版分发。

只检查而不选择新版本时：`--audit --from PREVIOUS-OFFICIAL.files.json.gz --output NEW-PRIVATE-AUDIT-DIR`。审计模式记录待发布差异，不改 Latest 或生成正式版本元数据。

## 使用同一源打包

自动版本 ZIP 使用 `_irys/build-mod-zip.ts`，`--root D:/Quenching/QM/Latest`，其余参数为前版／候选快照、前版签名链、不可变下载根和现有签名密钥。生产拒绝其他源目录；`--fixture` 只用于隔离发布器测试，不用于实际发布。

A 阶段按人工安装测试实际需要制作本地测试包；C 阶段才制作正式完整 A／B 和手动差异包：

```powershell
$env:QUENCHING_RELEASE_DIR = '_irys/releases/NEW-CANDIDATE'
node _irys/package-full-36.mjs
```

尽管文件名沿用旧版，这个打包器从 `preparation.json` 读取版本／序号，所有资源直接读取 Latest，生成的标记／清单读取本次候选元数据。拒绝 `QUENCHING_MOD_BASE_ROOT` 和非 Latest 的生产源覆盖。准备后 Latest 变化就重新准备候选，不从旧目录补齐被删除文件。校验生成 ZIP 的实际内容与本次清单一致，不额外解压整套测试副本。

## 保留与清理

保留 Git commit/tag 与发布版本映射、小型官方快照／签名索引、URL／哈希、验收记录和凭据；仍被签名索引引用的远程 ZIP 保持兼容。旧本地 A／B、客户端 ZIP、解压树和可重取对象缓存按需使用后可回收，不要求每版常驻。人工验收期间不清理用户测试安装。现存缓存的实际清理另按本次任务范围执行。

`_irys/read-published-mod-resources.mjs` 是历史 3.6.1 回归读取器，当前实现仍从本地 A／B 取指定旧文件，不被生产打包器调用；需要运行时可按记录的 URL／哈希临时取回输入，这不是要求永久保留 A／B。Git 补齐准确的 3.6.1 资源提交后应改为按该 commit 读取对应 blob，不能直接把当前 HEAD 当作它。旧的完整树生成／修改脚本 `prepare-36-input.mjs`、`freeze-latest-361.ts`、`prepare-mod-362.ts`、`include-t20-resource-revision.mjs`、`build-36-manual-mod-overlay.mjs` 已归档并在运行前报错退出。旧发布证据中的资源路径是历史记录，不是活跃配置。

验证入口：`node _irys/test-mod-latest-source.mjs` 和现有 MOD ZIP 回归。清理前后，用真正的 Latest 审计证明资源没变、主动删除没恢复。本轮工具整理不授权新发布或线上清单切换。
