import fs from 'node:fs/promises';
import path from 'node:path';
import { resourceArchiveDescriptors } from '../src/shared/bundled-resource-paths.mjs';

const root = path.resolve('.');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'assets/quenching/resources.manifest.json'), 'utf8'));
const archives=resourceArchiveDescriptors(manifest);
const archiveBytes=archives.reduce((sum,a)=>sum+a.size,0);
const roles = {
  camp: ['使用中', '战役解锁及自定义战役模板', 'game-launcher.ts; campaign-w3n-merge.ts'],
  dnc: ['使用中', '版本／画质／昼夜光照模型', 'mod-profile.ts; dnc-lighting.ts'],
  experimental: ['构建输入', '旋转单位光照实验数据', 'rotating-lighting.ts'],
  shaders: ['使用中', '2.04／3.0／3.01／PTR 独立着色器及效果依赖', 'mod-profile.ts; fog-shader-override.ts; shader-bundle.ts'],
  skin: ['使用中', '单位／树木与版本皮肤模板', 'unit-skin-profile.ts; destructable-skin-profile.ts'],
  tile: ['使用中', '地形／悬崖／水面配置', 'terrain-handlers.ts; water-assets-service.ts'],
  tx: ['使用中', 'WebUI 中英文图片、英雄光晕', 'webui-assets-service.ts; glow-handlers.ts'],
  water: ['使用中', '真实／透明水面及岸线资源', 'water-assets-service.ts'],
  'TrajanPro3-Regular.otf': ['构建输入', '客户端字体，由 webpack 输出到 renderer 资源，启动无需提取 7z', 'Renderer/styles/fonts.less'],
};
const candidates = new Map([
  ['camp/c0.w3x', '未发现当前战役启动入口使用；保留归档'],
  ['camp/campaigninfoclassic.txt', '未发现当前客户端读取；保留归档'],
  ['camp/campaigninforeforged.txt', '未发现当前客户端读取；保留归档'],
  ['skin/unitskin.txt', '当前源模板为 unitskin-new/old/sd/de，不是此旧文件'],
  ['skin/half.que', '旧单位缩放文件，当前代码不读取'],
  ['skin/foliage-old.txt', '植被已使用独立资源组，未发现读取此旧表'],
  ['skin/foliage-que.txt', '植被已使用独立资源组，未发现读取此旧表'],
  ['skin/destructableskin-old.txt', '当前版本选择器不选择此旧模板'],
  ['skin/destructableskin-que.txt', '当前版本选择器不选择此旧模板'],
  ['tx/Qcustom9_BG.png', '未发现当前客户端读取'],
  ['tx/icon_halo.png', '未发现当前客户端读取；英雄光晕使用 heroglow_bw.dds'],
]);
const rows = [];
for (const [file, data] of Object.entries(manifest.files)) {
  let role = roles[file.split('/')[0]] || ['未发现运行时引用', '旧文件／随附文档，保留供回退，无当前功能调用', 'src/Main + src/Renderer 引用检查'];
  if (file.startsWith('packages/')) {
    const group = file.split('/')[1];
    role = group === 'zip-blight-retro' ? ['兼容清理', '原资源变体用于已知文件所有权，当前开关不选此效果', 'client-mod-files.ts']
      : ['使用中', `逻辑资源组 ${group}，按功能提取`, 'bundled-packages.ts; UI/植被/环境/腐地/地形服务'];
  }
  if (file.startsWith('dnc/dnc30-de-rpg/')) role = ['兼容清理', '当前 DE 不选独立 RPG DNC；保留旧路径所有权与维护输入', 'mod-profile.ts; client-mod-files.ts'];
  if (candidates.has(file)) role = ['未发现运行时引用', candidates.get(file), 'src/Main + src/Renderer 引用及选择器检查'];
  rows.push({ file, archive: data.archive || manifest.archive?.name, size: data.size, status: role[0], purpose: role[1], evidence: role[2] });
}
const groups = new Map();
for (const row of rows) {
  const name = row.file.startsWith('packages/') ? row.file.split('/').slice(0, 2).join('/') : row.file.split('/')[0];
  const value = groups.get(name) || { files: 0, bytes: 0 };
  value.files++; value.bytes += row.size; groups.set(name, value);
}
const unused = rows.filter(row => row.status === '未发现运行时引用');
const evidenceDir = path.join(root, 'wiki/evidence'); await fs.mkdir(evidenceDir, { recursive: true });
const csv = value => '"' + String(value).replaceAll('"', '""') + '"';
await fs.writeFile(path.join(evidenceDir, 'quenching-resource-files-20261028.csv'), '\uFEFF' +
  ['路径,资源包,字节数,状态,用途说明,依据', ...rows.map(row => [row.file, row.archive, row.size, row.status, row.purpose, row.evidence].map(csv).join(','))].join('\n') + '\n');
const summary = { schema: manifest.schema, id: manifest.id, archives: Object.fromEntries(archives.map(a=>[a.name,a])), files: rows.length,
  sourceBytes: rows.reduce((n, row) => n + row.size, 0), unusedCandidates: unused.length, unusedCandidateBytes: unused.reduce((n, row) => n + row.size, 0),
  groups: Object.fromEntries(groups), bootstrap: ['1.ico', 'logo.png', 'update-public-key.pem', 'update-baselines/', 'index.html', 'local-release.json', 'PostProcessingConfig.txt'] };
await fs.writeFile(path.join(evidenceDir, 'resource-bundle-20261028.json'), JSON.stringify(summary, null, 2) + '\n');
const doc = [
  '# 淬火客户端资源盘点与统一 7z 流程', '',
  '本次按 `assets/quenching` 原资源、当前源目录和实际客户端调用核对。源资源现在位于 `assets/unpacked`；原 ZIP 已展开为 `packages/<原 ZIP 名去扩展名>/`，版本与样式同名文件彼此隔离。动态读取的贴图／模型按资源组确认，不把“没有逐文件字面量引用”误判为不用。', '',
  `统一包含 ${rows.length} 个文件，展开源 ${summary.sourceBytes.toLocaleString('en-US')} 字节，7z ${archiveBytes.toLocaleString('en-US')} 字节。资源按固定素材种类分成五个独立 7z，不是分卷；每包使用独立文件流以支持只提取请求项；未变化构建验证源摘要后复用，源有变化时只重压变化文件并移除已删除成员。`, '',
  '| 独立资源包 | 压缩字节数 |', '| --- | ---: |', ...archives.map(a=>`| ${a.name} | ${a.size.toLocaleString('en-US')} |`), '',
  '| 资源组 | 文件数 | 展开字节数 |', '| --- | ---: | ---: |',
  ...[...groups].map(([name, value]) => `| ${name} | ${value.files} | ${value.bytes.toLocaleString('en-US')} |`), '',
  '## 启动必须直接可读的内容', '',
  '`1.ico`（Windows 窗口／托盘／打包图标）、`logo.png`（Mac/Linux）、更新公钥、历史基线及少量基础配置／WebUI 文本保留在 `assets/quenching`。缺少 logo 时统一准备入口从 `public/logo.png` 补齐。字体是 webpack 构建输入，编译输出随 renderer 分发，不等待游戏资源解压。`assets/fonts`、`assets/images`、更新助手和原生 7-Zip 工具继续直接分发，不属于待展开的游戏资源。', '',
  '## 未发现当前运行时读取的候选', '',
  '以下保留在展开源及五包中，没有删除；首次完整展开也会包含这些文件，但未发现当前功能读取。随附文档／旧 .NET 文件与已废弃效果模板分开列出；需要精简时可按此清单单独审阅。', '',
  '| 文件 | 展开字节数 | 依据／用途判断 |', '| --- | ---: | --- |',
  ...unused.map(row => `| ${row.file} | ${row.size.toLocaleString('en-US')} | ${row.purpose} |`), '',
  '`dnc30-de-rpg` 和 `zip-blight-retro` 属于兼容清理资料：当前视觉选择器不启用，但仍用于识别客户端已知路径，因此未直接删除。`.vs` 等开发目录不进入资源包。', '',
  '## 命令与运行期', '',
  '`yarn run electron`、`start`、`build`、`pack` 共享 `scripts/prepare-client-assets.mjs`；所有 `dist:*` 经公共构建入口，直接 electron-builder 也有 beforePack 检查。并发 dev 命令共用跨进程锁；中断后可恢复过期锁。旧 `prepare-shader-bundles.mjs` 仅转发统一入口，不再生成独立 shader ZIP。', '',
  '先显示窗口，首屏绘制后再准备资源。没有展开文件时完整展开并显示现有全局进度弹窗；已有文件时后台静默检查，按内容替换不同文件。Windows 缓存位于 EXE 同级 `unpacked/`，macOS 位于 .app 同级；跨版本复用未变化文件，不进入自动更新官方快照和便携导出包；同卷 `_tmp` 暂存后提交，失败恢复旧缓存。正常启动不重复读取整包和整棵缓存树计算 SHA；只检查内容记录及文件元信息，未知或外部改动文件才单独算摘要。旧客户端遗留 ZIP 不覆盖新清单中的资源组。', '',
  'Windows 和 Mac 分发规则均排除整个 `assets/unpacked`、原始资源目录和独立旧 ZIP，只带五个 `resources-*.7z`、清单及启动必需小文件。本次没有生成客户端便携包、上传或发布。', '',
  '完整逐文件盘点见 [CSV](evidence/quenching-resource-files-20261028.csv)，内容 ID／大小／SHA-256 见 [元数据](evidence/resource-bundle-20261028.json)。原资源迁移及旧版备份记录在 `_tmp/resource-bundle-20261028/relocated.json`。', '',
];
await fs.writeFile(path.join(root, 'wiki/quenching-resource-inventory-20261028.md'), doc.join('\n'));
console.log(JSON.stringify({ files: summary.files, sourceBytes: summary.sourceBytes, archiveBytes, unusedCandidates: unused.length, report: 'wiki/quenching-resource-inventory-20261028.md' }));
