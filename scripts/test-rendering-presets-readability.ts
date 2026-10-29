import { resourcePath } from '../src/shared/bundled-resource-paths.mjs';
import { verifyReadabilityWriters } from './verify-readability-writers.mjs';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { renderingPresetSettings, matchesRenderingPreset, supportsReadability } from '../src/shared/rendering-presets';
import { applyShaderToggles } from '../src/Main/services/fog-shader-override';
import { withShaderBundle, selectShaderBundleResources } from '../src/Main/services/shader-bundle';
import { syncUnitSkinBattleMode, storedSkinPath } from '../src/Main/services/unit-skin-profile';
import { resolvePtrShaderCompatibility } from '../src/shared/ptr-shader-compatibility';

const standard = renderingPresetSettings('standard'), battle = renderingPresetSettings('battle');
// A matching file/index hash alone cannot prove that HD still writes team tags.
// Material-only retuning once left only native FOW tags and lost every outline.
assert.equal((await verifyReadabilityWriters(path.resolve('assets/unpacked/shaders'))).passed, true);
assert.equal(standard.glow, true); assert.equal(standard.postProcessingOutline, false);
assert.equal(battle.glow, false); assert.equal(battle.postProcessingOutline, true);
assert.equal(battle.improveReadability, true); assert.equal(battle.tree, 'v16'); assert.equal(battle.terrain, 'v16');
assert.equal(standard.lightingBrightness, 3); assert.equal(battle.lightingBrightness, 4);
assert(matchesRenderingPreset({ ...battle }, 'battle'));
assert(!matchesRenderingPreset({ ...battle, tree: 'tall' }, 'battle'));
const hd = { graphics: 'hd', shaderPack: 'shaders-300-hd' } as const;
assert(supportsReadability(hd));
assert(supportsReadability({ graphics: 'de', shaderPack: 'shaders-300-de' }));
assert(!supportsReadability({ graphics: 'de', shaderPack: 'shaders-300-legacy-de' }));
assert(!supportsReadability({ graphics: 'sd', shaderPack: 'shaders-300-de' }));
for (const pack of ['shaders-300-de', 'shaders203', 'shaders-300-legacy-hd'] as const)
  assert(!supportsReadability({ graphics: 'hd', shaderPack: pack }));
const testParent = path.resolve('_tmp/resource-bundle-20261028'); await fs.ensureDir(testParent);
const root = await fs.mkdtemp(path.join(testParent, 'quenching-readability-'));
const q = path.join(root, 'quenching');
await fs.copy(path.resolve('assets/unpacked/shaders'), path.join(q, 'shaders'));
const digest = async (p: string) => createHash('sha256').update(await fs.readFile(p)).digest('hex');
try {
  // 3.7 first release: even a saved battle preset must not enable new effects
  // in 2.04. Keep its own HD/Fog bytes and do not extract 3.01 readability.
  await withShaderBundle(q, 'shaders203', root, async selected => {
    assert.equal(selected, q, 'Prepared sources are reused; unsupported effects remain inactive');
    const source = resourcePath(selected, 'shaders/shaders203');
    const shaders = path.join(root, '204-shaders');
    await fs.copy(source, shaders);
    for (const outline of [false, true]) {
      await applyShaderToggles(shaders, selected, { graphics: 'hd', shaderPack: 'shaders203' },
        { ...battle, postProcessingOutline: outline });
      for (const file of ['hd.bls', 'fog.bls'])
        assert.equal(await digest(path.join(shaders, 'ps', file)), await digest(path.join(source, 'ps', file)),
          `2.04 battle preset preserves its own ${file}`);
      assert(!await fs.pathExists(path.join(shaders, 'ps/volumetricfog.bls')));
    }
  });
  await withShaderBundle(q, hd.shaderPack, root, async selected => {
    const shaders = path.join(root, 'shaders');
    const index = await fs.readJson(resourcePath(selected, 'shaders/readability-301/profiles.json'));
    for (const lighting of ['standard', 'battle', 'rpg']) for (const outline of [false, true]) {
      const variant = (lighting === 'battle' ? 'ao_066' : 'ao_080') + (outline ? '_outline' : '');
      const settings = { improveReadability: true, lighting, postProcessingOutline: outline, objectShader: true, postProcessing: true };
      await withShaderBundle(q, hd.shaderPack, root, filtered => applyShaderToggles(shaders, filtered, hd, settings),
        selectShaderBundleResources(hd, settings, []));
      const key = lighting === 'rpg' ? `rpg_${variant}` : variant;
      for (const file of ['hd.bls', 'fog.bls', 'volumetricfog.bls']) assert.equal(await digest(path.join(shaders, 'ps', file)), index.profiles[key].files['ps/' + file]);
      const disabled = { ...settings, improveReadability: false };
      await withShaderBundle(q, hd.shaderPack, root, filtered => applyShaderToggles(shaders, filtered, hd, disabled),
        selectShaderBundleResources(hd, disabled, []));
      const mode = lighting === 'battle' ? 'melee' : lighting === 'rpg' ? 'rpg' : 'standard';
      assert.equal(await digest(path.join(shaders, 'ps/hd.bls')), await digest(resourcePath(selected, 'shaders/shaders-300-hd/ps', mode, 'hd.bls')));
      assert.equal(await digest(path.join(shaders, 'ps/fog.bls')), await digest(resourcePath(selected, 'shaders/fog_shaders', variant, 'ps/fog.bls')));
    }
    await applyShaderToggles(shaders, selected, hd, { ...battle, objectShader: false });
    for (const file of ['hd.bls','sd_on_hd.bls','foliage.bls']) assert.equal(await digest(path.join(shaders,'ps',file)),await digest(resourcePath(selected, 'shaders/fog_shaders/identity_writers/ps',file)));
    await applyShaderToggles(shaders, selected, hd, { ...battle, postProcessing: false });
    assert(!await fs.pathExists(path.join(shaders, 'ps/fog.bls')));
    // Mismatching independent PTR bases must fail before changing a working file.
    const entry = index.profiles.ao_066_outline; entry.baseHdSha256 = '0'.repeat(64);
    await fs.writeJson(resourcePath(selected, 'shaders/readability-301/profiles.json'), index);
    const before = await digest(path.join(shaders, 'ps/hd.bls'));
    await assert.rejects(applyShaderToggles(shaders, selected, hd, battle), /do not match/);
    assert.equal(await digest(path.join(shaders, 'ps/hd.bls')), before);
  });
  for (const shaderPack of ['shaders-300-de', 'shaders-ptr-de'] as const) {
    const de = { graphics: 'de', shaderPack, ...(shaderPack.startsWith('shaders-ptr') ? {
      ptrShaderCompatibility: resolvePtrShaderCompatibility({ parts: [3,0,1,24368], source: 'build.info' }),
    } : {}) } as const;
    await withShaderBundle(q, shaderPack, root, async selected => {
      const shaders = path.join(root, 'de-shaders');
      const index = await fs.readJson(resourcePath(selected, 'shaders/readability-301/profiles.json'));
      const sourceHd = resourcePath(selected, 'shaders', shaderPack, 'ps/hd.bls');
      for (const lighting of ['standard', 'battle', 'rpg']) for (const outline of [false, true]) {
        const variant = (lighting === 'battle' ? 'ao_066' : 'ao_080') + (outline ? '_outline' : '');
        const key = `de_${variant}`;
        const sourceForMode = lighting === 'battle' ? resourcePath(selected, 'shaders', shaderPack, 'battle/ps/hd.bls') : sourceHd;
        const settings = { ...battle, lighting, postProcessingOutline: outline };
        await withShaderBundle(q, shaderPack, root, filtered => applyShaderToggles(shaders, filtered, de, settings),
          selectShaderBundleResources(de, settings, []));
        for (const file of ['hd.bls', 'fog.bls', 'volumetricfog.bls'])
          assert.equal(await digest(path.join(shaders, 'ps', file)), index.profiles[key].files['ps/' + file]);
        assert.equal(index.profiles[key].baseHdSha256, await digest(sourceForMode), 'DE preserves its own current material with per-mode cloud handling');
        const disabled = { ...settings, improveReadability: false };
        await withShaderBundle(q, shaderPack, root, filtered => applyShaderToggles(shaders, filtered, de, disabled),
          selectShaderBundleResources(de, disabled, []));
        assert.equal(await digest(path.join(shaders, 'ps/hd.bls')), await digest(sourceForMode));
        assert.equal(await digest(path.join(shaders, 'ps/fog.bls')), await digest(resourcePath(selected, 'shaders/fog_shaders', variant, 'ps/fog.bls')));
      }
      await applyShaderToggles(shaders, selected, de, { ...battle, postProcessing: false });
      assert(!await fs.pathExists(path.join(shaders, 'ps/fog.bls')));
      assert.equal(await digest(path.join(shaders, 'ps/hd.bls')), await digest(resourcePath(selected, 'shaders', shaderPack, 'battle/ps/hd.bls')));
      if (shaderPack === 'shaders-ptr-de') await assert.rejects(applyShaderToggles(shaders, selected, {
        ...de, ptrShaderCompatibility: resolvePtrShaderCompatibility({ parts: [3,0,1,24369], source: 'build.info' }),
      }, battle), /not verified/);
    });
  }
  const skin = '[hfoo]\nfile:hd=cos/custom/keep\nmodelScale=1\n[Hamg]\nmodelScale=1.3\n';
  const active = path.join(root, 'units/unitskin.txt');
  await fs.outputFile(active, skin);
  const enabled = { ...battle, resolvedVersion: 'v301' };
  for (const lighting of ['standard', 'rpg', 'battle']) {
    await syncUnitSkinBattleMode(root, 'hd', 'v30', { ...enabled, lighting });
    assert((await fs.readFile(active, 'utf8')).includes('modelScale:hd=0.94'));
  }
  await syncUnitSkinBattleMode(root, 'hd', 'v30', { ...enabled, improveReadability: false });
  assert.equal(await fs.readFile(active, 'utf8'), skin);
  await syncUnitSkinBattleMode(root, 'de', 'v30', enabled);
  assert.equal(await fs.readFile(active, 'utf8'), skin, 'DE readability does not shrink units');
  const deSkin = '[hfoo]\nfile:de=cos/custom/de-keep\nmodelScale:de=0.72\nmodelScale=1\n[Hamg]\nmodelScale:de=1.15\n';
  await fs.writeFile(active, deSkin);
  for (const lighting of ['standard', 'battle', 'rpg']) {
    await syncUnitSkinBattleMode(root, 'de', 'v30', { ...enabled, lighting });
    assert.equal(await fs.readFile(active, 'utf8'), deSkin, 'DE custom paths and model scales remain byte-identical');
  }
  await fs.writeFile(active, skin);
  for (const resolvedVersion of ['v30', 'v204']) {
    await syncUnitSkinBattleMode(root, 'hd', 'v30', { ...enabled, resolvedVersion });
    assert.equal(await fs.readFile(active, 'utf8'), skin);
  }
  await syncUnitSkinBattleMode(root, 'hd', 'v20', { ...enabled, resolvedVersion: 'v204' });
  assert.equal(await fs.readFile(active, 'utf8'), skin, 'actual 2.04 skin era does not shrink units');
  await fs.move(active, storedSkinPath(root, 'hd', true, 'v30'));
  await syncUnitSkinBattleMode(root, 'hd', 'v30', enabled);
  await syncUnitSkinBattleMode(root, 'hd', 'v30', { ...enabled, improveReadability: false });
  assert.equal(await fs.readFile(storedSkinPath(root, 'hd', true, 'v30'), 'utf8'), skin);
} finally { await fs.remove(root); }
console.log('PASS: presets, all paired readability/Fog combinations, off restoration, version restrictions, reversible custom/parked unitskin sizes');
