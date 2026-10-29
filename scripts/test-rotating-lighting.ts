import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import fs from 'fs-extra';
import rotations from '../assets/unpacked/experimental/de-unit-rotations.json';
import { applyDncLighting } from '../src/Main/services/dnc-lighting';
import { patchRotatingUnitLighting, replaceUnitRotation, ROTATING_UNIT_FILES, unitRotationBlock } from '../src/Main/services/rotating-lighting';
import { quat, vec3 } from 'gl-matrix';
import { buildRotatingLightTrack, ROTATING_LIGHT_START, ROTATING_LIGHT_START_HOUR } from '../src/shared/dnc-rotation';

const taskRoot = path.resolve('_tmp/rotating-lighting-fix-20261027');
await fs.ensureDir(taskRoot);
const root = await fs.mkdtemp(path.join(taskRoot, 'tests-'));
const sourceRoot = path.resolve('assets/unpacked/dnc');
async function snapshot(dir: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  async function visit(current: string) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      assert(!entry.isSymbolicLink());
      if (entry.isDirectory()) await visit(file);
      else result.set(path.relative(dir, file).replaceAll('\\', '/'), await fs.readFile(file, 'utf8'));
    }
  }
  await visit(dir);
  return result;
}
const stripRotation = (content: string) => replaceUnitRotation(content, 'ROTATION');
let scenarios = 0;
try {
  const generated = buildRotatingLightTrack(rotations.keyframes, rotations.interval, [0, 60000]);
  assert.equal(generated.length, 54);
  const reference = [...rotations.keyframes, { frame: rotations.interval[1], value: rotations.keyframes[0].value }];
  const sample = (keys: { frame: number; value: readonly number[] }[], frame: number) => {
    let index = keys.findIndex(key => key.frame >= frame);
    if (index <= 0) return quat.normalize(quat.create(), keys[index < 0 ? keys.length - 1 : index].value);
    const left = keys[index - 1], right = keys[index];
    const value = quat.slerp(quat.create(), quat.normalize(quat.create(), left.value), quat.normalize(quat.create(), right.value),
      (frame - left.frame) / (right.frame - left.frame));
    return quat.normalize(value, value);
  };
  const direction = (value: readonly number[]) => vec3.transformQuat(vec3.create(), [0, 0, 1], value);
  const requestedStart = ROTATING_LIGHT_START.map(value => value / Math.hypot(...ROTATING_LIGHT_START));
  assert.equal(ROTATING_LIGHT_START_HOUR, 6);
  const startPhase = ROTATING_LIGHT_START_HOUR / 24;
  const anchor = generated.find(key => key.frame === startPhase * 60000)!;
  anchor.value.forEach((value, index) => assert(Math.abs(value - requestedStart[index]) < 1e-12, 'Requested starting quaternion belongs to 06:00'));
  const initial = direction(anchor.value);
  const elevationOffset = Math.asin(initial[2]) - Math.asin(direction(quat.normalize(quat.create(), rotations.keyframes[0].value))[2]);
  const initialAngle = Math.atan2(initial[1], initial[0]);
  let maxElevationError = 0, maxAzimuthError = 0, totalSweep = 0;
  const midnight = direction(generated[0].value);
  let previousAngle = Math.atan2(midnight[1], midnight[0]);
  for (const [hour, degrees] of [[6, 0], [12, 90], [18, 180], [0, 270], [24, 270]]) {
    const actual = direction(sample(generated, hour / 24 * 60000));
    const angle = Math.atan2(actual[1], actual[0]);
    const expected = initialAngle + degrees * Math.PI / 180;
    assert(Math.abs(Math.atan2(Math.sin(angle - expected), Math.cos(angle - expected))) < 1e-5, `${hour}:00 azimuth is aligned to the 06:00 anchor`);
  }
  for (let tick = 0; tick <= 720; tick++) {
    const dayPhase = tick / 720;
    const phase = (dayPhase - startPhase + 1) % 1;
    const actual = direction(sample(generated, dayPhase * 60000));
    const source = direction(sample(reference, rotations.interval[0] + phase * 60000));
    const elevationError = Math.abs(Math.asin(actual[2]) - Math.asin(source[2]) - elevationOffset) * 180 / Math.PI;
    const angle = Math.atan2(actual[1], actual[0]);
    const expectedAngle = initialAngle + phase * 2 * Math.PI;
    const azimuthError = Math.abs(Math.atan2(Math.sin(angle - expectedAngle), Math.cos(angle - expectedAngle))) * 180 / Math.PI;
    maxElevationError = Math.max(maxElevationError, elevationError);
    maxAzimuthError = Math.max(maxAzimuthError, azimuthError);
    if (tick > 0) {
      const delta = Math.atan2(Math.sin(angle - previousAngle), Math.cos(angle - previousAngle));
      assert(delta > 0 && delta < Math.PI / 180, 'SLERP moves the light forward at every half-degree sample');
      totalSweep += delta;
    }
    previousAngle = angle;
  }
  assert(Math.abs(totalSweep * 180 / Math.PI - 360) < 1e-5);
  assert(maxElevationError < 0.25, 'Dense interpolation retains the original DE elevation curve');
  assert(maxAzimuthError < 0.25, 'Dense interpolation follows a full, evenly paced orbit');
  assert.throws(() => buildRotatingLightTrack(rotations.keyframes, rotations.interval, [0, 0]), /Invalid DNC/);
  assert.throws(() => buildRotatingLightTrack([{ frame: 0, value: [0, 0, 0, 0] }, { frame: 10, value: [0, 0, 0, 1] }], [0, 20], [0, 20]), /Invalid light quaternion/);
  await fs.writeJson(path.join(taskRoot, 'math-verification.json'), {
    independentMath: 'gl-matrix', samples: 721, generatedKeys: generated.length,
    startingGameHour: ROTATING_LIGHT_START_HOUR, startingFrame: anchor.frame,
    requestedStartingQuaternion: ROTATING_LIGHT_START, normalizedStartingQuaternion: anchor.value,
    sweepDegrees: totalSweep * 180 / Math.PI, maxElevationErrorDegrees: maxElevationError, maxAzimuthErrorDegrees: maxAzimuthError,
  }, { spaces: 2 });
  const manifest = await fs.readJson('backup/de-dnc-original-20261027/manifest.json');
  assert.equal(manifest.layer, 'war3.w3mod:_de.w3mod:');
  assert.equal(manifest.builds.length, 1);
  assert.equal(manifest.builds[0].product, 'w3', 'The reference comes from Retail, not PTR');
  assert.equal(rotations.sourceVersion, manifest.builds[0].version);
  for (const entry of manifest.models) {
    const bytes = await fs.readFile(path.join('backup/de-dnc-original-20261027', entry.relative));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  }
  for (const [file, hash] of Object.entries(rotations.sources)) {
    const archived = await fs.readFile(path.join('backup/de-dnc-original-20261027', file.replace(/\.mdl$/, '.mdx')));
    assert.equal(createHash('sha256').update(archived).digest('hex'), hash);
    const offset = archived.indexOf(Buffer.from('KGRT'));
    assert(offset > 0);
    assert.equal(archived.readUInt32LE(offset + 4), 6);
    assert.equal(archived.readUInt32LE(offset + 8), 1);
    for (const [i, key] of rotations.keyframes.entries()) {
      assert.equal(archived.readUInt32LE(offset + 16 + i * 20), key.frame);
      assert.deepEqual(Array.from({ length: 4 }, (_, j) => archived.readFloatLE(offset + 20 + i * 20 + j * 4)), key.value);
    }
  }
  for (const pack of ['dnc20', 'dnc30-hd', 'dnc30-de']) {
    const baseline = path.join(sourceRoot, pack);
    for (const mode of ['standard', 'battle', 'rpg']) for (const level of [1, 3, 5]) {
      const dnc = path.join(root, pack, mode, String(level), 'environment', 'dnc');
      const options = { deMode: pack === 'dnc30-de', isVersion30: pack !== 'dnc20' };
      await fs.copy(baseline, dnc);
      await applyDncLighting(dnc, mode, level, options);
      await fs.outputFile(path.join(dnc, 'custom', 'customunit.mdl'), 'custom content untouched');
      const before = await snapshot(dnc);
      await patchRotatingUnitLighting(dnc, baseline, true, mode, level, options);
      const after = await snapshot(dnc);
      assert.deepEqual([...after.keys()], [...before.keys()]);
      for (const [file, content] of before) {
        const actual = after.get(file)!;
        if (ROTATING_UNIT_FILES.includes(file)) {
          assert.notEqual(actual, content, `${pack}/${mode}/${level}/${file} must rotate`);
          assert.equal(stripRotation(actual), stripRotation(content), 'Only Rotation may differ');
          const block = unitRotationBlock(actual);
          const frames = [...block.matchAll(/(\d+):\s*\{\s*([^}]+)\}/g)];
          assert.equal(Number(block.match(/Rotation (\d+)/)![1]), frames.length);
          assert(frames.length >= 49, 'A complete orbit needs intermediate orientations');
          const start = Number(actual.match(/Interval\s*\{\s*(\d+)/)![1]);
          const values = frames.map(frame => frame[2].split(',').map(Number));
          assert.equal(Number(frames[0][1]), start);
          assert.equal(Number(frames.at(-1)![1]), start + 60000);
          assert.deepEqual(values.at(-1), values[0], 'Cycle closes without a direction jump');
          const atSix = frames.findIndex(frame => Number(frame[1]) === start + 15000);
          assert(atSix >= 0);
          assert.deepEqual(values[atSix], requestedStart, `${pack} uses the requested quaternion at 06:00, including nonzero animation starts`);
          let sweep = 0;
          let previousAngle: number | undefined;
          for (const [index, value] of values.entries()) {
            assert(Math.abs(Math.hypot(...value) - 1) < 1e-10);
            const direction = vec3.transformQuat(vec3.create(), [0, 0, 1], value);
            const angle = Math.atan2(direction[1], direction[0]);
            if (previousAngle !== undefined) {
              const delta = Math.atan2(Math.sin(angle - previousAngle), Math.cos(angle - previousAngle));
              assert(delta > 0 && delta < Math.PI / 4, 'Light progresses forward through every azimuth');
              sweep += delta;
            }
            previousAngle = angle;
            if (index > 0) assert(Number(frames[index][1]) > Number(frames[index - 1][1]));
          }
          assert(Math.abs(sweep - Math.PI * 2) < 1e-5, 'Actual light vector must sweep 360 degrees');
          for (const key of rotations.keyframes) {
            const target = start + (key.frame - rotations.interval[0] + 15000) % 60000;
            const index = frames.findIndex(frame => Number(frame[1]) === target);
            assert(index >= 0);
            const sourceDirection = vec3.transformQuat(vec3.create(), [0, 0, 1], quat.normalize(quat.create(), key.value));
            const actualDirection = vec3.transformQuat(vec3.create(), [0, 0, 1], values[index]);
            assert(Math.abs(Math.asin(actualDirection[2]) - Math.asin(sourceDirection[2]) - elevationOffset) < 1e-6,
              'DE relative elevation changes are retained at original keyframes');
          }
        } else assert.equal(actual, content, `${file} must remain byte-identical`);
      }
      await patchRotatingUnitLighting(dnc, baseline, true, mode, level, options);
      assert.deepEqual(await snapshot(dnc), after, 'Repeated enable is idempotent');
      await patchRotatingUnitLighting(dnc, baseline, false, mode, level, options);
      assert.deepEqual(await snapshot(dnc), before, 'Disable restores the exact processed profile');
      scenarios++;
    }
  }
  const baseline = path.join(sourceRoot, 'dnc30-de');
  const dnc = path.join(root, 'failures', 'environment', 'dnc');
  await fs.copy(baseline, dnc);
  const before = await snapshot(dnc);
  const options = { deMode: true, isVersion30: true };
  await assert.rejects(patchRotatingUnitLighting(dnc, baseline, true, 'standard', 3, options,
    () => { throw new Error('preference commit failed'); }), /preference commit failed/);
  assert.deepEqual(await snapshot(dnc), before, 'Preference failure rolls back all four files');

  const rename = fs.rename;
  let writes = 0;
  (fs as any).rename = async (...args: any[]) => {
    if (++writes === 2) throw new Error('fixture locked file');
    return (rename as any)(...args);
  };
  try {
    await assert.rejects(patchRotatingUnitLighting(dnc, baseline, true, 'standard', 3, options), /fixture locked file/);
  } finally { (fs as any).rename = rename; }
  assert.deepEqual(await snapshot(dnc), before, 'A failed atomic write rolls back previous writes and leaves no temporary files');

  const broken = path.join(dnc, ROTATING_UNIT_FILES.at(-1)!);
  await fs.writeFile(broken, before.get(ROTATING_UNIT_FILES.at(-1)!)!.replace('ObjectId 0,', 'ObjectId 7,'));
  const invalid = await snapshot(dnc);
  await assert.rejects(patchRotatingUnitLighting(dnc, baseline, true, 'standard', 3, options), /Unsupported DNC light hierarchy/);
  assert.deepEqual(await snapshot(dnc), invalid, 'All models are validated before any write');

  // The existing directory queue must keep a regular restore and experiment
  // from interleaving, including after a failed mutation.
  const { withResourceDirectory } = await import('../src/Main/services/resource-directory-queue');
  const order: number[] = [];
  await Promise.all([
    withResourceDirectory(dnc, async () => { order.push(1); await Promise.resolve(); order.push(2); }),
    withResourceDirectory(dnc, async () => { order.push(3); throw new Error('queued failure'); }).catch(() => {}),
    withResourceDirectory(dnc, async () => { order.push(4); }),
  ]);
  assert.deepEqual(order, [1, 2, 3, 4]);
  console.log(`PASS: 06:00 anchor and 00/06/12/18/24 clock alignment; 721 independently interpolated directions; 360-degree sweep; 54 normalized, closed keys; elevation error ${maxElevationError.toFixed(4)} degrees; ${scenarios} profile/mode/brightness combinations; rotation-only edits; exclusions; exact disable; idempotence; rollback; queue recovery`);
} finally {
  assert(path.dirname(root) === taskRoot && path.basename(root).startsWith('tests-'));
  assert(!(await fs.lstat(root)).isSymbolicLink());
  await fs.remove(root);
}
