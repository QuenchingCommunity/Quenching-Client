import { resourcePath } from '../src/shared/bundled-resource-paths.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'fs-extra';
import { applyPostProcessingShaders, applyShaderToggles, pickFogVariant } from '../src/Main/services/fog-shader-override';

const hd = { graphics: 'hd', shaderPack: 'shaders-300-hd' } as const;
for (const pack of ['shaders-300-hd', 'shaders-ptr-hd', 'shaders-300-de', 'shaders-ptr-de'] as const) {
  const profile = { graphics: pack.endsWith('-de') ? 'de' : 'hd', shaderPack: pack } as const;
  for (const mode of ['standard', 'rpg', 'battle']) for (const brightness of [1, 2, 3, 4, 5, undefined]) {
    const base = mode === 'battle' ? 'ao_066' : 'ao_080';
    assert.equal(pickFogVariant(profile, mode, brightness), base, `${pack}/${mode}/${brightness}`);
    assert.equal(pickFogVariant(profile, mode, brightness, true), base + '_outline');
  }
}
assert.equal(pickFogVariant(hd, undefined, 5), 'ao_080');
assert.equal(pickFogVariant(hd, 'enhanced', 3), 'ao_080', 'older enhanced mode uses standard AO');
assert.equal(pickFogVariant({ graphics: 'hd', shaderPack: 'shaders-300-legacy-hd' }, 'battle', 5, true), 'brightness_3', 'archived 3.0 unchanged');
assert.equal(pickFogVariant({ graphics: 'hd', shaderPack: 'shaders203' }, 'battle', 3), null);
assert.equal(pickFogVariant({ graphics: 'sd', shaderPack: 'shaders-300-hd' }, 'battle', 3), null);

const quenchingDir = path.join(process.cwd(), 'assets', 'quenching');
const publishedProfiles = await fs.readJson(resourcePath(quenchingDir, 'shaders/fog_shaders/profiles.json'));
assert.deepEqual(publishedProfiles.ao_by_lighting_mode, { standard: 'optimized_3.6_with_terrain_identity', battle: 'optimized_3.6_with_terrain_identity' });
assert.equal(publishedProfiles.protocol, 'production_37_identity_optimized_v1');
assert.equal(publishedProfiles.requires_paired_terrain_writers, true);
assert.equal(publishedProfiles.terrain_identity, 'terrain_identity_v1_6bit_spatial_signature_confirmed_2x2');
assert.deepEqual(publishedProfiles.fog_optimizations, { reduce_samples: true, half_resolution: true, cheap_candidate_rejection: true });
assert.equal(publishedProfiles.outline.strength, 0.75);
assert.equal(publishedProfiles.outline.width_pixels, 3);
assert.equal(publishedProfiles.outline.default_enabled, false);
assert.equal(publishedProfiles.outline.baseline_strength, 0.4);
assert.equal(publishedProfiles.outline.baseline_width_pixels, 2);
for (const variant of publishedProfiles.variants) {
  const data = await fs.readJson(resourcePath(quenchingDir, "shaders/fog_shaders", variant, "settings.json"));
  assert.equal(data.outline_strength, variant.endsWith("_outline") ? 0.75 : 0.4);
  assert.equal(data.outline_width_pixels, variant.endsWith("_outline") ? 3 : 2);
  assert.equal(data.terrain_identity, publishedProfiles.terrain_identity);
  assert.deepEqual(data.fog_optimizations, publishedProfiles.fog_optimizations);
}
const fogSource = (variant: string, file: string) => resourcePath(quenchingDir, 'shaders', 'fog_shaders', variant, 'ps', file);
const scratch = path.resolve('_tmp/fog-ao37-tests');
await fs.ensureDir(scratch);
const temp = await fs.mkdtemp(path.join(scratch, 'fog-override-'));
try {
  const shadersDir = path.join(temp, 'shaders');
  const seed = async () => {
    await fs.remove(shadersDir);
    for (const file of ['fog.bls', 'volumetricfog.bls', 'bloomextract.bls']) await fs.outputFile(path.join(shadersDir, 'ps', file), `pack ${file}`);
  };
  const same = async (target: string, source: string) =>
    Buffer.compare(await fs.readFile(target), await fs.readFile(source)) === 0;

  await seed();
  await applyPostProcessingShaders(shadersDir, quenchingDir, hd, { lighting: 'battle', lightingBrightness: 5 });
  assert.ok(await same(path.join(shadersDir, 'ps', 'fog.bls'), fogSource('ao_066', 'fog.bls')));
  assert.ok(await same(path.join(shadersDir, 'ps', 'volumetricfog.bls'), fogSource('ao_066', 'volumetricfog.bls')));
  assert.equal(await fs.readFile(path.join(shadersDir, 'ps', 'bloomextract.bls'), 'utf8'), 'pack bloomextract.bls');

  await seed();
  await applyPostProcessingShaders(shadersDir, quenchingDir, hd, { lighting: 'rpg', lightingBrightness: 4 });
  assert.ok(await same(path.join(shadersDir, 'ps', 'fog.bls'), fogSource('ao_080', 'fog.bls')));

  for (const file of ['terrain.bls', 'cliffblightmiscterrain.bls']) {
    assert.ok(await same(path.join(shadersDir, 'ps', file),
      resourcePath(quenchingDir, 'shaders', hd.shaderPack, 'ps', 'rpg', file)), 'RPG uses its derived Standard terrain material and paired identity writers');
  }

  await seed();
  await applyPostProcessingShaders(shadersDir, quenchingDir, hd, { lighting: 'standard', lightingBrightness: 3 });
  assert.ok(await same(path.join(shadersDir, 'ps', 'fog.bls'), fogSource('ao_080', 'fog.bls')));

  await seed();
  await fs.outputFile(path.join(shadersDir, 'ps', 'bloomcombine.bls'), 'pack bloomcombine.bls');
  await fs.outputFile(path.join(shadersDir, 'ps', 'gaussianblur.bls'), 'pack gaussianblur.bls');
  await applyPostProcessingShaders(shadersDir, quenchingDir, hd, { lighting: 'battle', lightingBrightness: 5, postProcessing: false });
  for (const file of ['fog.bls', 'volumetricfog.bls']) {
    assert.equal(await fs.pathExists(path.join(shadersDir, 'ps', file)), false, `${file} removed with shadow post-processing off`);
  }
  for (const file of ['bloomcombine.bls', 'bloomextract.bls', 'gaussianblur.bls']) {
    assert.equal(await fs.readFile(path.join(shadersDir, 'ps', file), 'utf8'), `pack ${file}`, `${file} kept when only shadows are off`);
  }

  await seed();
  await fs.outputFile(path.join(shadersDir, 'ps', 'bloomcombine.bls'), 'pack bloomcombine.bls');
  await fs.outputFile(path.join(shadersDir, 'ps', 'gaussianblur.bls'), 'pack gaussianblur.bls');
  await applyPostProcessingShaders(shadersDir, quenchingDir, hd, { lighting: 'standard', lightingBrightness: 3, postProcessingGlow: false });
  assert.ok(await same(path.join(shadersDir, 'ps', 'fog.bls'), fogSource('ao_080', 'fog.bls')), 'fog retained with glow off');
  for (const file of ['bloomcombine.bls', 'bloomextract.bls', 'gaussianblur.bls']) {
    assert.equal(await fs.pathExists(path.join(shadersDir, 'ps', file)), false, `${file} removed with glow off`);
  }

  await seed();
  for (const file of ['ps/hd.bls', 'ps/terrain.bls', 'vs/hd.bls']) await fs.outputFile(path.join(shadersDir, file), 'object');
  await applyShaderToggles(shadersDir, quenchingDir, hd, { lighting: 'standard', lightingBrightness: 3, objectShader: false });
  for (const file of ['vs/hd.bls']) {
    assert.equal(await fs.pathExists(path.join(shadersDir, file)), false, `${file} removed with object shader off`);
  }
  for (const file of ['hd.bls','sd_on_hd.bls','foliage.bls']) assert.ok(await same(path.join(shadersDir,'ps',file),resourcePath(quenchingDir, 'shaders/fog_shaders/identity_writers/ps',file)),'material-off native colour/FOW writer');
  assert.ok(await same(path.join(shadersDir, 'ps/fog.bls'), fogSource('ao_080', 'fog.bls')));
  assert.ok(await same(path.join(shadersDir, 'ps/terrain.bls'), resourcePath(quenchingDir, 'shaders/fog_shaders/identity_writers/ps/terrain.bls')), 'material-off terrain still supplies the required identity');
  assert.ok(await same(path.join(shadersDir, 'ps/cliffblightmiscterrain.bls'), resourcePath(quenchingDir, 'shaders/fog_shaders/identity_writers/ps/cliffblightmiscterrain.bls')), 'modified blight alpha override retained');
  await applyShaderToggles(shadersDir, quenchingDir, hd, { objectShader: false, postProcessing: false });
  for (const file of ['fog.bls', 'volumetricfog.bls', 'terrain.bls', 'cliffblightmiscterrain.bls']) assert.equal(await fs.pathExists(path.join(shadersDir, 'ps', file)), false);

  for (const lighting of ['standard', 'rpg', 'battle']) for (const outline of [false, true]) {
    await seed();
    await applyPostProcessingShaders(shadersDir, quenchingDir, hd, { lighting, postProcessingOutline: outline, postProcessingGlow: false });
    const variant = (lighting === 'battle' ? 'ao_066' : 'ao_080') + (outline ? '_outline' : '');
    for (const file of ['fog.bls', 'volumetricfog.bls']) assert.ok(await same(path.join(shadersDir, 'ps', file), fogSource(variant, file)));
  }

  await seed();
  await fs.outputFile(path.join(shadersDir, 'ps', 'hd.bls'), 'object');
  await applyShaderToggles(shadersDir, quenchingDir, hd, { lighting: 'standard', lightingBrightness: 3 });
  assert.ok(await same(path.join(shadersDir,'ps/hd.bls'),resourcePath(quenchingDir, 'shaders/shaders-300-hd/ps/standard/hd.bls')),'existing pack upgrades its paired native-visibility HD writer');

  // All FOW writers are validated before removing the installed material
  // files. A missing native-colour fallback must preserve a working pair.
  const missingFow = path.join(temp, 'missing-fow-assets');
  for (const file of ['fog.bls','volumetricfog.bls']) await fs.outputFile(path.join(missingFow,'shaders/fog_shaders/ao_080/ps',file),'new-fog');
  for (const file of ['terrain.bls','cliffblightmiscterrain.bls','hd.bls','sd_on_hd.bls']) await fs.outputFile(path.join(missingFow,'shaders/fog_shaders/identity_writers/ps',file),'native-fow');
  await fs.outputFile(path.join(shadersDir,'ps/hd.bls'),'keep-hd');
  await fs.outputFile(path.join(shadersDir,'ps/fog.bls'),'keep-fog');
  await assert.rejects(applyShaderToggles(shadersDir,missingFow,hd,{objectShader:false}),/paired resource/);
  assert.equal(await fs.readFile(path.join(shadersDir,'ps/hd.bls'),'utf8'),'keep-hd');
  assert.equal(await fs.readFile(path.join(shadersDir,'ps/fog.bls'),'utf8'),'keep-fog');

  // Future PTR Fog inputs have an independent entry; never fall back silently
  // to a shared Retail Fog or overwrite a working pair before all inputs exist.
  const isolated = path.join(temp, 'isolated-assets');
  const ptr = { graphics: 'hd', shaderPack: 'shaders-ptr-hd', ptrShaderCompatibility: {
    status: 'supported', detectedVersion: '3.0.2.10', ruleId: 'synthetic-test', fogShaderPack: 'fog_shaders-ptr',
  } } as const;
  await seed();
  await fs.outputFile(path.join(shadersDir, 'ps/hd.bls'), 'keep-object');
  const sourceGroup = path.join(isolated, 'shaders/fog_shaders-ptr');
  // HDR is independently enabled by default; provide its own PTR fixture.
  await fs.outputFile(resourcePath(isolated, 'shaders/shaders-ptr-hd/ps/standard/tonemap.bls'), 'ptr-hdr');
  for (const file of ['fog.bls', 'volumetricfog.bls']) {
    await fs.outputFile(path.join(sourceGroup, 'ao_080_outline/ps', file), 'ptr-' + file);
    await fs.outputFile(path.join(isolated, 'shaders/fog_shaders/ao_080_outline/ps', file), 'wrong-retail');
  }
  await fs.outputFile(path.join(sourceGroup, 'identity_writers/ps/terrain.bls'), 'ptr-terrain');
  await assert.rejects(() => applyShaderToggles(shadersDir, isolated, ptr, { objectShader: false, postProcessingOutline: true }), /paired resource/);
  assert.equal(await fs.readFile(path.join(shadersDir, 'ps/hd.bls'), 'utf8'), 'keep-object');
  assert.equal(await fs.readFile(path.join(shadersDir, 'ps/fog.bls'), 'utf8'), 'pack fog.bls');
  await fs.outputFile(path.join(sourceGroup, 'identity_writers/ps/cliffblightmiscterrain.bls'), 'ptr-cliff');
  await fs.remove(path.join(sourceGroup, 'identity_writers/ps/terrain.bls'));
  await assert.rejects(() => applyShaderToggles(shadersDir, isolated, ptr, { objectShader: false, postProcessingOutline: true }), /paired resource/);
  assert.equal(await fs.readFile(path.join(shadersDir, 'ps/hd.bls'), 'utf8'), 'keep-object', 'missing terrain identity must not partially install');
  await fs.outputFile(path.join(sourceGroup, 'identity_writers/ps/terrain.bls'), 'ptr-terrain');
  await applyShaderToggles(shadersDir, isolated, ptr, { objectShader: false, postProcessingOutline: true });
  assert.equal(await fs.readFile(path.join(shadersDir, 'ps/fog.bls'), 'utf8'), 'ptr-fog.bls');
  assert.equal(await fs.readFile(path.join(shadersDir, 'ps/terrain.bls'), 'utf8'), 'ptr-terrain');
  assert.equal(await fs.readFile(path.join(shadersDir, 'ps/cliffblightmiscterrain.bls'), 'utf8'), 'ptr-cliff');
  assert.equal(await fs.pathExists(path.join(shadersDir, 'ps/hd.bls')), false);
} finally {
  assert.ok(path.resolve(temp).startsWith(scratch + path.sep));
  await fs.remove(temp);
}
console.log('Fog shader override checks passed');
