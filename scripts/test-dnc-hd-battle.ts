import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { applyDncLighting, getBrightnessMultiplier } from '../src/Main/services/dnc-lighting';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
// Shader path checks are pure; isolate unrelated Electron/channel detection.
const bundled = await build({
  stdin: { contents: "export { getShaderResourcePath } from './src/Main/services/mod-profile';", resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external',
  plugins: [{ name: 'isolated-detection', setup(api) {
    api.onResolve({ filter: /\/(?:war3-version|game-channel)$/ }, () => ({ path: 'detection', namespace: 'test' }));
    api.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: "export const detectWar3Version=async()=>({parts:[3,0,1,24368],source:'fixture'});export const getSelectedGameChannel=()=> 'retail';" }));
  } }],
});
const isolatedModule = { exports: {} as any };
new Function('require','module','exports',bundled.outputFiles[0].text)(createRequire(import.meta.url),isolatedModule,isolatedModule.exports);
const { getShaderResourcePath } = isolatedModule.exports;
import type { ModProfile } from '../src/shared/mod-profile';

const hd = path.join(process.cwd(), 'assets', 'quenching', 'dnc', 'dnc30-hd');
const statics = (text: string, name: string) =>
  [...text.matchAll(new RegExp(`static\\s+${name}\\s+([\\d.-]+)`, 'gi'))].map(m => parseFloat(m[1]));
const intensityValues = (text: string): number[] => {
  const fixed = statics(text, 'Intensity');
  if (fixed.length) return fixed;
  const block = text.match(/^\s*Intensity\s+\d+\s*\{([\s\S]*?)^\s*\}/im)?.[1] || '';
  return [...block.matchAll(/\d+:\s*([\d.-]+),?/g)].map(match => Number(match[1]));
};
const withoutChangedFields = (text: string) => {
  let intensity = false;
  return text.split(/\r?\n/).filter(raw => {
    const line = raw.trim();
    if (/^Intensity\s+\d+\s*\{/i.test(line)) { intensity = true; return true; }
    if (intensity && /^\d+:/.test(line)) return false;
    if (intensity && line.startsWith('}')) intensity = false;
    return !/^static\s+(?:AmbIntensity|Intensity)\b/i.test(line);
  }).map(line => line.trim()).join('\n');
};
const round = (value: number) => Math.round(value * 100) / 100;
async function list(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await list(full));
    else if (entry.name.toLowerCase().endsWith('.mdl')) files.push(full);
  }
  return files.sort();
}

// Current DNC behavior is verified against all finalized HD/DE level-3 files.
await import('./test-dnc-level3');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dnc-shader-routing-'));
try {
  for (const shaderPack of ['shaders-300-hd', 'shaders-ptr-hd'] as const) {
    const profile = { graphics: 'hd', shaderPack, dncPack: 'dnc30-hd' } as ModProfile;
    for (const [lighting, folder] of [['standard', 'standard'], ['battle', 'melee'], ['rpg', 'rpg']]) {
      const actual = getShaderResourcePath(path.join(process.cwd(), 'assets', 'quenching'), profile, lighting);
      assert.equal(actual, path.join(process.cwd(), 'assets', 'quenching', 'shaders', shaderPack, 'ps', folder));
      assert.ok(await fs.pathExists(path.join(actual, 'hd.bls')), `${shaderPack}/${lighting}: shader exists`);
    }
  }
  for (const shaderPack of ['shaders-300-de', 'shaders-ptr-de'] as const) {
    const profile = { graphics: 'de', shaderPack, dncPack: 'dnc30-de' } as ModProfile;
    for (const lighting of ['standard', 'battle', 'rpg']) {
      assert.equal(getShaderResourcePath('Q', profile, lighting), path.join('Q', 'shaders', shaderPack, ...(lighting === 'battle' ? ['battle'] : [])));
    }
  }
  console.log('PASS: current HD/DE shader routing');
} finally {
  await fs.remove(root);
}
