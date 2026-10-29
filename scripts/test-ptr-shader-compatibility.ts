import { resourcePath } from '../src/shared/bundled-resource-paths.mjs';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { withShaderBundle } from '../src/Main/services/shader-bundle';
import { resolvePtrShaderCompatibility } from '../src/shared/ptr-shader-compatibility';
import { assertShaderProfileSupported } from '../src/shared/mod-profile';

const known = resolvePtrShaderCompatibility({ parts: [3,0,1,24368], source: 'build.info' });
assert.equal(known.status, 'supported');
assert.doesNotThrow(() => assertShaderProfileSupported({ graphics: 'hd', ptrShaderCompatibility: known }));
for (const parts of [[3,0,1], [3,0,1,24369], [3,0,2,1], [4,0,0,1], [2,0,4], [0], [3,0,1,NaN]]) {
  const decision = resolvePtrShaderCompatibility({ parts, source: 'build.info' });
  assert.equal(decision.status, 'unverified');
  assert.throws(() => assertShaderProfileSupported({ graphics: 'de', ptrShaderCompatibility: decision }), /shader compatibility is not verified/);
  assert.doesNotThrow(() => assertShaderProfileSupported({ graphics: 'sd', ptrShaderCompatibility: decision }));
}
assert.equal(resolvePtrShaderCompatibility({ parts: [3,0,1,24368], source: 'unknown' }).status, 'unverified');
const futureRules = { id: 'synthetic-future-format', builds: ['3.0.2.10'], fogShaderPack: 'fog_shaders-ptr' as const };
const future = resolvePtrShaderCompatibility({ parts: [3,0,2,10], source: 'exe' }, futureRules);
assert.equal(future.status, 'supported');
assert.equal(future.status === 'supported' && future.fogShaderPack, 'fog_shaders-ptr');
assert.equal(resolvePtrShaderCompatibility({ parts: [3,0,2,11], source: 'exe' }, futureRules).status, 'unverified');
assert.equal(resolvePtrShaderCompatibility({ parts: [3,0,1,24368], source: 'build.info' }, futureRules).status, 'unverified', 'old builds are not authorized for a new incompatible active pack');
assert.doesNotThrow(() => assertShaderProfileSupported({ graphics: 'hd' }), 'Retail is not subject to PTR allowlists');
const testParent = path.resolve('_tmp/resource-bundle-20261028'); await fs.ensureDir(testParent);
const root = await fs.mkdtemp(path.join(testParent, 'quenching-ptr-policy-'));
try {
  const q = path.join(root, 'quenching'); await fs.ensureDir(q);
  const zip = new JSZip();
  zip.file('shaders/shaders-ptr-hd/ps/standard/terrain.bls', 'ptr-terrain');
  zip.file('shaders/fog_shaders-ptr/ao_080/ps/fog.bls', 'ptr-fog');
  zip.file('shaders/shaders-300-hd/ps/standard/terrain.bls', 'retail-unselected');
  for (const entry of Object.values(zip.files)) if (!entry.dir) await fs.outputFile(path.join(q, entry.name), await entry.async('nodebuffer'));
  await withShaderBundle(q, 'shaders-ptr-hd', root, async selected => {
    assert.equal(await fs.readFile(resourcePath(selected, 'shaders/fog_shaders-ptr/ao_080/ps/fog.bls'), 'utf8'), 'ptr-fog');
    assert.equal(selected, q, 'PTR uses the prepared source');
  });
  assert.equal((await fs.readdir(root)).some(name => name.startsWith('.quenching-shader-assets-')), false);
} finally {
  assert.ok(path.resolve(root).startsWith(testParent + path.sep));
  await fs.remove(root);
}
console.log('PASS: exact PTR builds, unknown/stale/future detection, separate future Fog source, no Retail/SD restriction');
