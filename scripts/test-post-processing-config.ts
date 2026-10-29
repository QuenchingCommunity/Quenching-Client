import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';
import { copyPostProcessingConfigIfMissing, setPostProcessingTonemapEnabled, setPostProcessingBloomEnabled } from '../src/Main/services/post-processing-config';

async function main(): Promise<void> {
  const parent=path.resolve('_tmp/battle-terrain-package-20261028'); await fs.ensureDir(parent);
  const root = await fs.mkdtemp(path.join(parent, 'quenching-post-config-'));
  try {
    const source = path.join(root, 'PostProcessingConfig.txt');
    const retail = path.join(root, '_retail_');
    const target = path.join(retail, 'PostProcessingConfig.txt');
    await fs.outputFile(source, '[Bloom]\nEnabled=1\n');
    await fs.ensureDir(retail);

    assert.equal(await copyPostProcessingConfigIfMissing(retail, source), true);
    assert.equal(await fs.readFile(target, 'utf8'), '[Bloom]\nEnabled=1\n');

    await fs.writeFile(source, '[Bloom]\nEnabled=0\n');
    assert.equal(await copyPostProcessingConfigIfMissing(retail, source), false);
    assert.equal(await fs.readFile(target, 'utf8'), '[Bloom]\nEnabled=1\n');

    const custom='[ASSAO]\r\nEnabled=0\r\n[Tonemap]\r\nEnabled=1\r\nExposure=0.88\r\n[Bloom]\r\nEnabled=1\r\n';
    await fs.writeFile(target, custom);
    assert.equal(await setPostProcessingTonemapEnabled(retail,false),true);
    assert.equal(await fs.readFile(target,'utf8'),custom.replace('[Tonemap]\r\nEnabled=1','[Tonemap]\r\nEnabled=0'));
    assert.equal(await setPostProcessingTonemapEnabled(retail,false),false);
    await setPostProcessingTonemapEnabled(retail,true);
    assert.equal(await fs.readFile(target,'utf8'),custom);
    await setPostProcessingBloomEnabled(retail,false);
    assert.equal(await fs.readFile(target,'utf8'),custom.replace('[Bloom]\r\nEnabled=1','[Bloom]\r\nEnabled=0'));
    await setPostProcessingBloomEnabled(retail,true);
    await fs.writeFile(target,'[Bloom]\nEnabled=1\n');
    await setPostProcessingTonemapEnabled(retail,false);
    assert.match(await fs.readFile(target,'utf8'),/\[Tonemap\]\nEnabled=0/);
    console.log('PASS: config copy, Tonemap toggle/restore, missing section, idempotence, exposure/Bloom/AO and CRLF preservation');
  } finally {
    await fs.remove(root);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
