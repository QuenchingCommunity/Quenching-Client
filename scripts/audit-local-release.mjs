// Offline audit of active build identity. Historical packages and genuine
// installed MOD/update baselines are reported separately, never relabelled.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { prepareReleaseAssets, updateUiVersionText } from './prepare-release-assets.mjs';
import { releaseLabel } from './lib/release-label.mjs';

const release = JSON.parse(await fs.readFile('release-version.json', 'utf8'));
assert.equal(release.channel, 'test');
assert.equal(release.displayVersion, '3.7');
const label = releaseLabel(release);
const checks = [];
await prepareReleaseAssets({ check: true, latestRoot: 'D:/Quenching/QM/Latest' });
checks.push('assets + Latest: WebUI, local-release.json, all 8 archived UIQUE labels');
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
assert.equal(pkg.version, '3.7.0');
const html = await fs.readFile('dist/renderer/index.html', 'utf8');
assert(html.includes(`Quenching Mod Client v${label}`), 'compiled browser title is stale');
checks.push('client internal version + compiled window/page title');
for (const filename of ['src/Renderer/components/MainWindow/index.tsx', 'src/Renderer/components/MainWindow/AboutModal.tsx']) {
  assert((await fs.readFile(filename, 'utf8')).includes('APP_VERSION'));
}
checks.push('Home / About / current client update label use shared build identity');
const gameRoot = 'D:/Quenching/War3Reforged/Warcraft III/_retail_';
const local = JSON.parse(await fs.readFile(path.join(gameRoot, '.quenching/local-release.json'), 'utf8'));
assert.equal(local.channel, 'test'); assert.equal(local.label, label);
for (const root of [gameRoot, 'D:/Quenching/QM/Latest']) {
  assert((await fs.readFile(path.join(root, '_patch/keep.que'), 'utf8')).includes(`// Local build: ${label}`));
}
assert((await fs.readFile(path.join(gameRoot, 'webui/index.html'), 'utf8')).includes(`Version ${label} By`));
let gameFdfFields = 0;
async function scan(folder) {
  for (const entry of await fs.readdir(folder, { withFileTypes: true }).catch(e => { if(e.code === 'ENOENT') return []; throw e; })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) await scan(file);
    else if (entry.name.toLowerCase() === 'commandbar.fdf') {
      const text = await fs.readFile(file, 'utf8');
      updateUiVersionText(text, label, true); // Also rejects invisible/unresolved version fonts.
      for (const match of text.matchAll(/String\s+"QuenchingVersionText"\s*\{([^}]*)\}/g)) {
        assert(match[1].includes(`Text "V${label}"`), `stale installed UI label: ${file}`);
        gameFdfFields++;
      }
    }
  }
}
await scan(path.join(gameRoot, 'ui'));
assert(gameFdfFields > 0, 'no game UIQUE label verified');
checks.push(`game WebUI + local identity + ${gameFdfFields} existing UIQUE version fields`);
const baseline = JSON.parse(await fs.readFile(path.join(gameRoot, '.quenching/installed-mod.json'), 'utf8'));
const historical = await fs.readdir('__Bin', { withFileTypes: true });
const report = { label, internalVersion: pkg.version, networkChanges: false, checks,
  installedModBaseline: { version: baseline.version, sequence: baseline.sequence, preserved: true },
  historicalArtifacts: historical.filter(e => /^QMC3\.[0-6](?:\D|$)/.test(e.name)).map(e => e.name),
  scope: 'Active local source/assets/Latest/game labels and rebuilt dist. Historical packages are not current candidates; MOD inventory and update baselines retain actual versions. No portable EXE or Mac package was rebuilt by this audit.' };
await fs.mkdir('logs', { recursive: true });
await fs.writeFile('logs/local-release-3.7-test-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
