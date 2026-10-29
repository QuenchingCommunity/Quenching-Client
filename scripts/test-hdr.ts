import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';
import { applyShaderToggles, supportsHdr } from '../src/Main/services/fog-shader-override';
import { shaderPixelFolder } from '../src/shared/shader-variant';
import { resolvePtrShaderCompatibility } from '../src/shared/ptr-shader-compatibility';
import { resourcePath } from '../src/shared/bundled-resource-paths.mjs';

const parent = path.resolve('_tmp/resource-bundle-20261028'); await fs.ensureDir(parent);
const root = await fs.mkdtemp(path.join(parent, 'hdr-'));
const quenching = path.resolve('assets/quenching');
try {
  for (const pack of ['shaders203', 'shaders-300-hd', 'shaders-300-de', 'shaders-ptr-hd', 'shaders-ptr-de', 'shaders-300-legacy-hd', 'shaders-300-legacy-de'] as const) {
    const profile = { graphics: pack.endsWith('-de') ? 'de' : 'hd', shaderPack: pack,
      ...(pack.startsWith('shaders-ptr-') ? { ptrShaderCompatibility: resolvePtrShaderCompatibility({ parts: [3,0,1,24368], source: 'build.info' }) } : {}) } as const;
    for (const lighting of ['standard', 'battle', 'rpg']) for (const hdr of [false, true]) for (const postProcessing of [false, true]) {
      const target = path.join(root, pack, lighting);
      await fs.outputFile(path.join(target, 'ps/tonemap.bls'), 'stale');
      await fs.outputFile(path.join(target, 'ps/fog.bls'), 'shadow');
      await fs.outputFile(path.join(target, 'ps/volumetricfog.bls'), 'shadow');
      await fs.outputFile(path.join(target, 'ps/bloomextract.bls'), 'glow');
      await applyShaderToggles(target, quenching, profile, { lighting, hdr, postProcessing, postProcessingGlow: true });
      const tone = path.join(target, 'ps/tonemap.bls');
      assert.equal(await fs.pathExists(tone), hdr && supportsHdr(profile), `${pack}/${lighting}: independent HDR`);
      if (hdr && supportsHdr(profile)) assert.deepEqual(await fs.readFile(tone), await fs.readFile(resourcePath(quenching, 'shaders', pack, shaderPixelFolder(profile, lighting), 'tonemap.bls')));
      assert.equal(await fs.pathExists(path.join(target, 'ps/fog.bls')), postProcessing, 'Shadow switch remains independent');
      assert.equal(await fs.readFile(path.join(target, 'ps/bloomextract.bls'), 'utf8'), 'glow', 'HDR leaves Bloom unchanged');
    }
  }
  const invalid = path.join(root, 'missing-source');
  const live = path.join(root, 'protected');
  await fs.outputFile(path.join(live, 'ps/tonemap.bls'), 'existing');
  await assert.rejects(applyShaderToggles(live, invalid, { graphics: 'hd', shaderPack: 'shaders203' }, { hdr: true }), /HDR shader missing/);
  assert.equal(await fs.readFile(path.join(live, 'ps/tonemap.bls'), 'utf8'), 'existing', 'Missing source fails before modifying active files');
  console.log('PASS: HDR independent of shadow/Bloom; on/off across 2.04, 3.01 HD/DE/PTR and all lighting modes; legacy 3.0 excluded; missing source preserves active HDR.');
} finally {
  assert(path.dirname(root) === parent && !(await fs.lstat(root)).isSymbolicLink());
  await fs.remove(root);
}
